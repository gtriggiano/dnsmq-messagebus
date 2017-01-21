'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.prefixString = undefined;
exports.nodeIdToName = nodeIdToName;
exports.getSocketEndpoint = getSocketEndpoint;
exports.getSocketPort = getSocketPort;
exports.zeropad = zeropad;

var _os = require('os');

var _os2 = _interopRequireDefault(_os);

var _zeromq = require('zeromq');

var _lodash = require('lodash');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const prefixString = exports.prefixString = (0, _lodash.curry)(function prefixString(prefix, str) {
  return `${prefix}${str}`;
});

function nodeIdToName(id) {
  return id.substring(3, 11);
}

function boxExternalIps() {
  let ifaces = _os2.default.networkInterfaces();
  return Object.keys(ifaces).reduce((ips, ifaceName) => {
    return ips.concat(ifaces[ifaceName].filter(address => !address.internal && address.family === 'IPv4'));
  }, []).map((_ref) => {
    let address = _ref.address;
    return address;
  });
}

function getSocketEndpoint(socket) {
  let address = socket.getsockopt(_zeromq.ZMQ_LAST_ENDPOINT);
  let ip = boxExternalIps()[0];
  return ip ? address.replace(/0\.0\.0\.0/, ip) : undefined;
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