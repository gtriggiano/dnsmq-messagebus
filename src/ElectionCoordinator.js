import zmq from 'zeromq'
import dns from 'dns'
import EventEmitter from 'eventemitter3'

import { nodeIdToName } from './utils'

function ElectionCoordinator (_settings) {
  let {
    host,
    coordinationPort,
    electionTimeout,
    node,
    masterBroker,
    debug
  } = _settings

  let coordinator = new EventEmitter()

  // Private API
  let _voting = false
  let _electionCaller = false
  let _master = false
  let _masterCandidate = false
  let _intCmd = zmq.socket('router')
  _intCmd.on('message', _onCoordinationMessage)

  function _broadcastMessage (type, data) {
    data = data || {}
    let message = {type, data}
    dns.resolve4(host, (err, addresses) => {
      if (err) return
      addresses.forEach(address => {
        let messenger = zmq.socket('req')
        messenger.connect(`tcp://${address}:${coordinationPort}`)
        messenger.send(JSON.stringify({
          ...message,
          toAddress: address
        }))

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

    masterBroker.setIP(message.toAddress)

    switch (message.type) {
      case 'electionStart':
        _voting = true
        debug(`Master election: candidating...`)
        _broadcastMessage('electionMasterCandidate', {
          id: node.id,
          endpoints: masterBroker.endpoints,
          isMaster: _master && _master.id === node.id
        })
        break
      case 'electionMasterCandidate':
        if (_electionCaller) {
          debug(`Master election: candidate ${nodeIdToName(message.data.id)}.${message.data.isMaster ? ' Is master.' : ''}`)
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
            if (!_masterCandidate.isMaster) {
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
          coordinator.emit('newMaster', {
            ..._master,
            name: nodeIdToName(_master.id)
          })
        } else {
          debug(`Master election: confirmed master ${nodeIdToName(_master.id)}`)
        }
    }
    _intCmd.send([messenger, _, ''])
  }

  // Public API
  function bind () {
    _intCmd.bindSync(`tcp://0.0.0.0:${coordinationPort}`)
  }
  function unbind () {
    _intCmd.unbindSync(`tcp://0.0.0.0:${coordinationPort}`)
  }
  function startElection () {
    if (_voting) return
    debug('Calling master election')
    _voting = true
    _electionCaller = true
    _broadcastMessage('electionStart')
    setTimeout(function () {
      let newMaster = {
        id: _masterCandidate.id,
        endpoints: _masterCandidate.endpoints
      }
      debug('Master election: time finished')
      debug(`Master election: winner is ${nodeIdToName(newMaster.id)} ${JSON.stringify(newMaster, null, 2)}`)
      _broadcastMessage('electionWinner', {newMaster})
      _electionCaller = false
      _masterCandidate = false
    }, electionTimeout)
  }

  return Object.defineProperties(coordinator, {
    voting: {
      get: () => _voting
    },
    bind: {value: bind},
    unbind: {value: unbind},
    startElection: {value: startElection}
  })
}

export default ElectionCoordinator
