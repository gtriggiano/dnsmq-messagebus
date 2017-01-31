import D from 'debug'
import EventEmitter from 'eventemitter3'
import { isString, isInteger, isArray, every } from 'lodash'

import { EXTERNAL_NODE, DNS_NODE } from './Constants'
import MasterBroker from './MasterBroker'
import MasterElector from './MasterElector'
import MasterFinder from './MasterFinder'
import PubConnection from './PubConnection'
import SubConnection from './SubConnection'

import { nodeIdToName, getNodeId, prefixString } from './utils'

const ctorMessage = prefixString('[dnsmq-messagebus Node]: ')

let internalChannels = [
  'connect',
  'disconnect',
  'heartbeats',
  'newmaster'
]

/**
 * Node factory
 *
 * @param {string} host - The hostname which id DNS resolvable to the IPs of
 *                        the dnsNodes
 *
 * @return {object} [customSettings]
 */
function Node (host, customSettings) {
  let node = new EventEmitter()

  let _settings = {...defaultSettings, ...customSettings, host}
  _validateSettings(_settings)

  let _id = getNodeId(_settings)
  let _name = nodeIdToName(_id)
  let _active = false
  let _deactivating = false
  let _canPublish = false
  let _receiving = false
  let _master = null

  let { external } = _settings

  //  Debug
  const _debugStr = `dnsmq-messagebus:${external ? 'externalnode' : 'dnsnode'}`
  const _debug = D(_debugStr)
  const debug = (...args) => _debug(_name, ...args)

  /**
   * starts a master node resolution;
   * if a master node is found starts a connection to it
   */
  const _seekForMaster = () => {
    if (!_active || _masterResolver.isResolving) return
    _masterResolver
    .resolve()
    .then(_connectToMaster)
    .catch(() => {
      _seekForMaster()
    })
  }
  /**
   * starts a connection of the PUB and SUB interfaces
   * to a given master
   * @param  {string} id
   * @param  {string} name
   * @param  {object} endpoints
   */
  const _connectToMaster = ({id, name, endpoints}) => {
    if (!_active) return
    _master = {id, name, endpoints}
    _subConnection.connect({name, endpoint: endpoints.pub})
    _pubConnection.connect({name, endpoint: endpoints.sub})
    if (!external) {
      name === _name ? _masterBroker.startHeartbeats() : _masterBroker.stoptHeartbeats()
    }
  }

  /**
   * publish interface
   * @type {object}
   */
  let _pubConnection = PubConnection(node)
  _pubConnection.on('connect', () => {
    _canPublish = true
    node.emit('can:publish')
    if (_receiving) node.emit('ready')
  })
  _pubConnection.on('disconnect', () => {
    _canPublish = false
    node.emit('cannot:publish')
    if (_receiving) node.emit('not:ready')
  })

  /**
   * subscribe interface
   * @type {object}
   */
  let _subConnection = SubConnection(node)
  _subConnection.on('missingmaster', () => {
    _pubConnection.disconnect()
    _seekForMaster()
  })
  _subConnection.on('newmaster', _connectToMaster)
  _subConnection.on('connect', () => {
    _receiving = true
    node.emit('receiving')
    if (_canPublish) node.emit('ready')
  })
  _subConnection.on('disconnect', () => {
    _receiving = false
    _master = null
    node.emit('not:receiving')
    if (_canPublish) node.emit('not:ready')
  })

  /**
   * master resolution component
   * @type {object}
   */
  let _masterResolver

  /**
   * master broker component
   * The external nodes dont have this component
   * @type {object}
   */
  let _masterBroker

  if (!external) {
    _masterBroker = MasterBroker(node)
    _masterResolver = MasterElector(node, _masterBroker)
    _masterResolver.on('newmaster', _connectToMaster)
  } else {
    _masterResolver = MasterFinder(node)
  }

  /**
   * Activates the node
   * @return {object} node instance
   */
  function activate () {
    if (_active) return node
    _active = true
    debug('activated')

    if (!external) {
      _masterBroker.bind()
      _masterResolver.bind()
    }
    if (!node.isReady) _seekForMaster()
    return node
  }
  /**
   * Starts the node's deactivation routine
   * @return {object} node instance
   */
  function deactivate () {
    if (!_active || _deactivating) return node
    debug('deactivating')

    if (external) {
      _active = false
      _subConnection.disconnect()
      _pubConnection.disconnect()
    } else {
      _deactivating = true
      let ensuredMaster = Promise.resolve()

      const isMaster = _subConnection.master && _subConnection.master.name === _name

      if (isMaster) {
        debug(`I'm the master node. I will try to elect another master before disconnecting.`)

        let advertiseId = `zz-zzzzzzzz-${_id}`
        ensuredMaster = _masterResolver
                        .resolve(advertiseId)
                        .then(master => {
                          debug(`successfully elected a new master: ${master.name}`)
                          try {
                            _masterBroker.signalNewMaster(master)
                          } catch (e) {
                            console.log(e)
                          }
                        })
                        .catch(() => {
                          debug(`failed to elect a new master. Disconnecting anyway.`)
                        })
      }

      ensuredMaster
      .then(() => {
        _subConnection.disconnect()
        _pubConnection.disconnect()
        _masterResolver.unbind()
        let timeout = isMaster ? 1000 : 1
        setTimeout(() => {
          debug('deactivated')
          node.emit('deactivated')
          _masterBroker.unbind()
        }, timeout)
      })
    }

    return node
  }
  /**
   * Sends a message through the bus, published on a particular channel
   * @param  {string} channel
   * @param  {array} args
   * @return {object} node instance
   */
  function publish (channel, ...args) {
    if (!isString(channel)) throw new TypeError(`${_debugStr}: .publish(channel, [...args]) channel MUST be a string`)
    if (~internalChannels.indexOf(channel)) {
      console.warn(`${_debugStr} channel '${channel}' is used internally and you cannot publish in it`)
      return node
    }
    if (!_pubConnection.connected) {
      console.warn(`${_debugStr} cannot publish on bus.`)
      return node
    }
    _pubConnection.publish(channel, ...args)
    return node
  }
  /**
   * Subscribes the node to the provided channels
   * @param  {string|array<string>} channels
   * @return {object} node instance
   */
  function subscribe (channels) {
    if (!isArray(channels)) channels = [channels]
    if (!every(channels, isString)) throw new TypeError(`${_debugStr}: .subscribe([...channels]) channels must be represented by strings`)

    channels.forEach(channel => {
      if (~internalChannels.indexOf(channel)) {
        console.warn(`${_debugStr} channel '${channel}' is used internally and you cannot subscribe to it.`)
        return
      }
      _subConnection.subscribe([channel])
    })
    return node
  }
  /**
   * Unsubscribes the node from the provided channels
   * @param  {string|array<string>} channels
   * @return {object} node instance
   */
  function unsubscribe (channels) {
    if (!isArray(channels)) channels = [channels]
    if (!every(channels, isString)) throw new TypeError(`${_debugStr}: .unsubscribe([channels]) channels must be represented by strings`)

    channels.forEach(channel => {
      if (~internalChannels.indexOf(channel)) {
        console.warn(`${_debugStr} channel '${channel}' is used internally and you cannot unsubscribe from it.`)
        return
      }
      _subConnection.unsubscribe([channel])
    })
    return node
  }

  return Object.defineProperties(node, {
    id: {get: () => _id},
    name: {get: () => _name},
    settings: {get: () => ({..._settings})},
    type: {get: () => external ? EXTERNAL_NODE : DNS_NODE},
    canPublish: {get: () => _pubConnection.connected},
    isReceiving: {get: () => _subConnection.connected},
    isReady: {get: () => _pubConnection.connected && _subConnection.connected},
    subscribedChannels: {get: () => _subConnection.subscribedChannels},
    master: {get: () => _master},
    activate: {value: activate},
    deactivate: {value: deactivate},
    publish: {value: publish},
    subscribe: {value: subscribe},
    ubsubscribe: {value: unsubscribe}
  })
}

const defaultSettings = {
  external: false,
  voteTimeout: 50,
  electionPriority: 0,
  coordinationPort: 50061
}

/**
 * Validates a map of node settings
 * @param  {object} settings
 */
function _validateSettings (settings) {
  let {
    host,
    external,
    voteTimeout,
    electionPriority,
    coordinationPort
  } = settings

  if (!host || !isString(host)) throw new TypeError(ctorMessage('host is mandatory and should be a string.'))

  if (!isInteger(coordinationPort) || coordinationPort <= 0) throw new TypeError(ctorMessage('settings.coordinationPort should be a positive integer.'))

  if (!external) {
    if (!isInteger(voteTimeout) || voteTimeout <= 0) throw new TypeError(ctorMessage('settings.voteTimeout should be a positive integer.'))
    if (!isInteger(electionPriority) || electionPriority < 0 || electionPriority > 99) throw new TypeError(ctorMessage('settings.electionPriority should be an integer between 0 and 99.'))
  }
}

export default Node
