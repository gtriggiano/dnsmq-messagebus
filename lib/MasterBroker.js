'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

var _utils = require('./utils');

var _Constants = require('./Constants');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Provides a pair of pub/sub sockets
 * Every message received by sub is re-emitted by pub
 * 'sub' subscribes to all events
 * 'pub' has a no linger period (discards messages as soon as socket.close())
 * @return {object} {pub, sub}
 */
function getSockets() {
  let _sub = _zeromq2.default.socket('sub');
  let _pub = _zeromq2.default.socket('pub');
  _pub.linger = 0;

  _sub.subscribe('');
  _sub.on('message', function () {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _pub.send(args);
  });
  return { sub: _sub, pub: _pub };
}

/**
 * MasterBroker factory
 *
 * @param {object} node - The dnsNode using this component
 *
 * @return {object} masterBroker component
 */
function MasterBroker(node) {
  let broker = {};

  //  Debug
  const _debug = (0, _debug3.default)('dnsmq-messagebus:masterbroker');
  const _debugHeartbeat = (0, _debug3.default)('dnsmq-messagebus:masterbroker:heartbeats');
  const debug = function debug() {
    for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      args[_key2] = arguments[_key2];
    }

    return _debug.apply(undefined, [node.name].concat(args));
  };

  /**
   * sends an heartbeat to the subscribing sockets
   * @private
   */
  function _sendHeartbeat() {
    if (!_bound) return;
    _debugHeartbeat('');
    _pub.send(['heartbeats', node.name]);
  }

  // Private API
  let _ip;
  let _sub;
  let _pub;
  let _bound;
  let _subPort;
  let _pubPort;
  let _hearbeatInterval;
  let _isMaster = false;

  /**
   * binds a new pair of pub/sub sockets to all the
   * interfaces, on random ports
   * @return {[type]} [description]
   */
  function bind() {
    if (_bound) return;

    var _getSockets = getSockets();

    let sub = _getSockets.sub,
        pub = _getSockets.pub;

    sub.bindSync(`tcp://0.0.0.0:*`);
    pub.bindSync(`tcp://0.0.0.0:*`);
    _sub = sub;
    _pub = pub;
    _subPort = (0, _utils.getSocketPort)(_sub);
    _pubPort = (0, _utils.getSocketPort)(_pub);
    _bound = true;
  }
  /**
   * unbinds the pub/sub sockets
   * @return {[type]} [description]
   */
  function unbind() {
    if (!_bound) return;
    _sub.close();
    _pub.close();
    _subPort = null;
    _pubPort = null;
    _bound = false;
    stoptHeartbeats();
  }
  /**
   * setter for the private var `_ip` (IP address)
   * sets `_ip` just once
   * @param {string} ip
   */
  function setIP(ip) {
    if (!_ip) {
      debug(`discovered own IP: ${ip}`);
      _ip = ip;
    }
  }
  /**
   * sends a message to subscribing sockets
   * containing infos about a just elected master
   * @param  {object} newMasterInfos
   */
  function signalNewMaster(newMasterInfos) {
    if (_bound) {
      debug(`signaling new master to connected nodes`);
      _pub.send(['newmaster', JSON.stringify(newMasterInfos)]);
    }
  }
  /**
   * starts the emission of heartbeats at regular intervals
   */
  function startHeartbeats() {
    _isMaster = true;
    if (_hearbeatInterval) return;
    debug('starting heartbeats');
    _sendHeartbeat();
    _hearbeatInterval = setInterval(_sendHeartbeat, _Constants.HEARTBEAT_INTERVAL);
  }
  /**
   * stops the emission of heartbeats
   */
  function stoptHeartbeats() {
    _isMaster = false;
    if (!_hearbeatInterval) return;
    debug('stopping heartbeats');
    clearInterval(_hearbeatInterval);
    _hearbeatInterval = null;
  }

  return Object.defineProperties(broker, {
    isMaster: { get: () => _isMaster },
    endpoints: {
      get: () => ({
        sub: _ip ? `tcp://${_ip}:${_subPort}` : undefined,
        pub: _ip ? `tcp://${_ip}:${_pubPort}` : undefined
      })
    },
    ports: {
      get: () => ({
        sub: _subPort,
        pub: _pubPort
      })
    },
    bind: { value: bind },
    unbind: { value: unbind },
    setIP: { value: setIP },
    signalNewMaster: { value: signalNewMaster },
    startHeartbeats: { value: startHeartbeats },
    stoptHeartbeats: { value: stoptHeartbeats }
  });
}

exports.default = MasterBroker;