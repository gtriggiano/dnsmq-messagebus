'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

var _uuid = require('uuid');

var _uuid2 = _interopRequireDefault(_uuid);

var _lodash = require('lodash');

var _eventemitter = require('eventemitter3');

var _eventemitter2 = _interopRequireDefault(_eventemitter);

var _ElectionCoordinator = require('./ElectionCoordinator');

var _ElectionCoordinator2 = _interopRequireDefault(_ElectionCoordinator);

var _MasterMessagesBroker = require('./MasterMessagesBroker');

var _MasterMessagesBroker2 = _interopRequireDefault(_MasterMessagesBroker);

var _ExternalNodesUpdater = require('./ExternalNodesUpdater');

var _ExternalNodesUpdater2 = _interopRequireDefault(_ExternalNodesUpdater);

var _NodeTypes = require('./NodeTypes');

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

const HEARTBEAT_INTERVAL_CHECK = 500;
const HEARTBEAT_TIMEOUT = 1000;
const ctorMessage = (0, _utils.prefixString)('[DNSNode constructor]: ');
const invariantMessage = (0, _utils.prefixString)('[DNSNode Invariant]: ');

/**
 * DNS Node
 * @constructor
 * @param {Object} settings A map of settings
 *                            host
 *                            discoveryInterval
 *                            internalPublishPort
 *                            internalCommandPort
 *                            externalPublishPort
 *                            externalSubscribePort
 */
