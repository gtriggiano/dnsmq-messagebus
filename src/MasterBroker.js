import D from 'debug'
import zmq from 'zeromq'

import { getSocketPort } from './utils'

import { HEARTBEAT_INTERVAL } from './Constants'

/**
 * Provides a pair of pub/sub sockets
 * Every message received by sub is re-emitted by pub
 * 'sub' subscribes to all events
 * 'pub' has a no linger period (discards messages as soon as socket.close())
 * @return {object} {pub, sub}
 */
function getSockets () {
  let _sub = zmq.socket('sub')
  let _pub = zmq.socket('pub')
  _pub.linger = 0

  _sub.subscribe('')
  _sub.on('message', (...args) => _pub.send(args))
  return {sub: _sub, pub: _pub}
}

/**
 * MasterBroker factory
 *
 * @param {object} node - The dnsNode using this component
 *
 * @return {object} masterBroker component
 */
function MasterBroker (node) {
  let broker = {}

  //  Debug
  const _debug = D('dnsmq-messagebus:masterbroker')
  const _debugHeartbeat = D('dnsmq-messagebus:masterbroker:heartbeats')
  const debug = (...args) => _debug(node.name, ...args)

  /**
   * sends an heartbeat to the subscribing sockets
   * @private
   */
  function _sendHeartbeat () {
    if (!_bound) return
    _debugHeartbeat('')
    _pub.send(['heartbeats', node.name])
  }

  // Private API
  let _ip
  let _sub
  let _pub
  let _bound
  let _subPort
  let _pubPort
  let _hearbeatInterval
  let _isMaster = false

  /**
   * binds a new pair of pub/sub sockets to all the
   * interfaces, on random ports
   * @return {[type]} [description]
   */
  function bind () {
    if (_bound) return
    let {sub, pub} = getSockets()
    sub.bindSync(`tcp://0.0.0.0:*`)
    pub.bindSync(`tcp://0.0.0.0:*`)
    _sub = sub
    _pub = pub
    _subPort = getSocketPort(_sub)
    _pubPort = getSocketPort(_pub)
    _bound = true
  }
  /**
   * unbinds the pub/sub sockets
   * @return {[type]} [description]
   */
  function unbind () {
    if (!_bound) return
    _sub.close()
    _pub.close()
    _subPort = null
    _pubPort = null
    _bound = false
    stoptHeartbeats()
  }
  /**
   * setter for the private var `_ip` (IP address)
   * sets `_ip` just once
   * @param {string} ip
   */
  function setIP (ip) {
    if (!_ip) {
      debug(`discovered own IP: ${ip}`)
      _ip = ip
    }
  }
  /**
   * sends a message to subscribing sockets
   * containing infos about a just elected master
   * @param  {object} newMasterInfos
   */
  function signalNewMaster (newMasterInfos) {
    if (_bound) {
      debug(`signaling new master to connected nodes`)
      _pub.send(['newmaster', JSON.stringify(newMasterInfos)])
    }
  }
  /**
   * starts the emission of heartbeats at regular intervals
   */
  function startHeartbeats () {
    _isMaster = true
    if (_hearbeatInterval) return
    debug('starting heartbeats')
    _sendHeartbeat()
    _hearbeatInterval = setInterval(_sendHeartbeat, HEARTBEAT_INTERVAL)
  }
  /**
   * stops the emission of heartbeats
   */
  function stoptHeartbeats () {
    _isMaster = false
    if (!_hearbeatInterval) return
    debug('stopping heartbeats')
    clearInterval(_hearbeatInterval)
    _hearbeatInterval = null
  }

  return Object.defineProperties(broker, {
    isMaster: {get: () => _isMaster},
    endpoints: {
      get: () => ({
        sub: _ip ? `tcp://${_ip}:${_subPort}` : undefined,
        pub: _ip ? `tcp://${_ip}:${_pubPort}` : undefined
      })
    },
    ports: {
      get: () => ({
        sub: _subPort,
        pub: _pubPort
      })
    },
    bind: {value: bind},
    unbind: {value: unbind},
    setIP: {value: setIP},
    signalNewMaster: {value: signalNewMaster},
    startHeartbeats: {value: startHeartbeats},
    stoptHeartbeats: {value: stoptHeartbeats}
  })
}

export default MasterBroker
