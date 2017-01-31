import D from 'debug'
import dns from 'dns'
import zmq from 'zeromq'
import EventEmitter from 'eventemitter3'

import { HEARTBEAT_TIMEOUT } from './Constants'

/**
 * MasterFinder factory
 *
 * @param {object} node - The dnsNode using this component
 *
 * @return {object} masterFinder component
 */
function MasterFinder (node) {
  let resolver = new EventEmitter()

  //  Debug
  const _debug = D('dnsmq-messagebus:masterfinder')
  const debug = (...args) => _debug(node.name, ...args)

  let _findingMaster = false

  /**
   * Connects to the coordination socket of all the reachable dnsNodes
   * to ask for the current master
   * Resolves as soon as it receives the first answer from a dnsNode
   * @alias resolve
   * @return {promise} An object containing the name and the pub/sub endpoints of the master node
   */
  function findMaster () {
    if (_findingMaster) return _findingMaster
    _findingMaster = new Promise((resolve, reject) => {
      let { host, coordinationPort } = node.settings
      debug(`seeking for master node at host '${host}'`)

      let resolveStart = Date.now()
      dns.resolve4(host, (err, addresses) => {
        if (err) {
          debug(`cannot resolve host '${host}'. Check DNS infrastructure.`)
          _findingMaster = false
          return reject(err)
        }
        debug(`resolved IP(s) for host '${host}' in ${Date.now() - resolveStart} ms`)

        let _resolved = false

        const onMasterFound = (master) => {
          if (_resolved) return
          _resolved = true

          _findingMaster = false

          debug(`discovered master node ${master.name}`)
          resolve(master)
        }
        const onTimeout = () => {
          if (_resolved) return
          _resolved = true

          _findingMaster = false

          debug(`failed to discover master node`)
          reject()
        }

        debug(`trying to get master coordinates from ${addresses.length} nodes`)
        addresses.forEach(address => {
          let messenger = zmq.socket('req')
          messenger.connect(`tcp://${address}:${coordinationPort}`)
          messenger.send(JSON.stringify({
            type: 'masterRequest',
            toAddress: address,
            from: node.name
          }))

          let _resolved = false
          const onEnd = (msgBuffer) => {
            if (_resolved) return
            _resolved = true
            messenger.removeListener('message', onEnd)
            messenger.close()

            let master = msgBuffer && JSON.parse(msgBuffer)
            if (master) onMasterFound(master)
          }
          messenger.once('message', onEnd)
          setTimeout(onEnd, HEARTBEAT_TIMEOUT)
        })

        setTimeout(onTimeout, HEARTBEAT_TIMEOUT)
      })
    })
    return _findingMaster
  }

  return Object.defineProperties(resolver, {
    isResolving: {get: () => !!_findingMaster},
    resolve: {value: findMaster}
  })
}

export default MasterFinder
