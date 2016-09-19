import util from 'util'
import zmq from 'zmq'
import uuid from 'uuid'
import { isString, isInteger, isArray, every } from 'lodash'
import EventEmitter from 'eventemitter3'

import ElectionCoordinator from './ElectionCoordinator'
import MasterMessagesBroker from './MasterMessagesBroker'
import ExternalNodesUpdater from './ExternalNodesUpdater'
import { DNS_NODE } from './NodeTypes'

import { nodeIdToName, prefixString, debugLog, zeropad } from './utils'

const HEARTBEAT_INTERVAL_CHECK = 400
const HEARTBEAT_TIMEOUT = 1500
const ctorMessage = prefixString('[DNSNode constructor]: ')
const invariantMessage = prefixString('[DNSNode Invariant]: ')

let defaultSettings = {
  debug: false,
  electionTimeout: 400,
  electionPriority: 0,
  coordinationPort: 50061,
  externalUpdatesPort: 50081
}

/**
 * DNS Node
 * @constructor
 * @param {Object} settings A map of settings
 *                          	host
 *                           	debug
 *                            discoveryInterval
 *                            internalPublishPort
 *                            internalCommandPort
 *                            externalPublishPort
 *                            externalSubscribePort
 */
function DNSNode (host, _settings) {
  let instance = this instanceof DNSNode
  if (!instance) return new DNSNode(host, _settings)

  let node = this

  // Settings
  let settings = Object.assign({}, defaultSettings, _settings)
  let {
    debug,
    electionTimeout,
    electionPriority,
    coordinationPort,
    externalUpdatesPort
  } = settings

  // Settings validation
  if (!host || !isString(host)) throw new TypeError(ctorMessage('host is mandatory and should be a string.'))
  if (!isInteger(coordinationPort) || coordinationPort <= 0) throw new TypeError(ctorMessage('settings.coordinationPort should be a positive integer.'))
  if (!isInteger(electionTimeout) || electionTimeout <= 0) throw new TypeError(ctorMessage('settings.electionTimeout should be a positive integer.'))
  if (!isInteger(electionPriority) || electionPriority < 0 || electionPriority > 99) throw new TypeError(ctorMessage('settings.electionPriority should be an integer between 0 and 99.'))
  if (!isInteger(externalUpdatesPort) || externalUpdatesPort <= 0) throw new TypeError(ctorMessage('settings.externalUpdatesPort should be a positive integer.'))
  if (coordinationPort === externalUpdatesPort) throw new TypeError(ctorMessage('settings.coordinationPort and settings.externalUpdatesPort should be different.'))

  // Warnings
  if (electionTimeout < 400) console.warn(ctorMessage('setting electionTimeout to a low value requires a performant network to avoid members votes loss'))

  // Emitter inheritance
  EventEmitter.call(this)

  // Private API
  let _id = `${zeropad(99 - electionPriority, 2)}-${uuid.v4()}`
  let _name = nodeIdToName(_id)
  let _masterBroker = MasterMessagesBroker(_id)
  let _nodesUpdater = ExternalNodesUpdater(settings)
  let _electionCoordinator = new ElectionCoordinator(host, node, _masterBroker, settings)
  _electionCoordinator.on('newMaster', (newMaster) => {
    _lastHeartbeatReceivedTime = Date.now()
    if (
      !_connected ||
      newMaster.endpoints.sub !== _connectedMaster.endpoints.sub ||
      newMaster.endpoints.pub !== _connectedMaster.endpoints.pub
    ) {
      _connectedMaster = newMaster
      _connectToMaster()
    }
    if (newMaster.id === _id) {
      _masterBroker.startHeartbeats()
    } else {
      _masterBroker.stoptHeartbeats()
    }
  })
  let _connected = false
  let _connectedMaster = {}
  let _checkHearbeatInterval
  let _lastHeartbeatReceivedTime = 0
  let _subscribedChannels = []
  let _intPub = false
  let _intSub = false
  let _checkHeartbeat = () => {
    let passedTime = Date.now() - _lastHeartbeatReceivedTime
    if (passedTime > HEARTBEAT_TIMEOUT) {
      if (!_electionCoordinator.voting) {
        node.debug('Missing master...')
        _electionCoordinator.startElection()
      }
    }
  }
  let _connectToMaster = () => {
    let _newIntPub = zmq.socket('pub')
    let _newIntSub = zmq.socket('sub')

    let connections = 0
    function attemptTransitionToConnected () {
      if (!_connected && connections === 2) {
        _connected = true
        node.emit('connect')
      }
    }

    node.debug('Connecting to new master: ', nodeIdToName(_connectedMaster.id))

    _newIntPub.monitor()
    _newIntPub.on('connect', () => {
      _newIntPub.unmonitor()
      if (_intPub) _intPub.close()
      _intPub = _newIntPub
      connections++
      attemptTransitionToConnected()
    })
    _newIntPub.connect(_connectedMaster.endpoints.sub)

    _newIntSub.monitor()
    _newIntSub.on('connect', () => {
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
      let channel = channelBuffer.toString()
      let args = argsBuffers.map(buffer => buffer.toString())

      if (channel === 'heartbeats') {
        let master = JSON.parse(args[0])
        if (_connectedMaster.id === master.id) {
          _lastHeartbeatReceivedTime = Date.now()
          _nodesUpdater.publish(channelBuffer, ...argsBuffers)
        }
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
    node.debug('Connecting...')
    _masterBroker.bind()
    _nodesUpdater.bind()
    _electionCoordinator.bind()
    _checkHearbeatInterval = setInterval(_checkHeartbeat, HEARTBEAT_INTERVAL_CHECK)
  }
  function disconnect () {
    node.debug('Disconnecting...')
    clearInterval(_checkHearbeatInterval)
    if (_id !== _connectedMaster.id) return _teardown()

    // Change this node id to have the lowest election priority
    let _nodeId = _id
    _id = `zzzzzz-${_id}`

    function onMasterEelected (newMaster) {
      if (newMaster.id !== _nodeId) {
        _id = _nodeId
        _electionCoordinator.removeListener(onMasterEelected)
        _nodesUpdater.publish('heartbeats', JSON.stringify(newMaster))
        setTimeout(_teardown, 10)
      } else {
        _electionCoordinator.startElection()
      }
    }

    _electionCoordinator.on('newMaster', onMasterEelected)
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

  //  Debug
  node.debug = debugLog(`[MessageBus DNS Node ${_name}]: `, debug)

  // Instance decoration
  Object.defineProperty(node, 'id', {
    get: () => _id,
    set: () => console.warn(invariantMessage('You cannot change the .id of a dnsNode instance'))
  })
  Object.defineProperty(node, 'name', {
    get: () => _name,
    set: () => console.warn(invariantMessage('You cannot change the .name of a dnsNode instance'))
  })
  Object.defineProperty(node, 'type', {
    get: () => DNS_NODE,
    set: () => console.warn(invariantMessage('You cannot change the .type of a dnsNode instance'))
  })
  Object.defineProperty(node, 'connected', {
    get: () => _connected,
    set: () => console.warn(invariantMessage('You cannot manually change the .connected status of a dnsNode instance'))
  })
  Object.defineProperty(node, 'master', {
    get: () => _connectedMaster,
    set: () => console.warn(invariantMessage('You cannot manually change the .master reference of a dnsNode instance'))
  })
  Object.assign(node, {
    connect,
    disconnect,
    publish,
    subscribe,
    ubsubscribe
  })
}

util.inherits(DNSNode, EventEmitter)

DNSNode.defaultSettings = defaultSettings

export default DNSNode
