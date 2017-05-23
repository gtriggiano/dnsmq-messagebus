'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _eventemitter = require('eventemitter3');

var _eventemitter2 = _interopRequireDefault(_eventemitter);

var _lodash = require('lodash');

var _Constants = require('./Constants');

var _MasterBroker = require('./MasterBroker');

var _MasterBroker2 = _interopRequireDefault(_MasterBroker);

var _MasterElector = require('./MasterElector');

var _MasterElector2 = _interopRequireDefault(_MasterElector);

var _MasterFinder = require('./MasterFinder');

var _MasterFinder2 = _interopRequireDefault(_MasterFinder);

var _PubConnection = require('./PubConnection');

var _PubConnection2 = _interopRequireDefault(_PubConnection);

var _SubConnection = require('./SubConnection');

var _SubConnection2 = _interopRequireDefault(_SubConnection);

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const ctorMessage = (0, _utils.prefixString)('[dnsmq-messagebus Node]: ');

let internalChannels = ['ready', 'not:ready', 'can:publish', 'cannot:publish', 'receiving', 'not:receiving', 'deactivated', 'heartbeats', 'newmaster'];

/**
 * Node factory
 *
 * @param {string} host - The hostname which id DNS resolvable to the IPs of
 *                        the dnsNodes
 *
 * @return {object} [customSettings]
 */
