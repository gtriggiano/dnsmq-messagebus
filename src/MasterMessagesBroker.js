import zmq from 'zeromq'

import { getSocketEndpoint } from './utils'

const HEARTBEAT_INTERVAL = 500

function getSockets () {
  let _sub = zmq.socket('sub')
  let _pub = zmq.socket('pub')

  _sub.subscribe('')
  _sub.on('message', (...args) => _pub.send(args))
  return {sub: _sub, pub: _pub}
}

function MasterMessagesBroker (id) {
  let _sub
  let _pub
  let _bound
  let _subAddress
  let _pubAddress
  let _hearbeatInterval

  function _sendHeartbeat () {
    if (!_bound) return
    _pub.send(['heartbeats', JSON.stringify({
      id,
      endpoints: {sub: _subAddress, pub: _pubAddress}
    })])
  }

  let broker = {
    bind () {
      if (_bound) return
      let {sub, pub} = getSockets()
      sub.bindSync('tcp://0.0.0.0:*')
      pub.bindSync('tcp://0.0.0.0:*')
      _sub = sub
      _pub = pub
      _subAddress = getSocketEndpoint(_sub)
      _pubAddress = getSocketEndpoint(_pub)
      _bound = true
    },
    unbind () {
      if (!_bound) return
      _sub.close()
      _pub.close()
      _subAddress = null
      _pubAddress = null
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

  Object.defineProperty(broker, 'endpoints', {
    get: () => ({sub: _subAddress, pub: _pubAddress}),
    set: () => {}
  })

  return broker
}

export default MasterMessagesBroker
