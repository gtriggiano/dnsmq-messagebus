import D from 'debug'
import zmq from 'zeromq'
import EventEmitter from 'eventemitter3'
import { uniqueId } from 'lodash'

import { timingoutCallback } from './utils'

/**
 * Publishing connection factory
 * @param {object} node - The node using this component
 *
 * @return {object} publishConnection component
 */
function PubConnection (node) {
  let connection = new EventEmitter()

  const _debug = D('dnsmq-messagebus:PUB')
  const debug = (...args) => _debug(node.name, ...args)

  let _socket = null
  let _connectingMaster = null

  /**
   * Provides a pub socket connecting to master.endpoint
   * @private
   * @param  {object} master - Map of properties about the actual master node
   * @return {object} A `zeromq` socket
   */
  const _getSocket = (master) => {
    let socket = zmq.socket('pub')
    socket._master = master
    socket.monitor(5, 0)
    socket.connect(master.endpoint)
    return socket
  }
  const _publishStream = new EventEmitter()
  _publishStream.on('message', (...args) => {
    if (_socket) _socket.send(args)
  })

  /**
   * creates a new pub socket and tries to connect it to the provided master;
   * after connection the socket is used to publish messages in the bus
   * and an eventual previous socket is closed
   * @param  {object} master
   * @return {object} the publishConnection instance
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

    let _messagesToResend = []
    let _onMessagePublished = (...args) => {
      if (_socket) _messagesToResend.push(args)
    }
    _publishStream.on('message', _onMessagePublished)

    debug(`connecting to ${master.name} at ${master.endpoint}`)

    let connectionStart = Date.now()
    const onSocketConnected = timingoutCallback((err) => {
      _publishStream.removeListener('message', _onMessagePublished)
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

      _socket = newSocket

      let totalMessagesToResend = _messagesToResend.length
      if (totalMessagesToResend) {
        debug(`resending ${totalMessagesToResend} messages published while transitioning`)
        _messagesToResend.forEach(message => _socket.send(message))
      }

      if (previousSocket) {
        previousSocket.close()
        debug(`closed previous connection to ${previousSocket._master.name} at ${previousSocket._master.endpoint}`)
      } else {
        connection.emit('connect')
      }
    }, 500)

    newSocket.once('connect', () => onSocketConnected())
    return connection
  }
  /**
   * if present, closes the pub socket
   * @return {object} the publishConnection instance
   */
  function disconnect () {
    _connectingMaster = null
    if (_socket) {
      _socket.close()
      _socket = null
      debug('disconnected')
      connection.emit('disconnect')
    }
    return connection
  }
  /**
   * takes a list of strings|buffers to publish as message's frames
   * in the channel passed as first argument
   * @param  {string} channel
   * @param  {[string|buffer]} args
   */
  function publish (channel, ...args) {
    _publishStream.emit('message', channel, uniqueId(`${node.name}_`), ...args)
  }

  return Object.defineProperties(connection, {
    connected: {get: () => !!_socket},
    master: {get: () => _socket && {..._socket._master}},
    connect: {value: connect},
    disconnect: {value: disconnect},
    publish: {value: publish}
  })
}

export default PubConnection
