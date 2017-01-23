'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _dns = require('dns');

var _dns2 = _interopRequireDefault(_dns);

var _uuid = require('uuid');

var _uuid2 = _interopRequireDefault(_uuid);

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

var _lodash = require('lodash');

var _eventemitter = require('eventemitter3');

var _eventemitter2 = _interopRequireDefault(_eventemitter);

var _NodeTypes = require('./NodeTypes');

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

const HEARTBEAT_INTERVAL_CHECK = 400;
const HEARTBEAT_TIMEOUT = 1500;
const ctorMessage = (0, _utils.prefixString)('[ExternalNode constructor]: ');
const invariantMessage = (0, _utils.prefixString)('[ExternalNode Invariant]: ');

let internalEventsChannels = ['connect', 'disconnect', 'connection:failure', 'heartbeats'];

function ExternalNode(host, _settings) {
  let settings = _extends({}, defaultSettings, _settings, { host: host });
  _validateSettings(settings);

  //  Debug
  const _debug = (0, _debug3.default)('dnsmq-messagebus:externalnode');
  const _debugHeartbeat = (0, _debug3.default)('dnsmq-messagebus:externalnode:heartbeat');
  const debug = function debug() {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _debug.apply(undefined, [_name].concat(args));
  };

  let node = new _eventemitter2.default();

  let externalUpdatesPort = settings.externalUpdatesPort;

  // Private API

  let _id = `EX-${_uuid2.default.v4()}`;
  let _name = (0, _utils.nodeIdToName)(_id);
  let _connected = false;
  let _seeking = false;
  let _knownMaster = false;
  let _checkHearbeatInterval;
  let _lastHeartbeatReceivedTime = 0;
  let _subscribedChannels = [];
  let _intPub;
  let _intSub;
  let _checkHeartbeat = () => {
    let passedTime = Date.now() - _lastHeartbeatReceivedTime;
    if (passedTime > HEARTBEAT_TIMEOUT) {
      debug('Missing master node');
      _knownMaster = false;
      if (_connected) {
        _connected = false;
        node.emit('disconnect');
      }
      _seekForMaster();
    }
  };
  let _monitorHeartbeats = () => {
    _checkHeartbeat();
    _unmonitorHeartbeats();
    _checkHearbeatInterval = setInterval(_checkHeartbeat, HEARTBEAT_INTERVAL_CHECK);
  };
  let _unmonitorHeartbeats = () => clearInterval(_checkHearbeatInterval);
  let _seekForMaster = () => {
    if (_seeking) return;
    _seeking = true;
    _unmonitorHeartbeats();

    debug(`Seeking for master node`);
    _dns2.default.resolve4(host, (err, addresses) => {
      if (err) {
        debug(`Cannot resolve host '${host}'. Check DNS infrastructure.`);
        return;
      }
      let _foundMaster = false;

      const _onMasterHeartbeat = (_, masterJSON) => {
        _seeking = false;
        _foundMaster = true;
        _knownMaster = JSON.parse(masterJSON);
        _feelerSocket.close();

        debug(`Discovered master node ${_knownMaster.name}`);
        _lastHeartbeatReceivedTime = Date.now();
        _connectToMaster();
      };

      setTimeout(() => {
        if (_foundMaster) return;
        _seeking = false;
        _feelerSocket.removeListener('message', _onMasterHeartbeat);
        _feelerSocket.close();
        debug(`Could not discover master node.`);
        node.emit('connection:failure');
        _monitorHeartbeats();
      }, HEARTBEAT_TIMEOUT);

      let _feelerSocket = _zeromq2.default.socket('sub');
      _feelerSocket.subscribe('heartbeats');
      _feelerSocket.once('message', _onMasterHeartbeat);

      addresses.forEach(address => {
        _feelerSocket.connect(`tcp://${address}:${externalUpdatesPort}`);
      });
    });
  };
  let _connectToMaster = () => {
    let _newIntPub = _zeromq2.default.socket('pub');
    let _newIntSub = _zeromq2.default.socket('sub');

    let connections = 0;
    function attemptTransitionToConnected() {
      if (connections !== 2) return;
      _monitorHeartbeats();
      if (!_connected) {
        _connected = true;
        debug(`CONNECTED`);
        node.emit('connect');
      }
    }

    debug(`Connecting to master node: ${_knownMaster.name}`);

    _newIntPub.monitor();
    _newIntPub.on('connect', () => {
      debug(`Connected to master ${_knownMaster.name} SUB socket`);
      _newIntPub.unmonitor();
      if (_intPub) _intPub.close();
      _intPub = _newIntPub;
      connections++;
      attemptTransitionToConnected();
    });
    _newIntPub.connect(_knownMaster.endpoints.sub);

    _newIntSub.monitor();
    _newIntSub.on('connect', () => {
      debug(`Connected to master ${_knownMaster.name} PUB socket`);
      _newIntSub.unmonitor();
      if (_intSub) _intSub.close();
      _intSub = _newIntSub;
      connections++;
      attemptTransitionToConnected();
    });
    _newIntSub.subscribe('heartbeats');
    _subscribedChannels.forEach(channel => _newIntSub.subscribe(channel));
    _newIntSub.connect(_knownMaster.endpoints.pub);
    _newIntSub.on('message', function (channelBuffer) {
      for (var _len2 = arguments.length, argsBuffers = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
        argsBuffers[_key2 - 1] = arguments[_key2];
      }

      _lastHeartbeatReceivedTime = Date.now();

      let channel = channelBuffer.toString();
      let args = argsBuffers.map(buffer => buffer.toString());

      if (channel === 'heartbeats') {
        _debugHeartbeat('');
        return;
      }
      if (channel === 'newMaster') {
        let newMaster = JSON.parse(args[0]);
        _knownMaster = newMaster;
        debug(`Received notice of new master: ${_knownMaster.name}`);
        _connectToMaster();
        return;
      }
      node.emit.apply(node, [channel].concat(_toConsumableArray(args)));
    });
  };

  // Public API
  function connect() {
    debug('Connecting...');
    _monitorHeartbeats();
  }
  function disconnect() {
    debug('Disconnecting...');
    _unmonitorHeartbeats();
    if (_intPub) _intPub.close();
    if (_intSub) _intSub.close();

    _intPub = null;
    _intSub = null;
    node.emit('disconnect');
  }
  function publish(channel) {
    if (~internalEventsChannels.indexOf(channel)) {
      console.warn(`dnsmq-messagebus:externalnode Channel '${channel}' is used internally and you cannot publish in it.`);
      return node;
    }
    if (!_intPub) {
      console.warn(`dnsmq-messagebus:externalnode Node is not connected.`);
      return node;
    }

    for (var _len3 = arguments.length, args = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
      args[_key3 - 1] = arguments[_key3];
    }

    _intPub.send([channel].concat(args));
    return node;
  }
  function subscribe(channels) {
    if (!(0, _lodash.isArray)(channels)) channels = [channels];
    if (!(0, _lodash.every)(channels, _lodash.isString)) throw new TypeError(invariantMessage('subscribe channels must be represented by strings'));

    channels.forEach(channel => {
      if (~internalEventsChannels.indexOf(channel)) {
        console.warn(`Channel '${channel} is used internally and you cannot subscribe to it.'`);
        return;
      }
      if (_intSub) _intSub.subscribe(channel);
      if (!~_subscribedChannels.indexOf(channel)) {
        _subscribedChannels.push(channel);
      }
    });
  }
  function unsubscribe(channels) {
    if (!(0, _lodash.isArray)(channels)) channels = [channels];
    if (!(0, _lodash.every)(channels, _lodash.isString)) throw new TypeError(invariantMessage('subscribe channels must be represented by strings'));

    channels.forEach(channel => {
      if (~internalEventsChannels.indexOf(channel)) {
        console.warn(`Channel '${channel} is used internally and you cannot unsubscribe from it.'`);
        return;
      }
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
      get: () => _NodeTypes.EXTERNAL_NODE,
      set: () => console.warn(invariantMessage('You cannot change the .type of a dnsNode instance'))
    },
    connected: {
      get: () => _connected,
      set: () => console.warn(invariantMessage('You cannot manually change the .connected status of a dnsNode instance'))
    },
    master: {
      get: () => _knownMaster ? _extends({}, _knownMaster, {
        name: (0, _utils.nodeIdToName)(_knownMaster.id)
      }) : false,
      set: () => console.warn(invariantMessage('You cannot manually change the .master reference of a dnsNode instance'))
    },
    connect: { value: connect },
    disconnect: { value: disconnect },
    publish: { value: publish },
    subscribe: { value: subscribe },
    unsubscribe: { value: unsubscribe }
  });
}

let defaultSettings = {
  externalUpdatesPort: 50081
};

function _validateSettings(settings) {
  const host = settings.host,
        externalUpdatesPort = settings.externalUpdatesPort;

  // Settings validation

  if (!host || !(0, _lodash.isString)(host)) throw new TypeError(ctorMessage('host is mandatory and should be a string.'));
  if (!(0, _lodash.isInteger)(externalUpdatesPort) || externalUpdatesPort <= 0) throw new TypeError(ctorMessage('settings.externalUpdatesPort should be a positive integer.'));
}

exports.default = ExternalNode;