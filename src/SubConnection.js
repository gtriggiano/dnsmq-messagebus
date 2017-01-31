import D from 'debug'
import zmq from 'zeromq'
import EventEmitter from 'eventemitter3'
import { pullAll } from 'lodash'

import { HEARTBEAT_TIMEOUT, HEARTBEAT_INTERVAL_CHECK } from './Constants'
import { timingoutCallback } from './utils'

/**
 * Subscribing connection factory
 * @param {object} node - The node using this component
 *
 * @return {object} subscribeConnection component
 */
function SubConnection (node) {
  let connection = new EventEmitter()

  const _debug = D('dnsmq-messagebus:SUB')
  const _debugHeartbeat = D('dnsmq-messagebus:SUB:heartbeats')
  const debug = (...args) => _debug(node.name, ...args)
  const debugHearbeat = (masterName) => _debugHeartbeat(`signal from ${masterName}`)

  let _socket = null
  let _connectingMaster = null
  let _lastHeartbeatReceivedTime = 0
  let _hearbeatMonitorInterval = null
  let _subscribedChannels = []
  let _lastMessageNumberByPublisher = {}

  /**
   * Provides a sub socket connecting to master.endpoint
   * and subscribed to `heartbeats` and `newmaster` channel
   * @private
   * @param  {object} master - Map of properties about the actual master node
   * @return {object} A `zeromq` socket
   */
  const _getSocket = (master) => {
    let socket = zmq.socket('sub')
    socket._master = master
    socket.subscribe('heartbeats')
    socket.subscribe('newmaster')
    socket.monitor(5, 0)
    socket.connect(master.endpoint)
    return socket
  }
  /**
   * receives the arguments of the active sub socket `message` events
   * handles messages on the `heartbeats` and `newmaster` channels and
   * proxyes the others to the node emitter;
   * dedupes messages using their uid
   * @param  {[type]} channelBuffer [description]
   * @param  {[type]} argsBuffers   [description]
   * @return {[type]}               [description]
   */
  const _onSocketMessage = (channelBuffer, ...argsBuffers) => {
    _lastHeartbeatReceivedTime = Date.now()
    let channel = channelBuffer.toString()
    let args = argsBuffers.map(buffer => buffer.toString())

    switch (channel) {
      case 'heartbeats':
        debugHearbeat(args[0])
        break
      case 'newmaster':
        let newMaster = JSON.parse(args[0])
        debug(`received notice of new master: ${newMaster.name}`)
        connection.emit('newmaster', newMaster)
        break
      default:
        let [publisher, numStr] = args[0].split('_')
        let num = parseInt(numStr, 10)
        if (
          _lastMessageNumberByPublisher[publisher] &&
          _lastMessageNumberByPublisher[publisher] >= num
        ) { return }

        _lastMessageNumberByPublisher[publisher] = num
        node.emit(channel, ...args.slice(1))
    }
  }
  /**
   * check the time passed from the last bit received from
   * the master node.
   * if time > TIMEOUT emits `missingmaster` on subscribeConnection
   */
  const _verifyHeartbeatTime = () => {
    let silenceTime = Date.now() - _lastHeartbeatReceivedTime
    if (silenceTime > HEARTBEAT_TIMEOUT) {
      debug('missing master node')
      disconnect()
      connection.emit('missingmaster')
    }
  }
  /**
   * starts to execute `_verifyHeartbeatTime` at regular intervals
   */
  const _monitorHeartbeats = () => {
    _unmonitorHeartbeats()
    _hearbeatMonitorInterval = setInterval(_verifyHeartbeatTime, HEARTBEAT_INTERVAL_CHECK)
  }
  /**
   * stops the periodical execution of `_verifyHeartbeatTime`
   */
  const _unmonitorHeartbeats = () => {
    clearInterval(_hearbeatMonitorInterval)
    _hearbeatMonitorInterval = null
  }

  /**
   * creates a new sub socket and tries to connect it to the provided master;
   * after connection the socket is used to receive messages from the bus
   * and an eventual previous socket is closed
   * @param  {object} master
   * @return {object} the subscribeConnection instance
   */
  function connect (master) {
    if (_socket && _socket._master.name === master.name) {
      debug(`already connected to master ${master.name}`)
      return
    }
    if (_connectingMaster && _connectingMaster.name === master.name) {
      debug(`already connecting to master ${master.name}`)
      return
    }

    _connectingMaster = master
    let newSocket = _getSocket(master)

    debug(`connecting to ${master.name} at ${master.endpoint}`)

    let connectionStart = Date.now()
    const onSocketReceiving = timingoutCallback((err, ...args) => {
      newSocket.unmonitor()

      if (
        err ||
        !_connectingMaster ||
        _connectingMaster.name === !master.name
      ) {
        newSocket.close()
        if (err) {
          debug(`failed to connect to ${master.name} at ${master.endpoint}`)
          disconnect()
        }
        return
      }

      _connectingMaster = null
      let previousSocket = _socket

      debug(`${previousSocket ? 'switched' : 'connected'} to ${master.name} at ${master.endpoint} in ${Date.now() - connectionStart} ms`)

      if (args.length) {
        _onSocketMessage(...args)
      }

      _socket = newSocket
      _socket.removeAllListeners()
      _subscribedChannels.forEach(channel => _socket.subscribe(channel))
      _socket.on('message', _onSocketMessage)
      _lastHeartbeatReceivedTime = Date.now()
      _monitorHeartbeats()

      if (previousSocket) {
        setTimeout(() => {
          previousSocket.removeAllListeners()
          previousSocket.close()
          debug(`closed previous connection to ${previousSocket._master.name} at ${previousSocket._master.endpoint}`)
        }, 300)
      } else {
        connection.emit('connect')
      }
    }, 500)

    newSocket.once('connect', () => onSocketReceiving())
    newSocket.once('message', (...args) => onSocketReceiving(null, ...args))
    return connection
  }
  /**
   * if present, closes the sub socket
   * @return {object} the subscribeConnection instance
   */
  function disconnect () {
    _connectingMaster = null
    _unmonitorHeartbeats()
    if (_socket) {
      _socket.close()
      _socket = null
      debug('disconnected')
      connection.emit('disconnect')
    }
    return connection
  }
  /**
   * subscribes the component to the passed channels
   * @param  {[string]} channels
   * @return {object} the subscribeConnection instance
   */
  function subscribe (channels) {
    channels.forEach(channel => {
      if (~_subscribedChannels.indexOf(channel)) return
      _subscribedChannels.push(channel)
      if (_socket) _socket.subscribe(channel)
    })
    return connection
  }
  /**
   * unsubscribes the component from the passed channels
   * @param  {[string]} channels
   * @return {object} the subscribeConnection instance
   */
  function unsubscribe (channels) {
    pullAll(_subscribedChannels, channels)
    if (_socket) channels.forEach(channel => _socket.unsubscribe(channel))
    return connection
  }
  /**
   * unsubscribes the component from every channel
   * @return {object} the subscribeConnection instance
   */
  function flushSubscriptions () {
    unsubscribe(_subscribedChannels)
    return connection
  }

  return Object.defineProperties(connection, {
    connected: {get: () => !!_socket},
    master: {get: () => _socket && {..._socket._master}},
    subscribedChannels: {get: () => _subscribedChannels.slice()},
    connect: {value: connect},
    disconnect: {value: disconnect},
    subscribe: {value: subscribe},
    unsubscribe: {value: unsubscribe},
    flushSubscriptions: {value: flushSubscriptions}
  })
}

export default SubConnection
