import D from 'debug'
import dns from 'dns'
import zmq from 'zeromq'
import EventEmitter from 'eventemitter3'
import { sortBy, compact } from 'lodash'

/**
 * MasterElector factory
 *
 * @param {object} node - The dnsNode using this component
 * @param {object} masterBroker - The masterMessagesBroker of the dnsNode  using this component
 *
 * @return {object} masterElector component
 */
function MasterElector (node, masterBroker) {
  let resolver = new EventEmitter()

  //  Debug
  const _debug = D('dnsmq-messagebus:masterelector')
  const debug = (...args) => _debug(node.name, ...args)

  let _electingMaster = false
  let _advertiseId = null

  let _inbox = zmq.socket('router')

  /**
   * function receiving the messages from the coordination router
   * @param  {buffer} sender
   * @param  {void} _
   * @param  {buffer} msgBuffer
   */
  function _onInboxMessage (sender, _, msgBuffer) {
    let message = JSON.parse(msgBuffer)
    masterBroker.setIP(message.toAddress)

    switch (message.type) {
      case 'voteRequest':
        debug(`sending vote to ${node.name === message.from ? 'myself' : message.from}`)
        _inbox.send([sender, _, JSON.stringify({
          id: _advertiseId || node.id,
          name: node.name,
          endpoints: masterBroker.endpoints,
          isMaster: masterBroker.isMaster,
          candidate: !_advertiseId
        })])
        break
      case 'masterRequest':
        let connectedMaster = node.master
        if (connectedMaster) {
          debug(`sending master coordinates to ${message.from}`)
          _inbox.send([sender, _, JSON.stringify(connectedMaster)])
        } else {
          debug(`unable to send master coordinates to ${message.from}`)
          _inbox.send([sender, _, JSON.stringify(false)])
        }
        break
      case 'masterElected':
        _inbox.send([sender, _, ''])
        debug(`received notice of master election: ${message.data.name}`)
        resolver.emit('newmaster', message.data)
    }
  }
  /**
   * broadcasts a message to the coordination socket of all the dnsNodes
   * @param  {string} type - Type of message
   * @param  {object} data - Payload of the message
   */
  function _broadcastMessage (type, data) {
    data = data || {}
    let message = {type, data}
    let { host, coordinationPort } = node.settings
    dns.resolve4(host, (err, addresses) => {
      if (err) {
        debug(`cannot resolve host '${host}'. Check DNS infrastructure.`)
        return
      }
      debug(`broadcasting message '${type}' to '${host}' nodes: ${addresses}`)
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
  /**
   * requests the voting identity of all the eligible dnsNodes
   * @return {promise} An list of objects representing nodes eligible as master
   */
  function _requestVotes () {
    let { host, coordinationPort } = node.settings
    let message = {
      type: 'voteRequest',
      data: {}
    }
    return new Promise((resolve, reject) => {
      let resolveStart = Date.now()
      dns.resolve4(host, (err, addresses) => {
        if (err) {
          debug(`cannot resolve host '${host}'. Check DNS infrastructure.`)
          return reject(err)
        }
        debug(`resolved IP(s) for host '${host}' in ${Date.now() - resolveStart} ms`)
        debug(`requesting votes from ${addresses.length} nodes`)
        Promise.all(
          addresses.map(address => new Promise((resolve, reject) => {
            let voteRequestTime = Date.now()
            let messenger = zmq.socket('req')
            messenger.connect(`tcp://${address}:${coordinationPort}`)
            messenger.send(JSON.stringify({
              ...message,
              toAddress: address,
              from: node.name
            }))

            let _resolved = false
            function onEnd (candidateBuffer) {
              if (_resolved) return
              _resolved = true
              messenger.removeListener('message', onEnd)
              messenger.close()

              let candidate = candidateBuffer && JSON.parse(candidateBuffer)
              if (candidate) {
                let elapsed = Date.now() - voteRequestTime
                candidate.candidate && debug(`received vote by ${candidate.name === node.name ? 'myself' : candidate.name}${candidate.isMaster ? ' (master)' : ''} in ${elapsed} ms`)
              } else {
                debug(`missed vote by peer at ${address}`)
              }
              resolve(candidate)
            }

            messenger.on('message', onEnd)
            setTimeout(onEnd, node.settings.voteTimeout)
          }))
        )
        .then(nodes => compact(nodes))
        .then(nodes => resolve(nodes.filter(({candidate}) => candidate)))
      })
    })
  }

  /**
   * Binds the coordination router socket to all interfaces
   * @return {object} masterElector
   */
  function bind () {
    _inbox.bindSync(`tcp://0.0.0.0:${node.settings.coordinationPort}`)
    _inbox.on('message', _onInboxMessage)
    return resolver
  }
  /**
   * Unbinds the coordination router socket from all interfaces
   * @return {object} masterElector
   */
  function unbind () {
    _inbox.unbindSync(`tcp://0.0.0.0:${node.settings.coordinationPort}`)
    _inbox.removeListener('message', _onInboxMessage)
    return resolver
  }
  /**
   * Triggers a master election
   * @param  {string} [advertiseId] - A fake id to use for this node during the election
   * @return {promise} An object containing the name and the pub/sub endpoints of the master node
   */
  function electMaster (advertiseId) {
    _advertiseId = advertiseId || null
    if (_electingMaster) return _electingMaster
    _electingMaster = _requestVotes()
                      .then(nodes => {
                        _electingMaster = false
                        _advertiseId = null
                        const masterNodes = nodes.filter(
                          ({isMaster}) => isMaster)
                        nodes = masterNodes.length ? masterNodes : nodes
                        const electedMaster = sortBy(nodes, ({id}) => id)[0]
                        if (!electedMaster) throw new Error('could not elect a master')

                        debug(`elected master: ${electedMaster.name} ${JSON.stringify(electedMaster.endpoints)}`)
                        _broadcastMessage('masterElected', electedMaster)
                        return electedMaster
                      })

    _electingMaster.catch(() => {
      _electingMaster = false
      _advertiseId = null
    })
    return _electingMaster
  }

  return Object.defineProperties(resolver, {
    bind: {value: bind},
    unbind: {value: unbind},
    isResolving: {get: () => !!_electingMaster},
    resolve: {value: electMaster}
  })
}

export default MasterElector