function DNSNode(host, _settings) {
  let settings = _extends({}, defaultSettings, _settings, { host: host });
  _validateSettings(settings);

  let node = new _eventemitter2.default();

  //  Debug
  const _debug = (0, _debug3.default)('dnsmq-messagebus:dnsnode');
  const _debugHeartbeat = (0, _debug3.default)('dnsmq-messagebus:dnsnode:masterheartbeat');
  const debug = function debug() {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _debug.apply(undefined, [_name].concat(args));
  };

  let externalUpdatesPort = settings.externalUpdatesPort,
      electionTimeout = settings.electionTimeout,
      electionPriority = settings.electionPriority,
      coordinationPort = settings.coordinationPort;

  // Private API

  let _id = `${(0, _utils.zeropad)(99 - electionPriority, 2)}-${_uuid2.default.v4()}`;
  let _name = (0, _utils.nodeIdToName)(_id);
  let _masterBroker = (0, _MasterMessagesBroker2.default)(node);
  let _nodesUpdater = (0, _ExternalNodesUpdater2.default)({ externalUpdatesPort: externalUpdatesPort });
  let _electionCoordinator = new _ElectionCoordinator2.default({
    host: host,
    coordinationPort: coordinationPort,
    electionTimeout: electionTimeout,
    node: node,
    masterBroker: _masterBroker,
    debug: debug
  });
  let _connected = false;
  let _connectedMaster = false;
  let _connectedMasterJSON = false;
  let _checkHearbeatInterval;
  let _lastHeartbeatReceivedTime = 0;
  let _subscribedChannels = [];
  let _intPub = false;
  let _intSub = false;
  let _checkHeartbeat = () => {
    let passedTime = Date.now() - _lastHeartbeatReceivedTime;
    if (passedTime > HEARTBEAT_TIMEOUT) {
      if (!_electionCoordinator.voting) {
        debug('Missing master...');
        _electionCoordinator.startElection();
      }
    }
  };
  let _monitorHeartbeats = () => {
    _checkHeartbeat();
    _unmonitorHeartbeats();
    _checkHearbeatInterval = setInterval(_checkHeartbeat, HEARTBEAT_INTERVAL_CHECK);
  };
  let _unmonitorHeartbeats = () => clearInterval(_checkHearbeatInterval);
  let _onMasterChange = newMaster => {
    _lastHeartbeatReceivedTime = Date.now();
    if (!_connected || newMaster.name !== _connectedMaster.name) {
      _connectedMaster = newMaster;
      _connectedMasterJSON = JSON.stringify(_connectedMaster);
      _connectToMaster();
    }
    if (newMaster.name === _name) {
      _masterBroker.startHeartbeats();
    } else {
      _masterBroker.stoptHeartbeats();
    }
  };
  let _connectToMaster = () => {
    let _newIntPub = _zeromq2.default.socket('pub');
    let _newIntSub = _zeromq2.default.socket('sub');

    let connections = 0;
    function attemptTransitionToConnected() {
      if (!_connected && connections === 2) {
        _connected = true;
        debug(`CONNECTED`);
        node.emit('connect');
      }
    }

    debug(`Connecting to new master: ${_connectedMaster.name}`);

    _newIntPub.monitor();
    _newIntPub.on('connect', () => {
      debug(`Connected to master ${_connectedMaster.name} SUB socket`);
      _newIntPub.unmonitor();
      if (_intPub) _intPub.close();
      _intPub = _newIntPub;
      connections++;
      attemptTransitionToConnected();
    });
    _newIntPub.connect(_connectedMaster.endpoints.sub);

    _newIntSub.monitor();
    _newIntSub.on('connect', () => {
      debug(`Connected to master ${_connectedMaster.name} PUB socket`);
      _newIntSub.unmonitor();
      if (_intSub) _intSub.close();
      _intSub = _newIntSub;
      connections++;
      attemptTransitionToConnected();
    });
    _newIntSub.subscribe('heartbeats');
    _subscribedChannels.forEach(channel => _newIntSub.subscribe(channel));
    _newIntSub.connect(_connectedMaster.endpoints.pub);
    _newIntSub.on('message', function (channelBuffer) {
      for (var _len2 = arguments.length, argsBuffers = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
        argsBuffers[_key2 - 1] = arguments[_key2];
      }

      _lastHeartbeatReceivedTime = Date.now();

      let channel = channelBuffer.toString();
      let args = argsBuffers.map(buffer => buffer.toString());

      if (channel === 'heartbeats') {
        _debugHeartbeat('');
        _nodesUpdater.publish('heartbeats', _connectedMasterJSON);
        return;
      }
      node.emit.apply(node, [channel].concat(_toConsumableArray(args)));
    });
  };
  let _teardown = () => {
    if (_intPub) _intPub.close();
    if (_intSub) _intSub.close();

    _intPub = null;
    _intSub = null;

    _masterBroker.stoptHeartbeats();
    _masterBroker.unbind();
    _nodesUpdater.unbind();
    _electionCoordinator.unbind();
    node.emit('disconnect');
  };

  // Public API
  function connect() {
    debug('Connecting...');
    _masterBroker.bind();
    _nodesUpdater.bind();
    _electionCoordinator.bind();
    _electionCoordinator.on('newMaster', _onMasterChange);
    _monitorHeartbeats();
  }
  function disconnect() {
    debug('Disconnecting...');
    _unmonitorHeartbeats();
    _electionCoordinator.removeListener('newMaster', _onMasterChange);

    if (_id !== _connectedMaster.id) return _teardown();

    debug(`I'm master. Trying to elect anotherone...`);
    // Change this node id to have the lowest election priority
    let _nodeId = _id;
    _id = `zzzzzz-${_id}`;

    function onMasterEelected(newMaster) {
      if (newMaster.id === _id) {
        debug('It seems this is the only DNS node in the cluster. Exiting enyway');
      } else {
        debug(`Successfully elected a new master: ${newMaster.name}`);
      }
      _id = _nodeId;
      _electionCoordinator.removeListener('newMaster', onMasterEelected);
      _nodesUpdater.publish('heartbeats', JSON.stringify(newMaster));
      setTimeout(_teardown, 10);
    }

    function onFailedElection() {
      _id = _nodeId;
      debug(`Election of a new master failed`);
      setTimeout(_teardown, 10);
    }

    _electionCoordinator.on('newMaster', onMasterEelected);
    _electionCoordinator.on('failedElection', onFailedElection);
    _electionCoordinator.startElection();
  }
  function publish(channel) {
    if (channel === 'heartbeats') return;
    if (_intPub) {
      for (var _len3 = arguments.length, args = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
        args[_key3 - 1] = arguments[_key3];
      }

      _intPub.send([channel].concat(args));
    }
  }
  function subscribe(channels) {
    if (!(0, _lodash.isArray)(channels)) channels = [channels];
    if (!(0, _lodash.every)(channels, _lodash.isString)) throw new TypeError(invariantMessage('subscribe channels must be represented by strings'));

    channels.forEach(channel => {
      if (_intSub) _intSub.subscribe(channel);
      if (!~_subscribedChannels.indexOf(channel)) {
        _subscribedChannels.push(channel);
      }
    });
  }
  function ubsubscribe(channels) {
    if (!(0, _lodash.isArray)(channels)) channels = [channels];
    if (!(0, _lodash.every)(channels, _lodash.isString)) throw new TypeError(invariantMessage('subscribe channels must be represented by strings'));

    channels.forEach(channel => {
      if (_intSub) _intSub.unsubscribe(channel);
      let index = _subscribedChannels.indexOf(channel);
      if (index >= 0) {
        _subscribedChannels.splice(index, 1);
      }
    });
  }

  return Object.defineProperties(node, {
    id: {
      get: () => _id,
      set: () => console.warn(invariantMessage('You cannot change the .id of a dnsNode instance'))
    },
    name: {
      get: () => _name,
      set: () => console.warn(invariantMessage('You cannot change the .name of a dnsNode instance'))
    },
    type: {
      get: () => _NodeTypes.DNS_NODE,
      set: () => console.warn(invariantMessage('You cannot change the .type of a dnsNode instance'))
    },
    connected: {
      get: () => _connected,
      set: () => console.warn(invariantMessage('You cannot manually change the .connected status of a dnsNode instance'))
    },
    master: {
      get: () => _connectedMaster,
      set: () => console.warn(invariantMessage('You cannot manually change the .master reference of a dnsNode instance'))
    },
    connect: { value: connect },
    disconnect: { value: disconnect },
    publish: { value: publish },
    subscribe: { value: subscribe },
    ubsubscribe: { value: ubsubscribe }
  });
}