function Node(host, customSettings) {
  let node = new _eventemitter2.default();

  let _settings = _extends({}, defaultSettings, customSettings, { host: host });
  _validateSettings(_settings);

  let _id = (0, _utils.getNodeId)(_settings);
  let _name = (0, _utils.nodeIdToName)(_id);
  let _active = false;
  let _deactivating = false;
  let _canPublish = false;
  let _receiving = false;
  let _master = null;

  let external = _settings.external;

  //  Debug

  const _debugStr = `dnsmq-messagebus:${external ? 'externalnode' : 'dnsnode'}`;
  const _debug = (0, _debug3.default)(_debugStr);
  const debug = function debug() {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _debug.apply(undefined, [_name].concat(args));
  };

  /**
   * starts a master node resolution;
   * if a master node is found starts a connection to it
   */
  const _seekForMaster = () => {
    if (!_active || _masterResolver.isResolving) return;
    _masterResolver.resolve().then(_connectToMaster).catch(() => {
      _seekForMaster();
    });
  };
  /**
   * starts a connection of the PUB and SUB interfaces
   * to a given master
   * @param  {string} id
   * @param  {string} name
   * @param  {object} endpoints
   */
  const _connectToMaster = (_ref) => {
    let id = _ref.id,
        name = _ref.name,
        endpoints = _ref.endpoints;

    if (!_active) return;
    _master = { id: id, name: name, endpoints: endpoints };
    _subConnection.connect({ name: name, endpoint: endpoints.pub });
    _pubConnection.connect({ name: name, endpoint: endpoints.sub });
    if (!external) {
      name === _name ? _masterBroker.startHeartbeats() : _masterBroker.stoptHeartbeats();
    }
  };

  /**
   * publish interface
   * @type {object}
   */
  let _pubConnection = (0, _PubConnection2.default)(node);
  _pubConnection.on('connect', () => {
    _canPublish = true;
    node.emit('can:publish');
    if (_receiving) node.emit('ready');
  });
  _pubConnection.on('disconnect', () => {
    _canPublish = false;
    node.emit('cannot:publish');
    if (_receiving) node.emit('not:ready');
  });

  /**
   * subscribe interface
   * @type {object}
   */
  let _subConnection = (0, _SubConnection2.default)(node);
  _subConnection.on('missingmaster', () => {
    _pubConnection.disconnect();
    _seekForMaster();
  });
  _subConnection.on('newmaster', _connectToMaster);
  _subConnection.on('connect', () => {
    _receiving = true;
    node.emit('receiving');
    if (_canPublish) node.emit('ready');
  });
  _subConnection.on('disconnect', () => {
    _receiving = false;
    _master = null;
    node.emit('not:receiving');
    if (_canPublish) node.emit('not:ready');
  });

  /**
   * master resolution component
   * @type {object}
   */
  let _masterResolver;

  /**
   * master broker component
   * The external nodes dont have this component
   * @type {object}
   */
  let _masterBroker;

  if (!external) {
    _masterBroker = (0, _MasterBroker2.default)(node);
    _masterResolver = (0, _MasterElector2.default)(node, _masterBroker);
    _masterResolver.on('newmaster', _connectToMaster);
  } else {
    _masterResolver = (0, _MasterFinder2.default)(node);
  }

  /**
   * Activates the node
   * @return {object} node instance
   */
  function activate() {
    if (_active) return node;
    _active = true;
    debug('activated');

    if (!external) {
      _masterBroker.bind();
      _masterResolver.bind();
    }
    if (!node.isReady) _seekForMaster();
    return node;
  }
  /**
   * Starts the node's deactivation routine
   * @return {object} node instance
   */
  function deactivate() {
    if (!_active || _deactivating) return node;
    debug('deactivating');

    if (external) {
      _active = false;
      _subConnection.disconnect();
      _pubConnection.disconnect();
      node.emit('deactivated');
    } else {
      _deactivating = true;
      let ensuredMaster = Promise.resolve();

      const isMaster = _subConnection.master && _subConnection.master.name === _name;

      if (isMaster) {
        debug(`I'm the master node. I will try to elect another master before disconnecting.`);

        let advertiseId = `zz-zzzzzzzz-${_id}`;
        ensuredMaster = _masterResolver.resolve(advertiseId).then(master => {
          debug(`successfully elected a new master: ${master.name}`);
          try {
            _masterBroker.signalNewMaster(master);
          } catch (e) {
            console.log(e);
          }
        }).catch(() => {
          debug(`failed to elect a new master. Disconnecting anyway.`);
        });
      }

      ensuredMaster.then(() => {
        _subConnection.disconnect();
        _pubConnection.disconnect();
        _masterResolver.unbind();
        let timeout = isMaster ? 1000 : 1;
        setTimeout(() => {
          debug('deactivated');
          node.emit('deactivated');
          _masterBroker.unbind();
        }, timeout);
      });
    }

    return node;
  }
  /**
   * Sends a message through the bus, published on a particular channel
   * @param  {string} channel
   * @param  {array} args
   * @return {object} node instance
   */
  function publish(channel) {
    if (!(0, _lodash.isString)(channel)) throw new TypeError(`${_debugStr}: .publish(channel, [...args]) channel MUST be a string`);
    if (~internalChannels.indexOf(channel)) {
      console.warn(`${_debugStr} channel '${channel}' is used internally and you cannot publish in it`);
      return node;
    }
    if (!_pubConnection.connected) {
      console.warn(`${_debugStr} cannot publish on bus.`);
      return node;
    }

    for (var _len2 = arguments.length, args = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
      args[_key2 - 1] = arguments[_key2];
    }

    _pubConnection.publish.apply(_pubConnection, [channel].concat(args));
    return node;
  }
  /**
   * Subscribes the node to the provided channels
   * @param  {string|array<string>} channels
   * @return {object} node instance
   */
  function subscribe(channels) {
    if (!(0, _lodash.isArray)(channels)) channels = [channels];
    if (!(0, _lodash.every)(channels, _lodash.isString)) throw new TypeError(`${_debugStr}: .subscribe([...channels]) channels must be represented by strings`);

    channels.forEach(channel => {
      if (~internalChannels.indexOf(channel)) {
        console.warn(`${_debugStr} channel '${channel}' is used internally and you cannot subscribe to it.`);
        return;
      }
      _subConnection.subscribe([channel]);
    });
    return node;
  }
  /**
   * Unsubscribes the node from the provided channels
   * @param  {string|array<string>} channels
   * @return {object} node instance
   */
  function unsubscribe(channels) {
    if (!(0, _lodash.isArray)(channels)) channels = [channels];
    if (!(0, _lodash.every)(channels, _lodash.isString)) throw new TypeError(`${_debugStr}: .unsubscribe([channels]) channels must be represented by strings`);

    channels.forEach(channel => {
      if (~internalChannels.indexOf(channel)) {
        console.warn(`${_debugStr} channel '${channel}' is used internally and you cannot unsubscribe from it.`);
        return;
      }
      _subConnection.unsubscribe([channel]);
    });
    return node;
  }

  return Object.defineProperties(node, {
    id: { get: () => _id },
    name: { get: () => _name },
    settings: { get: () => _extends({}, _settings) },
    type: { get: () => external ? _Constants.EXTERNAL_NODE : _Constants.DNS_NODE },
    canPublish: { get: () => _pubConnection.connected },
    isReceiving: { get: () => _subConnection.connected },
    isReady: { get: () => _pubConnection.connected && _subConnection.connected },
    subscribedChannels: { get: () => _subConnection.subscribedChannels },
    isMaster: { get: () => _master && _master.name === _name || false },
    master: { get: () => _master && _extends({}, _master, { endpoints: _extends({}, _master.endpoints) }) },
    activate: { value: activate },
    deactivate: { value: deactivate },
    publish: { value: publish },
    subscribe: { value: subscribe },
    unsubscribe: { value: unsubscribe }
  });
}

const defaultSettings = {
  external: false,
  voteTimeout: 50,
  electionPriority: 0,
  coordinationPort: 50061
};

/**
 * Validates a map of node settings
 * @param  {object} settings
 */
function _validateSettings(settings) {
  let host = settings.host,
      external = settings.external,
      voteTimeout = settings.voteTimeout,
      electionPriority = settings.electionPriority,
      coordinationPort = settings.coordinationPort;


  if (!host || !(0, _lodash.isString)(host)) throw new TypeError(ctorMessage('host is mandatory and should be a string.'));

  if (!(0, _lodash.isInteger)(coordinationPort) || coordinationPort <= 0) throw new TypeError(ctorMessage('settings.coordinationPort should be a positive integer.'));

  if (!external) {
    if (!(0, _lodash.isInteger)(voteTimeout) || voteTimeout <= 0) throw new TypeError(ctorMessage('settings.voteTimeout should be a positive integer.'));
    if (!(0, _lodash.isInteger)(electionPriority) || electionPriority < 0 || electionPriority > 99) throw new TypeError(ctorMessage('settings.electionPriority should be an integer between 0 and 99.'));
  }
}

exports.default = Node;