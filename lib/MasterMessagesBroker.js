'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

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

function MasterMessagesBroker(_ref) {
  let id = _ref.id;

  let _ip;
  let _sub;
  let _pub;
  let _bound;
  let _subPort;
  let _pubPort;
  let _hearbeatInterval;

  function _sendHeartbeat() {
    if (!_bound) return;
    _pub.send(['heartbeats', JSON.stringify({
      name: (0, _utils.nodeIdToName)(id),
      endpoints: broker.endpoints
    })]);
  }

  let broker = {
    bind: function bind() {
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
    },
    unbind: function unbind() {
      if (!_bound) return;
      _sub.close();
      _pub.close();
      _subPort = null;
      _pubPort = null;
      _bound = false;
    },
    startHeartbeats: function startHeartbeats() {
      if (_hearbeatInterval) return;
      _sendHeartbeat();
      _hearbeatInterval = setInterval(_sendHeartbeat, HEARTBEAT_INTERVAL);
    },
    stoptHeartbeats: function stoptHeartbeats() {
      clearInterval(_hearbeatInterval);
      _hearbeatInterval = null;
    }
  };

  return Object.defineProperties(broker, {
    setIP: {
      value: ip => {
        _ip = _ip || ip;
      }
    },
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
    }
  });
}

exports.default = MasterMessagesBroker;