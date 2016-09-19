import util from 'util'
import dns from 'dns'
import uuid from 'uuid'
import zmq from 'zmq'
import { isString, isInteger, isArray, every } from 'lodash'
import EventEmitter from 'eventemitter3'

import { EXTERNAL_NODE } from './NodeTypes'

import { nodeIdToName, prefixString, debugLog, zeropad } from './utils'

const HEARTBEAT_INTERVAL_CHECK = 400
const HEARTBEAT_TIMEOUT = 1500
const ctorMessage = prefixString('[ExternalNode constructor]: ')
const invariantMessage = prefixString('[ExternalNode Invariant]: ')

let defaultSettings = {
  debug: false,
  externalUpdatesPort: 50081
}

function ExternalNode (host, _settings) {
  let instance = this instanceof ExternalNode
  if (!instance) return new ExternalNode(host, _settings)

  let node = this

  // Settings
  let settings = Object.assign({}, defaultSettings, _settings)
  let {
    debug,
    externalUpdatesPort
  } = settings

  // Settings validation
  if (!host || !isString(host)) throw new TypeError(ctorMessage('host is mandatory and should be a string.'))
  if (!isInteger(externalUpdatesPort) || externalUpdatesPort <= 0) throw new TypeError(ctorMessage('settings.externalUpdatesPort should be a positive integer.'))

  // Emitter inheritance
  EventEmitter.call(this)

  // Private API
  let _id = uuid.v4()
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
      _seekForMaster()
    }
  }
  let _seekForMaster = () => {
    if (_seeking) return
    _seeking = true
    dns.resolve4(host, (err, addresses) => {
      if (err) return
      let _updating = zmq.socket('sub')
      _updating.subscribe('heartbeats')
      _updating.on('message', (channelBuffer, ...argsBuffers) => {
        _seeking = false
        let args = argsBuffers.map(buffer => buffer.toString())
        let master = JSON.parse(args[0])
        _connectedMaster = master
        _connectToMaster()
        _updating.close()
      })

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
  function unsubscribe (channels) {
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
  node.debug = debugLog(`[External Node ${_name}]: `, debug)

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

//
// import allPortsAreValid from './helpers/allPortsAreValid'
// import { parsePayload, messageToPayloadCurried } from './helpers/messages'
//
// const ctorMessage = prefix('[MessageBus.ExternalNode constructor]: ')
//
// let resolveHostname = Promise.promisify(dns.resolve4)
//
// let defaultSettings = {
//   debug: false,
//   discoveryInterval: 1000,
//   publishPort: 50171,
//   subscribePort: 50161
// }
//
// let _privateEventNames = []
//
// function ExternalNode (options) {
//   let node = this
//   node.id = uuid.v4()
//
//   let {
//     host,
//     debug,
//     discoveryInterval,
//     publishPort,
//     subscribePort
//   } = options
//
//   // Options validation
//   if (!host || !isString(host)) throw new Error(ctorMessage('options.host is mandatory and should be a string'))
//   if (!isInteger(discoveryInterval) || discoveryInterval < 100) throw new Error(ctorMessage('options.discoveryInterval should be an integer >= 100'))
//   if (!allPortsAreValid([
//     publishPort,
//     subscribePort
//   ])) throw new Error(ctorMessage('ports options should be unique integers'))
//
//   // Warnings
//   if (discoveryInterval < 500) console.warn(ctorMessage('setting discoveryInterval to less than 0.5s could impact performance'))
//
//   // Utils
//   let log = prefixedLog(`[MessageBus External Node ${node.id.substring(0, 8)}]: `, debug)
//   let messageToPayload = messageToPayloadCurried(node)
//
//   // Internal Emitter
//   let _internalEmitter = new EventEmitter()
//
//   // ZMQ sockets
//   let _publishSocket = zmq.socket('pub')
//   let _subscribeSocket = zmq.socket('sub')
//   _subscribeSocket.subscribe('messagePayload')
//   _subscribeSocket.subscribe('disconnection')
//
//   // States
//   let _connecting = false
//
//   // Connected DNS Peer
//   let _connectedPeer = false
//
//   // Instance decoration
//   Object.assign(node, {
//     on,
//     addListener: on,
//     once,
//     off,
//     removeListener: off,
//     connect,
//     disconnect,
//     publish
//   })
//
//   // Public API
//   function connect () {
//     if (_connectedPeer || _connecting) return node
//     _connecting = true
//     resolveHostname(host)
//       .then(ipList => {
//         if (!_connecting || !ipList.length) return
//         let peerIp = sample(ipList)
//         connectToPeer(peerIp)
//       })
//       .catch(e => {
//         _connecting = false
//         _internalEmitter.emit('error', e)
//         _internalEmitter.emit('error:dns', e)
//       })
//     return node
//   }
//   function disconnect () {
//     _connecting = false
//     return disconnectFromPeer(_connectedPeer)
//   }
//   function on (evtName, listener) {
//     evtName = ~_privateEventNames.indexOf(evtName) ? 'nothappening' : evtName
//     _internalEmitter.on(evtName, listener)
//     return node
//   }
//   function once (evtName, listener) {
//     evtName = ~_privateEventNames.indexOf(evtName) ? 'nothappening' : evtName
//     _internalEmitter.once(evtName, listener)
//     return node
//   }
//   function off (evtName, listener) {
//     _internalEmitter.removeListener(evtName, listener)
//     return node
//   }
//   function publish (message) {
//     if (!_connectedPeer) return node
//     message = isString(message) ? message : JSON.stringify(message)
//     _publishSocket.send('messages', JSON.stringify({
//       senderId: node.id,
//       message
//     }))
//     return node
//   }
//
//   // Internal API
//   function connectToPeer (peerIp) {
//     if (_connectedPeer) return node
//     _publishSocket.connect(`tcp://${peerIp}:${publishPort}`)
//     _subscribeSocket.connect(`tcp://${peerIp}:${subscribePort}`)
//     _connectedPeer = peerIp
//     _connecting = false
//
//     console.log('Connected to peer ', peerIp)
//     _internalEmitter.emit('connection', peerIp)
//     _connectedPeerCheckInterval = setInterval(function () {
//       resolveHostname(host)
//         .then(ipList => {
//           if (
//             _connectedPeer &&
//             !~ipList.indexOf(_connectedPeer)
//           ) {
//             console.log(`Peer ${_connectedPeer} is no more in the cluster...`)
//             disconnectFromPeer()
//             let newPeer = sample(ipList)
//             if (newPeer) {
//               connectToPeer(newPeer)
//             } else {
//               console.log(`There are no other peers to connect`)
//             }
//           }
//         })
//         .catch(() => {})
//     }, 1000)
//
//     return node
//   }
//   function disconnectFromPeer () {
//     if (!_connectedPeer) return node
//     _publishSocket.disconnect(`tcp://${_connectedPeer}:${publishPort}`)
//     _subscribeSocket.disconnect(`tcp://${_connectedPeer}:${subscribePort}`)
//     _connectedPeer = false
//     console.log('Disconnected from peer ', _connectedPeer)
//     _internalEmitter.emit('disconnection', _connectedPeer)
//     clearInterval(_connectedPeerCheckInterval)
//     return node
//   }
//
//   /**
//    * Routines
//    */
//
//   // Dispatch the bus messages coming from DNS peers
//   _subscribeSocket.on('messagePayload', (messagePayload) => {
//     let payload = parsePayload(messagePayload)
//     // Dispatch message to listeners
//     _internalEmitter.emit('message', payload.message)
//     if (payload.sourceId !== node.id) {
//       // Dispatch to listeners of the channel transmitting only messages produced by other nodes
//       _internalEmitter.emit('message:from:peer', payload.message)
//     }
//   })
//   _subscribeSocket.on('disconnection', (alternativePeersPayload) => {
//     let alternativePeers = JSON.parse(alternativePeersPayload)
//
//   })
// }
//
// ExternalNode.defaultSettings = defaultSettings
//
// export default ExternalNode
