import zmq from 'zmq'

function ExternalNodesUpdater (settings) {
  let _bound = false
  let _pub = zmq.socket('pub')

  let updater = {
    bind () {
      if (_bound) return
      _pub.bindSync(`tcp://0.0.0.0:${settings.externalUpdatesPort}`)
      _bound = true
    },
    unbind () {
      if (!_bound) return
      _pub.unbindSync(`tcp://0.0.0.0:${settings.externalUpdatesPort}`)
      _bound = false
    },
    publish (channel, ...args) {
      if (!_bound) return
      _pub.send([channel, ...args])
    }
  }

  return updater
}

export default ExternalNodesUpdater
