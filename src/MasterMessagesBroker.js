import D from 'debug'
import zmq from 'zeromq'

import { getSocketPort } from './utils'

const HEARTBEAT_INTERVAL = 500

function getSockets () {
  let _sub = zmq.socket('sub')
  let _pub = zmq.socket('pub')

  _sub.subscribe('')
  _sub.on('message', (...args) => _pub.send(args))
  return {sub: _sub, pub: _pub}
}

function MasterMessagesBroker (node) {
  let broker = {}

  //  Debug
  const _debug = D('dnsmq-messagebus:dnsnode:masterbroker')
  const _debugHeartbeat = D('dnsmq-messagebus:dnsnode:masterbroker:heartbeat')
  const debug = (...args) => _debug(node.name, ...args)

  function _sendHeartbeat () {
    if (!_bound) return
    _debugHeartbeat('')
    _pub.send(['heartbeats', ''])
  }

  // Private API
  let _ip
  let _sub
  let _pub
  let _bound
  let _subPort
  let _pubPort
  let _hearbeatInterval

  // Public API
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
  function unbind () {
    if (!_bound) return
    _sub.close()
    _pub.close()
    _subPort = null
    _pubPort = null
    _bound = false
  }
  function setIP (ip) {
    if (!_ip) {
      debug(`Discovered IP: ${ip}`)
      _ip = ip
    }
  }
  function signalNewMasterToExternalNodes (newMaster) {
    if (_bound) {
      debug(`Signaling new master to external nodes`)
      _pub.send(['newMaster', JSON.stringify(newMaster)])
    }
  }
  function startHeartbeats () {
    if (_hearbeatInterval) return
    debug('Starting heartbeats')
    _sendHeartbeat()
    _hearbeatInterval = setInterval(_sendHeartbeat, HEARTBEAT_INTERVAL)
  }
  function stoptHeartbeats () {
    if (!_hearbeatInterval) return
    debug('Stopping heartbeats')
    clearInterval(_hearbeatInterval)
    _hearbeatInterval = null
  }

  return Object.defineProperties(broker, {
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
    signalNewMasterToExternalNodes: {value: signalNewMasterToExternalNodes},
    startHeartbeats: {value: startHeartbeats},
    stoptHeartbeats: {value: stoptHeartbeats}
  })
}

export default MasterMessagesBroker
