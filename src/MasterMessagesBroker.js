import zmq from 'zeromq'

import { nodeIdToName, getSocketPort } from './utils'

const HEARTBEAT_INTERVAL = 500

function getSockets () {
  let _sub = zmq.socket('sub')
  let _pub = zmq.socket('pub')

  _sub.subscribe('')
  _sub.on('message', (...args) => _pub.send(args))
  return {sub: _sub, pub: _pub}
}

function MasterMessagesBroker ({id}) {
  let _ip
  let _sub
  let _pub
  let _bound
  let _subPort
  let _pubPort
  let _hearbeatInterval

  function _sendHeartbeat () {
    if (!_bound) return
    _pub.send(['heartbeats', JSON.stringify({
      name: nodeIdToName(id),
      endpoints: broker.endpoints
    })])
  }

  let broker = {
    bind () {
      if (_bound) return
      let {sub, pub} = getSockets()
      sub.bindSync(`tcp://0.0.0.0:*`)
      pub.bindSync(`tcp://0.0.0.0:*`)
      _sub = sub
      _pub = pub
      _subPort = getSocketPort(_sub)
      _pubPort = getSocketPort(_pub)
      _bound = true
    },
    unbind () {
      if (!_bound) return
      _sub.close()
      _pub.close()
      _subPort = null
      _pubPort = null
      _bound = false
    },
    startHeartbeats () {
      if (_hearbeatInterval) return
      _sendHeartbeat()
      _hearbeatInterval = setInterval(_sendHeartbeat, HEARTBEAT_INTERVAL)
    },
    stoptHeartbeats () {
      clearInterval(_hearbeatInterval)
      _hearbeatInterval = null
    }
  }

  return Object.defineProperties(broker, {
    setIP: {
      value: (ip) => {
        _ip = _ip || ip
      }
    },
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
    }
  })
}

export default MasterMessagesBroker
