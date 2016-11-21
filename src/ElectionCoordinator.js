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
  let _master = {}
  let _masterCandidate = {}
  let _lastCandidateIsMaster = false
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
        node.debug(`Master election: voting...`)
        _broadcastMessage('electionMasterCandidate', {
          lastMaster: _master,
          masterCandidate: {id: node.id, endpoints: masterBroker.endpoints}
        })
        break
      case 'electionMasterCandidate':
        if (_electionCaller) {
          if (message.data.masterCandidate.id < _masterCandidate.id) _masterCandidate = message.data.masterCandidate
          if (!_master.id) _master = message.data.lastMaster
          if (_masterCandidate.id === _master.id) _lastCandidateIsMaster = true
        }
        break
      case 'electionWinner':
        _master = message.data.newMaster
        _voting = false
        coordinator.emit('newMaster', _master)
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
    _masterCandidate = {id: node.id, endpoints: masterBroker.endpoints}
    _lastCandidateIsMaster = false
    _broadcastMessage('electionStart')
    setTimeout(function () {
      node.debug('Master election time finished')
      if (_master.id !== _masterCandidate.id && !_lastCandidateIsMaster) {
        _master = _masterCandidate
        _broadcastMessage('electionWinner', {
          newMaster: _masterCandidate
        })
      } else {
        _broadcastMessage('electionWinner', {
          newMaster: _master
        })
      }
      node.debug(`Master election: winner ${_master.id}`)
      _electionCaller = false
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
