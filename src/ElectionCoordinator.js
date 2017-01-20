import util from 'util'
import zmq from 'zeromq'
import dns from 'dns'
import EventEmitter from 'eventemitter3'

function ElectionCoordinator (host, node, masterBroker, settings) {
  let instance = this instanceof ElectionCoordinator
  if (!instance) return new ElectionCoordinator(host, node, masterBroker, settings)

  let coordinator = this

  // Emitter inheritance
  EventEmitter.call(this)

  // Private API
  let _voting = false
  let _electionCaller = false
  let _master = false
  let _masterCandidate = false
  let _intCmd = zmq.socket('router')
  _intCmd.on('message', _onCoordinationMessage)

  function _broadcastMessage (type, data) {
    data = data || {}
    let message = JSON.stringify({type, data})
    dns.resolve4(host, (err, addresses) => {
      if (err) return
      addresses.forEach(address => {
        let messenger = zmq.socket('req')
        messenger.connect(`tcp://${address}:${settings.coordinationPort}`)
        messenger.send(message)

        let _end = false
        function closeSocket () {
          if (_end) return
          _end = true
          messenger.close()
        }

        messenger.on('message', closeSocket)
        setTimeout(closeSocket, 300)
      })
    })
  }
  function _onCoordinationMessage (messenger, _, msgBuffer) {
    let message = JSON.parse(msgBuffer)
    switch (message.type) {
      case 'electionStart':
        _voting = true
        node.debug(`Master election: candidating...`)
        _broadcastMessage('electionMasterCandidate', {
          id: node.id,
          endpoints: masterBroker.endpoints,
          isMaster: _master && _master.id === node.id
        })
        break
      case 'electionMasterCandidate':
        if (_electionCaller) {
          node.debug(`Master election: candidate ${message.data.id}.${message.data.isMaster ? ' Is master.' : ''}`)
          if (!_masterCandidate) {
            _masterCandidate = message.data
            return
          }
          if (message.data.isMaster) {
            if (_masterCandidate.isMaster) {
              _masterCandidate = _masterCandidate.id < message.data.id
                                  ? _masterCandidate
                                  : message.data
            } else {
              _masterCandidate = message.data
            }
          } else {
            if (_masterCandidate.isMaster) {
              _masterCandidate = _masterCandidate
            } else {
              _masterCandidate = _masterCandidate.id < message.data.id
                                  ? _masterCandidate
                                  : message.data
            }
          }
        }
        break
      case 'electionWinner':
        _voting = false
        if (!_master || _master.id !== message.data.newMaster.id) {
          _master = message.data.newMaster
          coordinator.emit('newMaster', _master)
        } else {
          node.debug(`Master election: confirmed master ${_master.id}`)
        }
    }
    _intCmd.send([messenger, _, ''])
  }

  // Public API
  function bind () {
    _intCmd.bindSync(`tcp://0.0.0.0:${settings.coordinationPort}`)
  }
  function unbind () {
    _intCmd.unbindSync(`tcp://0.0.0.0:${settings.coordinationPort}`)
  }
  function startElection () {
    if (_voting) return
    node.debug('Calling master election')
    _voting = true
    _electionCaller = true
    _broadcastMessage('electionStart')
    setTimeout(function () {
      let newMaster = {
        id: _masterCandidate.id,
        endpoints: _masterCandidate.endpoints
      }
      node.debug('Master election: time finished')
      node.debug(`Master election: winner is ${newMaster.id}`)
      node.debug(`${JSON.stringify(newMaster, null, 2)}`)
      _broadcastMessage('electionWinner', {newMaster})
      _electionCaller = false
      _masterCandidate = false
    }, settings.electionTimeout)
  }

  Object.defineProperty(coordinator, 'voting', {
    get: () => _voting,
    set: () => {}
  })

  Object.assign(coordinator, {
    bind,
    unbind,
    startElection
  })
}

util.inherits(ElectionCoordinator, EventEmitter)

export default ElectionCoordinator
