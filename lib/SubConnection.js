'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

var _eventemitter = require('eventemitter3');

var _eventemitter2 = _interopRequireDefault(_eventemitter);

var _lodash = require('lodash');

var _Constants = require('./Constants');

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

/**
 * Subscribing connection factory
 * @param {object} node - The node using this component
 *
 * @return {object} subscribeConnection component
 */
function SubConnection(node) {
  let connection = new _eventemitter2.default();

  const _debug = (0, _debug3.default)('dnsmq-messagebus:SUB');
  const _debugHeartbeat = (0, _debug3.default)('dnsmq-messagebus:SUB:heartbeats');
  const debug = function debug() {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _debug.apply(undefined, [node.name].concat(args));
  };
  const debugHearbeat = masterName => _debugHeartbeat(`signal from ${masterName}`);

  let _socket = null;
  let _connectingMaster = null;
  let _lastHeartbeatReceivedTime = 0;
  let _hearbeatMonitorInterval = null;
  let _subscribedChannels = [];
  let _lastMessageNumberByPublisher = {};

  /**
   * Provides a sub socket connecting to master.endpoint
   * and subscribed to `heartbeats` and `newmaster` channel
   * @private
   * @param  {object} master - Map of properties about the actual master node
   * @return {object} A `zeromq` socket
   */
  const _getSocket = master => {
    let socket = _zeromq2.default.socket('sub');
    socket._master = master;
    socket.subscribe('heartbeats');
    socket.subscribe('newmaster');
    socket.monitor(5, 0);
    socket.connect(master.endpoint);
    return socket;
  };
  /**
   * receives the arguments of the active sub socket `message` events
   * handles messages on the `heartbeats` and `newmaster` channels and
   * proxyes the others to the node emitter;
   * dedupes messages using their uid
   * @param  {[type]} channelBuffer [description]
   * @param  {[type]} argsBuffers   [description]
   * @return {[type]}               [description]
   */
  const _onSocketMessage = function _onSocketMessage(channelBuffer) {
    for (var _len2 = arguments.length, argsBuffers = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
      argsBuffers[_key2 - 1] = arguments[_key2];
    }

    _lastHeartbeatReceivedTime = Date.now();
    let channel = channelBuffer.toString();
    let args = argsBuffers.map(buffer => buffer.toString());

    switch (channel) {
      case 'heartbeats':
        debugHearbeat(args[0]);
        break;
      case 'newmaster':
        let newMaster = JSON.parse(args[0]);
        debug(`received notice of new master: ${newMaster.name}`);
        connection.emit('newmaster', newMaster);
        break;
      default:
        var _args$0$split = args[0].split('_'),
            _args$0$split2 = _slicedToArray(_args$0$split, 2);

        let publisher = _args$0$split2[0],
            numStr = _args$0$split2[1];

        let num = parseInt(numStr, 10);
        if (_lastMessageNumberByPublisher[publisher] && _lastMessageNumberByPublisher[publisher] >= num) {
          return;
        }

        _lastMessageNumberByPublisher[publisher] = num;
        node.emit.apply(node, [channel].concat(_toConsumableArray(args.slice(1))));
    }
  };
  /**
   * check the time passed from the last bit received from
   * the master node.
   * if time > TIMEOUT emits `missingmaster` on subscribeConnection
   */
  const _verifyHeartbeatTime = () => {
    let silenceTime = Date.now() - _lastHeartbeatReceivedTime;
    if (silenceTime > _Constants.HEARTBEAT_TIMEOUT) {
      debug('missing master node');
      disconnect();
      connection.emit('missingmaster');
    }
  };
  /**
   * starts to execute `_verifyHeartbeatTime` at regular intervals
   */
  const _monitorHeartbeats = () => {
    _unmonitorHeartbeats();
    _hearbeatMonitorInterval = setInterval(_verifyHeartbeatTime, _Constants.HEARTBEAT_INTERVAL_CHECK);
  };
  /**
   * stops the periodical execution of `_verifyHeartbeatTime`
   */
  const _unmonitorHeartbeats = () => {
    clearInterval(_hearbeatMonitorInterval);
    _hearbeatMonitorInterval = null;
  };

  /**
   * creates a new sub socket and tries to connect it to the provided master;
   * after connection the socket is used to receive messages from the bus
   * and an eventual previous socket is closed
   * @param  {object} master
   * @return {object} the subscribeConnection instance
   */
  function connect(master) {
    if (_socket && _socket._master.name === master.name) {
      debug(`already connected to master ${master.name}`);
      return;
    }
    if (_connectingMaster && _connectingMaster.name === master.name) {
      debug(`already connecting to master ${master.name}`);
      return;
    }

    _connectingMaster = master;
    let newSocket = _getSocket(master);

    debug(`connecting to ${master.name} at ${master.endpoint}`);

    let connectionStart = Date.now();
    const onSocketReceiving = (0, _utils.timingoutCallback)(function (err) {
      for (var _len3 = arguments.length, args = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
        args[_key3 - 1] = arguments[_key3];
      }

      newSocket.unmonitor();

      if (err || !_connectingMaster || _connectingMaster.name === !master.name) {
        newSocket.close();
        if (err) {
          debug(`failed to connect to ${master.name} at ${master.endpoint}`);
          disconnect();
        }
        return;
      }

      _connectingMaster = null;
      let previousSocket = _socket;

      debug(`${previousSocket ? 'switched' : 'connected'} to ${master.name} at ${master.endpoint} in ${Date.now() - connectionStart} ms`);

      if (args.length) {
        _onSocketMessage.apply(undefined, args);
      }

      _socket = newSocket;
      _socket.removeAllListeners();
      _subscribedChannels.forEach(channel => _socket.subscribe(channel));
      _socket.on('message', _onSocketMessage);
      _lastHeartbeatReceivedTime = Date.now();
      _monitorHeartbeats();

      if (previousSocket) {
        setTimeout(() => {
          previousSocket.removeAllListeners();
          previousSocket.close();
          debug(`closed previous connection to ${previousSocket._master.name} at ${previousSocket._master.endpoint}`);
        }, 300);
      } else {
        connection.emit('connect');
      }
    }, 500);

    newSocket.once('connect', () => onSocketReceiving());
    newSocket.once('message', function () {
      for (var _len4 = arguments.length, args = Array(_len4), _key4 = 0; _key4 < _len4; _key4++) {
        args[_key4] = arguments[_key4];
      }

      return onSocketReceiving.apply(undefined, [null].concat(args));
    });
    return connection;
  }
  /**
   * if present, closes the sub socket
   * @return {object} the subscribeConnection instance
   */
  function disconnect() {
    _connectingMaster = null;
    _unmonitorHeartbeats();
    if (_socket) {
      _socket.close();
      _socket = null;
      debug('disconnected');
      connection.emit('disconnect');
    }
    return connection;
  }
  /**
   * subscribes the component to the passed channels
   * @param  {[string]} channels
   * @return {object} the subscribeConnection instance
   */
  function subscribe(channels) {
    channels.forEach(channel => {
      if (~_subscribedChannels.indexOf(channel)) return;
      _subscribedChannels.push(channel);
      if (_socket) _socket.subscribe(channel);
    });
    return connection;
  }
  /**
   * unsubscribes the component from the passed channels
   * @param  {[string]} channels
   * @return {object} the subscribeConnection instance
   */
  function unsubscribe(channels) {
    (0, _lodash.pullAll)(_subscribedChannels, channels);
    if (_socket) channels.forEach(channel => _socket.unsubscribe(channel));
    return connection;
  }
  /**
   * unsubscribes the component from every channel
   * @return {object} the subscribeConnection instance
   */
  function flushSubscriptions() {
    unsubscribe(_subscribedChannels);
    return connection;
  }

  return Object.defineProperties(connection, {
    connected: { get: () => !!_socket },
    master: { get: () => _socket && _extends({}, _socket._master) },
    subscribedChannels: { get: () => _subscribedChannels.slice() },
    connect: { value: connect },
    disconnect: { value: disconnect },
    subscribe: { value: subscribe },
    unsubscribe: { value: unsubscribe },
    flushSubscriptions: { value: flushSubscriptions }
  });
}

exports.default = SubConnection;