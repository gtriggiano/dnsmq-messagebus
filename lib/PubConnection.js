'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

var _eventemitter = require('eventemitter3');

var _eventemitter2 = _interopRequireDefault(_eventemitter);

var _lodash = require('lodash');

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Publishing connection factory
 * @param {object} node - The node using this component
 *
 * @return {object} publishConnection component
 */
function PubConnection(node) {
  let connection = new _eventemitter2.default();

  const _debug = (0, _debug3.default)('dnsmq-messagebus:PUB');
  const debug = function debug() {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _debug.apply(undefined, [node.name].concat(args));
  };

  let _socket = null;
  let _connectingMaster = null;

  /**
   * Provides a pub socket connecting to master.endpoint
   * @private
   * @param  {object} master - Map of properties about the actual master node
   * @return {object} A `zeromq` socket
   */
  const _getSocket = master => {
    let socket = _zeromq2.default.socket('pub');
    socket._master = master;
    socket.monitor(5, 0);
    socket.connect(master.endpoint);
    return socket;
  };
  const _publishStream = new _eventemitter2.default();
  _publishStream.on('message', function () {
    for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      args[_key2] = arguments[_key2];
    }

    if (_socket) _socket.send(args);
  });

  /**
   * creates a new pub socket and tries to connect it to the provided master;
   * after connection the socket is used to publish messages in the bus
   * and an eventual previous socket is closed
   * @param  {object} master
   * @return {object} the publishConnection instance
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

    let _messagesToResend = [];
    let _onMessagePublished = function _onMessagePublished() {
      for (var _len3 = arguments.length, args = Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
        args[_key3] = arguments[_key3];
      }

      if (_socket) _messagesToResend.push(args);
    };
    _publishStream.on('message', _onMessagePublished);

    debug(`connecting to ${master.name} at ${master.endpoint}`);

    let connectionStart = Date.now();
    const onSocketConnected = (0, _utils.timingoutCallback)(err => {
      _publishStream.removeListener('message', _onMessagePublished);
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

      _socket = newSocket;

      let totalMessagesToResend = _messagesToResend.length;
      if (totalMessagesToResend) {
        debug(`resending ${totalMessagesToResend} messages published while transitioning`);
        _messagesToResend.forEach(message => _socket.send(message));
      }

      if (previousSocket) {
        previousSocket.close();
        debug(`closed previous connection to ${previousSocket._master.name} at ${previousSocket._master.endpoint}`);
      } else {
        connection.emit('connect');
      }
    }, 500);

    newSocket.once('connect', () => onSocketConnected());
    return connection;
  }
  /**
   * if present, closes the pub socket
   * @return {object} the publishConnection instance
   */
  function disconnect() {
    _connectingMaster = null;
    if (_socket) {
      _socket.close();
      _socket = null;
      debug('disconnected');
      connection.emit('disconnect');
    }
    return connection;
  }
  /**
   * takes a list of strings|buffers to publish as message's frames
   * in the channel passed as first argument;
   * decorates each message with a uid
   * @param  {string} channel
   * @param  {[string|buffer]} args
   */
  function publish(channel) {
    for (var _len4 = arguments.length, args = Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
      args[_key4 - 1] = arguments[_key4];
    }

    _publishStream.emit.apply(_publishStream, ['message', channel, (0, _lodash.uniqueId)(`${node.name}_`)].concat(args));
  }

  return Object.defineProperties(connection, {
    connected: { get: () => !!_socket },
    master: { get: () => _socket && _extends({}, _socket._master) },
    connect: { value: connect },
    disconnect: { value: disconnect },
    publish: { value: publish }
  });
}

exports.default = PubConnection;