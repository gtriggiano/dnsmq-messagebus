import D from 'debug'
import zmq from 'zeromq'
import uuid from 'uuid'
import { isString, isInteger, isArray, every } from 'lodash'
import EventEmitter from 'eventemitter3'

import ElectionCoordinator from './ElectionCoordinator'
import MasterMessagesBroker from './MasterMessagesBroker'
import ExternalNodesUpdater from './ExternalNodesUpdater'
import { DNS_NODE } from './NodeTypes'

import { nodeIdToName, prefixString, zeropad } from './utils'

const HEARTBEAT_INTERVAL_CHECK = 500
const HEARTBEAT_TIMEOUT = 1000
const ctorMessage = prefixString('[DNSNode constructor]: ')
const invariantMessage = prefixString('[DNSNode Invariant]: ')

/**
 * DNS Node
 * @constructor
 * @param {Object} settings A map of settings
 *                            host
 *                            discoveryInterval
 *                            internalPublishPort
 *                            internalCommandPort
 *                            externalPublishPort
 *                            externalSubscribePort
 */
function DNSNode (host, _settings) {
  let settings = {...defaultSettings, ..._settings, host}
  _validateSettings(settings)

  let node = new EventEmitter()

  //  Debug
  const _debug = D('dnsmq-messagebus:dnsnode')
  const _debugHeartbeat = D('dnsmq-messagebus:dnsnode:masterheartbeat')
  const debug = (...args) => _debug(_name, ...args)

  let {
    externalUpdatesPort,
    electionTimeout,
    electionPriority,
    coordinationPort
  } = settings

  // Private API
  let _id = `${zeropad(99 - electionPriority, 2)}-${uuid.v4()}`
  let _name = nodeIdToName(_id)
  let _masterBroker = MasterMessagesBroker(node)
  let _nodesUpdater = ExternalNodesUpdater({externalUpdatesPort})
  let _electionCoordinator = new ElectionCoordinator({
    host,
    coordinationPort,
    electionTimeout,
    node,
    masterBroker: _masterBroker,
    debug
  })
  let _connected = false
  let _connectedMaster = false
  let _connectedMasterJSON = false
  let _checkHearbeatInterval
  let _lastHeartbeatReceivedTime = 0
  let _subscribedChannels = []
  let _intPub = false
  let _intSub = false
  let _checkHeartbeat = () => {
    let passedTime = Date.now() - _lastHeartbeatReceivedTime
    if (passedTime > HEARTBEAT_TIMEOUT) {
      if (!_electionCoordinator.voting) {
        debug('Missing master...')
        _electionCoordinator.startElection()
      }
    }
  }
  let _monitorHeartbeats = () => {
    _checkHeartbeat()
    _unmonitorHeartbeats()
    _checkHearbeatInterval = setInterval(_checkHeartbeat, HEARTBEAT_INTERVAL_CHECK)
  }
  let _unmonitorHeartbeats = () => clearInterval(_checkHearbeatInterval)
  let _onMasterChange = (newMaster) => {
    _lastHeartbeatReceivedTime = Date.now()
    if (
      !_connected ||
      newMaster.name !== _connectedMaster.name
    ) {
      _connectedMaster = newMaster
      _connectedMasterJSON = JSON.stringify(_connectedMaster)
      _connectToMaster()
    }
    if (newMaster.name === _name) {
      _masterBroker.startHeartbeats()
    } else {
      _masterBroker.stoptHeartbeats()
    }
  }
  let _connectToMaster = () => {
    let _newIntPub = zmq.socket('pub')
    let _newIntSub = zmq.socket('sub')

    let connections = 0
    function attemptTransitionToConnected () {
      if (!_connected && connections === 2) {
        _connected = true
        debug(`CONNECTED`)
        node.emit('connect')
      }
    }

    debug(`Connecting to new master: ${_connectedMaster.name}`)

    _newIntPub.monitor()
    _newIntPub.on('connect', () => {
      debug(`Connected to master ${_connectedMaster.name} SUB socket`)
      _newIntPub.unmonitor()
      if (_intPub) _intPub.close()
      _intPub = _newIntPub
      connections++
      attemptTransitionToConnected()
    })
    _newIntPub.connect(_connectedMaster.endpoints.sub)

    _newIntSub.monitor()
    _newIntSub.on('connect', () => {
      debug(`Connected to master ${_connectedMaster.name} PUB socket`)
      _newIntSub.unmonitor()
      if (_intSub) _intSub.close()
      _intSub = _newIntSub
      connections++
      attemptTransitionToConnected()
    })
    _newIntSub.subscribe('heartbeats')
    _subscribedChannels.forEach(channel => _newIntSub.subscribe(channel))
    _newIntSub.connect(_connectedMaster.endpoints.pub)
    _newIntSub.on('message', (channelBuffer, ...argsBuffers) => {
      _lastHeartbeatReceivedTime = Date.now()

      let channel = channelBuffer.toString()
      let args = argsBuffers.map(buffer => buffer.toString())

      if (channel === 'heartbeats') {
        _debugHeartbeat('')
        _nodesUpdater.publish('heartbeats', _connectedMasterJSON)
        return
      }
      node.emit(channel, ...args)
    })
  }
  let _teardown = () => {
    if (_intPub) _intPub.close()
    if (_intSub) _intSub.close()

    _intPub = null
    _intSub = null

    _masterBroker.stoptHeartbeats()
    _masterBroker.unbind()
    _nodesUpdater.unbind()
    _electionCoordinator.unbind()
    node.emit('disconnect')
  }

  // Public API
  function connect () {
    debug('Connecting...')
    _masterBroker.bind()
    _nodesUpdater.bind()
    _electionCoordinator.bind()
    _electionCoordinator.on('newMaster', _onMasterChange)
    _monitorHeartbeats()
  }
  function disconnect () {
    debug('Disconnecting...')
    _unmonitorHeartbeats()
    _electionCoordinator.removeListener('newMaster', _onMasterChange)

    if (_id !== _connectedMaster.id) return _teardown()

    debug(`I'm master. Trying to elect anotherone...`)
    // Change this node id to have the lowest election priority
    let _nodeId = _id
    _id = `zzzzzz-${_id}`

    function onMasterEelected (newMaster) {
      if (newMaster.id === _id) {
        debug('It seems this is the only DNS node in the cluster. Exiting enyway')
      } else {
        debug(`Successfully elected a new master: ${newMaster.name}`)
      }
      _id = _nodeId
      _electionCoordinator.removeListener('newMaster', onMasterEelected)
      _nodesUpdater.publish('heartbeats', JSON.stringify(newMaster))
      setTimeout(_teardown, 10)
    }

    function onFailedElection () {
      _id = _nodeId
      debug(`Election of a new master failed`)
      setTimeout(_teardown, 10)
    }

    _electionCoordinator.on('newMaster', onMasterEelected)
    _electionCoordinator.on('failedElection', onFailedElection)
    _electionCoordinator.startElection()
  }
  function publish (channel, ...args) {
    if (channel === 'heartbeats') return
    if (_intPub) {
      _intPub.send([channel, ...args])
    }
  }
  function subscribe (channels) {
    if (!isArray(channels)) channels = [channels]
    if (!every(channels, isString)) throw new TypeError(invariantMessage('subscribe channels must be represented by strings'))

    channels.forEach(channel => {
      if (_intSub) _intSub.subscribe(channel)
      if (!~_subscribedChannels.indexOf(channel)) {
        _subscribedChannels.push(channel)
      }
    })
  }
  function ubsubscribe (channels) {
    if (!isArray(channels)) channels = [channels]
    if (!every(channels, isString)) throw new TypeError(invariantMessage('subscribe channels must be represented by strings'))

    channels.forEach(channel => {
      if (_intSub) _intSub.unsubscribe(channel)
      let index = _subscribedChannels.indexOf(channel)
      if (index >= 0) {
        _subscribedChannels.splice(index, 1)
      }
    })
  }

  return Object.defineProperties(node, {
    id: {
      get: () => _id,
      set: () => console.warn(invariantMessage('You cannot change the .id of a dnsNode instance'))
    },
    name: {
      get: () => _name,
      set: () => console.warn(invariantMessage('You cannot change the .name of a dnsNode instance'))
    },
    type: {
      get: () => DNS_NODE,
      set: () => console.warn(invariantMessage('You cannot change the .type of a dnsNode instance'))
    },
    connected: {
      get: () => _connected,
      set: () => console.warn(invariantMessage('You cannot manually change the .connected status of a dnsNode instance'))
    },
    master: {
      get: () => _connectedMaster,
      set: () => console.warn(invariantMessage('You cannot manually change the .master reference of a dnsNode instance'))
    },
    connect: {value: connect},
    disconnect: {value: disconnect},
    publish: {value: publish},
    subscribe: {value: subscribe},
    ubsubscribe: {value: ubsubscribe}
  })
}

