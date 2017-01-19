import D from 'debug'
import util from 'util'
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

let internalEventsChannels = ['connect', 'disconnect', 'connection:failure', 'heartbeats']

let defaultSettings = {
  externalUpdatesPort: 50081
}

function ExternalNode (host, _settings) {
  let instance = this instanceof ExternalNode
  if (!instance) return new ExternalNode(host, _settings)

  let node = this

  // Settings
  let settings = Object.assign({}, defaultSettings, _settings)
  let { externalUpdatesPort } = settings

  // Settings validation
  if (!host || !isString(host)) throw new TypeError(ctorMessage('host is mandatory and should be a string.'))
  if (!isInteger(externalUpdatesPort) || externalUpdatesPort <= 0) throw new TypeError(ctorMessage('settings.externalUpdatesPort should be a positive integer.'))

  // Emitter inheritance
  EventEmitter.call(this)

  // Private API
  let _id = `EX-${uuid.v4()}`
  let _name = nodeIdToName(_id)
  let _connected = false
  let _seeking = false
  let _connectedMaster = {}
  let _checkHearbeatInterval
  let _lastHeartbeatReceivedTime = 0
  let _subscribedChannels = []
  let _intPub
  let _intSub
  let _checkHeartbeat = () => {
    let passedTime = Date.now() - _lastHeartbeatReceivedTime
    if (passedTime > HEARTBEAT_TIMEOUT) {
      node.debug('Missing master...')
      if (_connected) {
        _connected = false
        node.emit('disconnect')
      }
      _seekForMaster()
    }
  }
  let _seekForMaster = () => {
    if (_seeking) return
    _seeking = true
    dns.resolve4(host, (err, addresses) => {
      if (err) return
      let _updating = zmq.socket('sub')
      let _exit = false
      let _onHeartbeatReceived = (channelBuffer, ...argsBuffers) => {
        _seeking = false
        let args = argsBuffers.map(buffer => buffer.toString())
        let master = JSON.parse(args[0])
        _connectedMaster = master
        _connectToMaster()
        _updating.close()
        _exit = true
      }
      _updating.subscribe('heartbeats')
      _updating.once('message', _onHeartbeatReceived)
      setTimeout(function () {
        if (_exit) return
        _seeking = false
        _updating.removeListener('message', _onHeartbeatReceived)
        _updating.close()
        node.emit('connection:failure')
      }, HEARTBEAT_TIMEOUT)

      addresses.forEach(address => {
        _updating.connect(`tcp://${address}:${settings.externalUpdatesPort}`)
      })
    })
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
    _lastHeartbeatReceivedTime = Date.now()

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
        } else {
          _connectedMaster = master
          _connectToMaster()
        }
        return
      }
      node.emit(channel, ...args)
    })
  }

  // Public API
  function connect () {
    node.debug('Connecting...')
    _checkHeartbeat()
    _checkHearbeatInterval = setInterval(_checkHeartbeat, HEARTBEAT_INTERVAL_CHECK)
  }
  function disconnect () {
    node.debug('Disconnecting...')
    clearInterval(_checkHearbeatInterval)
    if (_intPub) _intPub.close()
    if (_intSub) _intSub.close()

    _intPub = null
    _intSub = null
    node.emit('disconnect')
  }
  function publish (channel, ...args) {
    if (~internalEventsChannels.indexOf(channel)) return
    if (_intPub) {
      _intPub.send([channel, ...args])
    }
  }
  function subscribe (channels) {
    if (!isArray(channels)) channels = [channels]
    if (!every(channels, isString)) throw new TypeError(invariantMessage('subscribe channels must be represented by strings'))

    channels.forEach(channel => {
      if (~internalEventsChannels.indexOf(channel)) return
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
      if (~internalEventsChannels.indexOf(channel)) return
      if (_intSub) _intSub.unsubscribe(channel)
      let index = _subscribedChannels.indexOf(channel)
      if (index >= 0) {
        _subscribedChannels.splice(index, 1)
      }
    })
  }

  //  Debug
  const debug = D('dnsmq-messagebus:externalnode')
  node.debug = (...args) => debug(_name, ...args)

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
    get: () => EXTERNAL_NODE,
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
    unsubscribe
  })
}

util.inherits(ExternalNode, EventEmitter)

export default ExternalNode
