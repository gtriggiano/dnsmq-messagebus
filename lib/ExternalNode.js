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

let internalEventsChannels = ['connect', 'disconnect', 'connection:failure', 'heartbeats', 'newMaster', 'changedMaster'];

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
  let _connectedMaster = false;
  let _checkHearbeatInterval;
  let _lastHeartbeatReceivedTime = 0;

  let _subscribedChannels = [];
  let _intPub = _zeromq2.default.socket('pub');
  let _intSub = _zeromq2.default.socket('sub');
  _intPub.monitor();
  _intSub.monitor();
  _intSub.subscribe('heartbeats');
  _intSub.on('message', function (channelBuffer) {
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
      debug(`Received notice of new master: ${newMaster.name}`);
      _connectToMaster(newMaster);
      return;
    }

    node.emit.apply(node, [channel].concat(_toConsumableArray(args)));
  });

  let _connectToMasterPub = master => new Promise((resolve, reject) => {
    _intSub.on('connect', ep => {
      console.log(ep);
      debug(`Connected to master ${master.name} PUB socket`);
      resolve();
    });
    _intSub.connect(master.endpoint.pub);
  });
  let _connectToMasterSub = master => new Promise((resolve, reject) => {
    _intPub.on('connect', ep => {
      console.log(ep);
      debug(`Connected to master ${master.name} SUB socket`);
      resolve();
    });
    _intPub.connect(master.endpoint.sub);
  });
  let _disconnectFromMasterPub = master => new Promise((resolve, reject) => {
    _intSub.on('disconnect', ep => {
      console.log(ep);
      debug(`Disconnected from ${master.name} PUB socket`);
      resolve();
    });
    _intSub.disconnect(master.endpoint.pub);
  });
  let _disconnectFromMasterSub = master => new Promise((resolve, reject) => {
    _intPub.on('disconnect', ep => {
      console.log(ep);
      debug(`Disconnected from ${master.name} SUB socket`);
      resolve();
    });
    _intPub.disconnect(master.endpoint.sub);
  });

  let _checkHeartbeat = () => {
    let passedTime = Date.now() - _lastHeartbeatReceivedTime;
    if (passedTime > HEARTBEAT_TIMEOUT) {
      debug('Missing master node');
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

      const _onMasterHeartbeat = (_, newMaster) => {
        _seeking = false;
        _foundMaster = true;
        _feelerSocket.close();

        debug(`Discovered master node ${newMaster.name}`);
        _lastHeartbeatReceivedTime = Date.now();
        _connectToMaster(newMaster);
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
  let _connectToMaster = masterNode => {
    debug(`Connecting to master node: ${masterNode.name}`);

    let connected = Promise.all([_connectToMasterPub(masterNode), _connectToMasterSub(masterNode)]);

    let disconnected = Promise.resolve();
    if (_connectedMaster) {
      disconnected = Promise.all([_disconnectFromMasterPub(_connectedMaster), _disconnectFromMasterSub(_connectedMaster)]);
    }

    return Promise.all([connected, disconnected]).then(() => {
      if (!_connected) {
        _connected = true;
        debug(`CONNECTED`);
        node.emit('connect');
      } else {
        debug('CHANGED MASTER');
        node.emit('changedMaster');
      }
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
        console.warn(`Channel '${channel}' is used internally and you cannot subscribe to it.`);
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
        console.warn(`Channel '${channel}' is used internally and you cannot unsubscribe from it.`);
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
      get: () => _connectedMaster ? _extends({}, _connectedMaster) : undefined,
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