let defaultSettings = {
  electionTimeout: 400,
  electionPriority: 0,
  coordinationPort: 50061,
  externalUpdatesPort: 50081
}

function _validateSettings (settings) {
  let {
    host,
    electionTimeout,
    electionPriority,
    coordinationPort,
    externalUpdatesPort
  } = settings

  if (!host || !isString(host)) throw new TypeError(ctorMessage('host is mandatory and should be a string.'))
  if (!isInteger(coordinationPort) || coordinationPort <= 0) throw new TypeError(ctorMessage('settings.coordinationPort should be a positive integer.'))
  if (!isInteger(electionTimeout) || electionTimeout <= 0) throw new TypeError(ctorMessage('settings.electionTimeout should be a positive integer.'))
  if (!isInteger(electionPriority) || electionPriority < 0 || electionPriority > 99) throw new TypeError(ctorMessage('settings.electionPriority should be an integer between 0 and 99.'))
  if (!isInteger(externalUpdatesPort) || externalUpdatesPort <= 0) throw new TypeError(ctorMessage('settings.externalUpdatesPort should be a positive integer.'))
  if (coordinationPort === externalUpdatesPort) throw new TypeError(ctorMessage('settings.coordinationPort and settings.externalUpdatesPort should be different.'))

  // Warnings
  if (electionTimeout < 400) console.warn(ctorMessage('setting electionTimeout to a low value requires a performant network to avoid members votes loss'))
}

export default DNSNode
