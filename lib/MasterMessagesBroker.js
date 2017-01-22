'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const HEARTBEAT_INTERVAL = 500;

function getSockets() {
  let _sub = _zeromq2.default.socket('sub');
  let _pub = _zeromq2.default.socket('pub');

  _sub.subscribe('');
  _sub.on('message', function () {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _pub.send(args);
  });
  return { sub: _sub, pub: _pub };
}

function MasterMessagesBroker(node) {
  let broker = {};

  //  Debug
  const _debug = (0, _debug3.default)('dnsmq-messagebus:dnsnode:masterbroker');
  const _debugHeartbeat = (0, _debug3.default)('dnsmq-messagebus:dnsnode:masterbroker:heartbeat');
  const debug = function debug() {
    for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      args[_key2] = arguments[_key2];
    }

    return _debug.apply(undefined, [node.name].concat(args));
  };

  function _sendHeartbeat() {
    if (!_bound) return;
    _debugHeartbeat('');
    _pub.send(['heartbeats', '']);
  }

  // Private API
  let _ip;
  let _sub;
  let _pub;
  let _bound;
  let _subPort;
  let _pubPort;
  let _hearbeatInterval;

  // Public API
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
  function unbind() {
    if (!_bound) return;
    _sub.close();
    _pub.close();
    _subPort = null;
    _pubPort = null;
    _bound = false;
  }
  function setIP(ip) {
    if (!_ip) {
      debug(`Discovered IP: ${ip}`);
      _ip = ip;
    }
  }
  function startHeartbeats() {
    if (_hearbeatInterval) return;
    debug('Starting heartbeats');
    _sendHeartbeat();
    _hearbeatInterval = setInterval(_sendHeartbeat, HEARTBEAT_INTERVAL);
  }
  function stoptHeartbeats() {
    if (!_hearbeatInterval) return;
    debug('Stopping heartbeats');
    clearInterval(_hearbeatInterval);
    _hearbeatInterval = null;
  }

  return Object.defineProperties(broker, {
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
    startHeartbeats: { value: startHeartbeats },
    stoptHeartbeats: { value: stoptHeartbeats }
  });
}

exports.default = MasterMessagesBroker;