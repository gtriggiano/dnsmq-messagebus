'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.prefixString = undefined;
exports.nodeIdToName = nodeIdToName;
exports.getSocketPort = getSocketPort;
exports.zeropad = zeropad;
exports.getNodeId = getNodeId;
exports.timingoutCallback = timingoutCallback;

var _uuid = require('uuid');

var _uuid2 = _interopRequireDefault(_uuid);

var _zeromq = require('zeromq');

var _lodash = require('lodash');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const prefixString = exports.prefixString = (0, _lodash.curry)(function prefixString(prefix, str) {
  return `${prefix}${str}`;
});

function nodeIdToName(id) {
  return id.substring(3, 11);
}

function getSocketPort(socket) {
  let address = socket.getsockopt(_zeromq.ZMQ_LAST_ENDPOINT);
  return address.replace(/tcp:\/\/0\.0\.0\.0:/, '');
}

function zeropad(num, len) {
  let str = String(num);
  while (str.length < len) {
    str = `0${str}`;
  }
  return str;
}

function getNodeId(_ref) {
  let external = _ref.external,
      electionPriority = _ref.electionPriority;

  return external ? `EX-${_uuid2.default.v4()}` : `${zeropad(99 - electionPriority, 2)}-${_uuid2.default.v4()}`;
}

function timingoutCallback(fn, ms) {
  let _fired = false;
  function callback(err) {
    if (_fired) return;
    _fired = true;

    for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      args[_key - 1] = arguments[_key];
    }

    fn.apply(undefined, [err].concat(args));
  }
  setTimeout(() => {
    let error = new Error('Timeout');
    callback(error);
  }, ms);
  return callback;
}