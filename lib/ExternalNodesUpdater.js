'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

function ExternalNodesUpdater(settings) {
  let _bound = false;
  let _pub = _zeromq2.default.socket('pub');

  let updater = {
    bind: function bind() {
      if (_bound) return;
      _pub.bindSync(`tcp://0.0.0.0:${settings.externalUpdatesPort}`);
      _bound = true;
    },
    unbind: function unbind() {
      if (!_bound) return;
      _pub.unbindSync(`tcp://0.0.0.0:${settings.externalUpdatesPort}`);
      _bound = false;
    },
    publish: function publish(channel) {
      if (!_bound) return;

      for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }

      _pub.send([channel].concat(_toConsumableArray(args)));
    }
  };

  return updater;
}

exports.default = ExternalNodesUpdater;