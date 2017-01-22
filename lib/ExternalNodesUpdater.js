'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function ExternalNodesUpdater(settings) {
  let updater = {};

  let externalUpdatesPort = settings.externalUpdatesPort;


  let _pub;

  function bind() {
    if (_pub) return;
    _pub = _zeromq2.default.socket('pub');
    _pub.bindSync(`tcp://0.0.0.0:${externalUpdatesPort}`);
  }
  function unbind() {
    if (!_pub) return;
    _pub.close();
    _pub = null;
  }
  function publish(channel) {
    if (!_pub) return;

    for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      args[_key - 1] = arguments[_key];
    }

    _pub.send([channel].concat(args));
  }

  return Object.defineProperties(updater, {
    bind: { value: bind },
    unbind: { value: unbind },
    publish: { value: publish }
  });
}

exports.default = ExternalNodesUpdater;