import zmq from 'zeromq'

function ExternalNodesUpdater (settings) {
  let updater = {}

  let {
    externalUpdatesPort
  } = settings

  let _pub

  function bind () {
    if (_pub) return
    _pub = zmq.socket('pub')
    _pub.bindSync(`tcp://0.0.0.0:${externalUpdatesPort}`)
  }
  function unbind () {
    if (!_pub) return
    _pub.close()
    _pub = null
  }
  function publish (channel, ...args) {
    if (!_pub) return
    _pub.send([channel, ...args])
  }

  return Object.defineProperties(updater, {
    bind: {value: bind},
    unbind: {value: unbind},
    publish: {value: publish}
  })
}

export default ExternalNodesUpdater