let defaultSettings = {
  electionTimeout: 400,
  electionPriority: 0,
  coordinationPort: 50061,
  externalUpdatesPort: 50081
};

function _validateSettings(settings) {
  let host = settings.host,
      electionTimeout = settings.electionTimeout,
      electionPriority = settings.electionPriority,
      coordinationPort = settings.coordinationPort,
      externalUpdatesPort = settings.externalUpdatesPort;


  if (!host || !(0, _lodash.isString)(host)) throw new TypeError(ctorMessage('host is mandatory and should be a string.'));
  if (!(0, _lodash.isInteger)(coordinationPort) || coordinationPort <= 0) throw new TypeError(ctorMessage('settings.coordinationPort should be a positive integer.'));
  if (!(0, _lodash.isInteger)(electionTimeout) || electionTimeout <= 0) throw new TypeError(ctorMessage('settings.electionTimeout should be a positive integer.'));
  if (!(0, _lodash.isInteger)(electionPriority) || electionPriority < 0 || electionPriority > 99) throw new TypeError(ctorMessage('settings.electionPriority should be an integer between 0 and 99.'));
  if (!(0, _lodash.isInteger)(externalUpdatesPort) || externalUpdatesPort <= 0) throw new TypeError(ctorMessage('settings.externalUpdatesPort should be a positive integer.'));
  if (coordinationPort === externalUpdatesPort) throw new TypeError(ctorMessage('settings.coordinationPort and settings.externalUpdatesPort should be different.'));

  // Warnings
  if (electionTimeout < 400) console.warn(ctorMessage('setting electionTimeout to a low value requires a performant network to avoid members votes loss'));
}

exports.default = DNSNode;