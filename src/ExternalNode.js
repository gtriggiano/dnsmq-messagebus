import D from 'debug'
import dns from 'dns'
import uuid from 'uuid'
import zmq from 'zeromq'
import { isString, isInteger, isArray, every } from 'lodash'
import EventEmitter from 'eventemitter3'

import { EXTERNAL_NODE } from './NodeTypes'

import { nodeIdToName, prefixString } from './utils'

const HEARTBEAT_INTERVAL_CHECK = 400
const HEARTBEAT_TIMEOUT = 1500
const ctorMessage = prefixString('[ExternalNode constructor]: ')
const invariantMessage = prefixString('[ExternalNode Invariant]: ')

let internalEventsChannels = ['connect', 'disconnect', 'connection:failure', 'heartbeats', 'newMaster', 'changedMaster']

function ExternalNode (host, _settings) {
  let settings = {...defaultSettings, ..._settings, host}
  _validateSettings(settings)

  //  Debug
  const _debug = D('dnsmq-messagebus:externalnode')
  const _debugHeartbeat = D('dnsmq-messagebus:externalnode:heartbeat')
  const debug = (...args) => _debug(_name, ...args)

  let node = new EventEmitter()

  let { externalUpdatesPort } = settings

  // Private API
  let _id = `EX-${uuid.v4()}`
  let _name = nodeIdToName(_id)
  let _connected = false
  let _seeking = false
  let _connectedMaster = false
  let _checkHearbeatInterval
  let _lastHeartbeatReceivedTime = 0

  let _subscribedChannels = []
  let _intPub = zmq.socket('pub')
  let _intSub = zmq.socket('sub')
  _intPub.monitor()
  _intSub.monitor()
  _intSub.subscribe('heartbeats')
  _intSub.on('message', (channelBuffer, ...argsBuffers) => {
    _lastHeartbeatReceivedTime = Date.now()

    let channel = channelBuffer.toString()
    let args = argsBuffers.map(buffer => buffer.toString())

    if (channel === 'heartbeats') {
      _debugHeartbeat('')
      return
    }

    if (channel === 'newMaster') {
      let newMaster = JSON.parse(args[0])
      debug(`Received notice of new master: ${newMaster.name}`)
      _connectToMaster(newMaster)
      return
    }

    node.emit(channel, ...args)
  })

  let _connectToMasterPub = (master) => new Promise((resolve, reject) => {
    _intSub.on('connect', (ep) => {
      console.log(ep)
      debug(`Connected to master ${master.name} PUB socket`)
      resolve()
    })
    _intSub.connect(master.endpoint.pub)
  })
  let _connectToMasterSub = (master) => new Promise((resolve, reject) => {
    _intPub.on('connect', (ep) => {
      console.log(ep)
      debug(`Connected to master ${master.name} SUB socket`)
      resolve()
    })
    _intPub.connect(master.endpoint.sub)
  })
  let _disconnectFromMasterPub = (master) => new Promise((resolve, reject) => {
    _intSub.on('disconnect', (ep) => {
      console.log(ep)
      debug(`Disconnected from ${master.name} PUB socket`)
      resolve()
    })
    _intSub.disconnect(master.endpoint.pub)
  })
  let _disconnectFromMasterSub = (master) => new Promise((resolve, reject) => {
    _intPub.on('disconnect', (ep) => {
      console.log(ep)
      debug(`Disconnected from ${master.name} SUB socket`)
      resolve()
    })
    _intPub.disconnect(master.endpoint.sub)
  })

  let _checkHeartbeat = () => {
    let passedTime = Date.now() - _lastHeartbeatReceivedTime
    if (passedTime > HEARTBEAT_TIMEOUT) {
      debug('Missing master node')
      if (_connected) {
        _connected = false
        _intPub.disconnect()
        _intSub.disconnect()
        node.emit('disconnect')
      }
      _seekForMaster()
    }
  }
  let _monitorHeartbeats = () => {
    _checkHeartbeat()
    _unmonitorHeartbeats()
    _checkHearbeatInterval = setInterval(_checkHeartbeat, HEARTBEAT_INTERVAL_CHECK)
  }
  let _unmonitorHeartbeats = () => clearInterval(_checkHearbeatInterval)
  let _seekForMaster = () => {
    if (_seeking) return
    _seeking = true
    _unmonitorHeartbeats()

    debug(`Seeking for master node`)
    dns.resolve4(host, (err, addresses) => {
      if (err) {
        debug(`Cannot resolve host '${host}'. Check DNS infrastructure.`)
        return
      }
      let _foundMaster = false

      const _onMasterHeartbeat = (_, newMaster) => {
        _seeking = false
        _foundMaster = true
        _feelerSocket.close()

        debug(`Discovered master node ${newMaster.name}`)
        _lastHeartbeatReceivedTime = Date.now()
        _connectToMaster(newMaster)
      }

      setTimeout(() => {
        if (_foundMaster) return
        _seeking = false
        _feelerSocket.removeListener('message', _onMasterHeartbeat)
        _feelerSocket.close()
        debug(`Could not discover master node.`)
        node.emit('connection:failure')
        _monitorHeartbeats()
      }, HEARTBEAT_TIMEOUT)

      let _feelerSocket = zmq.socket('sub')
      _feelerSocket.subscribe('heartbeats')
      _feelerSocket.once('message', _onMasterHeartbeat)

      addresses.forEach(address => {
        _feelerSocket.connect(`tcp://${address}:${externalUpdatesPort}`)
      })
    })
  }
  let _connectToMaster = (masterNode) => {
    debug(`Connecting to master node: ${masterNode.name}`)
    _unmonitorHeartbeats()
    let connected = Promise.all([
      _connectToMasterPub(masterNode),
      _connectToMasterSub(masterNode)
    ])

    let disconnected = Promise.resolve()
    if (_connectedMaster) {
      disconnected = Promise.all([
        _disconnectFromMasterPub(_connectedMaster),
        _disconnectFromMasterSub(_connectedMaster)
      ])
    }

    return Promise.all([
      connected,
      disconnected
    ])
    .then(() => {
      _lastHeartbeatReceivedTime = Date.now()
      if (!_connected) {
        _connected = true
        debug(`CONNECTED`)
        node.emit('connect')
      } else {
        debug('CHANGED MASTER')
        node.emit('changedMaster')
      }
    })
    .catch(() => {})
    .then(() => {
      _monitorHeartbeats()
    })
  }

  // Public API
  function connect () {
    debug('Connecting...')
    _monitorHeartbeats()
  }
  function disconnect () {
    debug('Disconnecting...')
    _unmonitorHeartbeats()
    if (_intPub) _intPub.close()
    if (_intSub) _intSub.close()

    _intPub = null
    _intSub = null
    node.emit('disconnect')
  }
  function publish (channel, ...args) {
    if (~internalEventsChannels.indexOf(channel)) {
      console.warn(`dnsmq-messagebus:externalnode Channel '${channel}' is used internally and you cannot publish in it.`)
      return node
    }
    if (!_intPub) {
      console.warn(`dnsmq-messagebus:externalnode Node is not connected.`)
      return node
    }
    _intPub.send([channel, ...args])
    return node
  }
  function subscribe (channels) {
    if (!isArray(channels)) channels = [channels]
    if (!every(channels, isString)) throw new TypeError(invariantMessage('subscribe channels must be represented by strings'))

    channels.forEach(channel => {
      if (~internalEventsChannels.indexOf(channel)) {
        console.warn(`Channel '${channel}' is used internally and you cannot subscribe to it.`)
        return
      }
      if (_intSub) _intSub.subscribe(channel)
      if (!~_subscribedChannels.indexOf(channel)) {
        _subscribedChannels.push(channel)
      }
    })
  }
  function unsubscribe (channels) {
    if (!isArray(channels)) channels = [channels]
    if (!every(channels, isString)) throw new TypeError(invariantMessage('subscribe channels must be represented by strings'))

    channels.forEach(channel => {
      if (~internalEventsChannels.indexOf(channel)) {
        console.warn(`Channel '${channel}' is used internally and you cannot unsubscribe from it.`)
        return
      }
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
      get: () => EXTERNAL_NODE,
      set: () => console.warn(invariantMessage('You cannot change the .type of a dnsNode instance'))
    },
    connected: {
      get: () => _connected,
      set: () => console.warn(invariantMessage('You cannot manually change the .connected status of a dnsNode instance'))
    },
    master: {
      get: () => _connectedMaster ? {..._connectedMaster} : undefined,
      set: () => console.warn(invariantMessage('You cannot manually change the .master reference of a dnsNode instance'))
    },
    connect: {value: connect},
    disconnect: {value: disconnect},
    publish: {value: publish},
    subscribe: {value: subscribe},
    unsubscribe: {value: unsubscribe}
  })
}

let defaultSettings = {
  externalUpdatesPort: 50081
}

function _validateSettings (settings) {
  const {
    host,
    externalUpdatesPort
  } = settings

  // Settings validation
  if (!host || !isString(host)) throw new TypeError(ctorMessage('host is mandatory and should be a string.'))
  if (!isInteger(externalUpdatesPort) || externalUpdatesPort <= 0) throw new TypeError(ctorMessage('settings.externalUpdatesPort should be a positive integer.'))
}

export default ExternalNode
