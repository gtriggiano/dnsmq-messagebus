'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

var _dns = require('dns');

var _dns2 = _interopRequireDefault(_dns);

var _eventemitter = require('eventemitter3');

var _eventemitter2 = _interopRequireDefault(_eventemitter);

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function ElectionCoordinator(_settings) {
  let host = _settings.host,
      coordinationPort = _settings.coordinationPort,
      electionTimeout = _settings.electionTimeout,
      node = _settings.node,
      masterBroker = _settings.masterBroker;


  let coordinator = new _eventemitter2.default();

  //  Debug
  const _debug = (0, _debug3.default)('dnsmq-messagebus:dnsnode:electioncoordinator');
  const debug = function debug() {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _debug.apply(undefined, [node.name].concat(args));
  };

  // Private API
  let _voting = false;
  let _electionCaller = false;
  let _master = false;
  let _masterCandidate = false;
  let _intCmd = _zeromq2.default.socket('router');
  _intCmd.on('message', _onCoordinationMessage);

  function _broadcastMessage(type, data) {
    data = data || {};
    let message = { type: type, data: data };
    _dns2.default.resolve4(host, (err, addresses) => {
      if (err) {
        debug(`Cannot resolve host '${host}'. Check DNS infrastructure.`);
        return;
      }
      debug(`Broadcasting message '${type}' to '${host}' nodes: ${addresses}`);
      addresses.forEach(address => {
        let messenger = _zeromq2.default.socket('req');
        messenger.connect(`tcp://${address}:${coordinationPort}`);
        messenger.send(JSON.stringify(_extends({}, message, {
          toAddress: address
        })));

        let _end = false;
        function closeSocket() {
          if (_end) return;
          _end = true;
          messenger.close();
        }

        messenger.on('message', closeSocket);
        setTimeout(closeSocket, 300);
      });
    });
  }
  function _onCoordinationMessage(messenger, _, msgBuffer) {
    let message = JSON.parse(msgBuffer);

    masterBroker.setIP(message.toAddress);

    switch (message.type) {
      case 'electionStart':
        _voting = true;
        debug(`Master election: candidating...`);
        _broadcastMessage('electionMasterCandidate', {
          id: node.id,
          endpoints: masterBroker.endpoints,
          isMaster: _master && _master.id === node.id
        });
        break;
      case 'electionMasterCandidate':
        if (_electionCaller) {
          debug(`Master election: candidate ${(0, _utils.nodeIdToName)(message.data.id)}.${message.data.isMaster ? ' Is master.' : ''}`);
          if (!_masterCandidate) {
            _masterCandidate = message.data;
            return;
          }
          if (message.data.isMaster) {
            if (_masterCandidate.isMaster) {
              _masterCandidate = _masterCandidate.id < message.data.id ? _masterCandidate : message.data;
            } else {
              _masterCandidate = message.data;
            }
          } else {
            if (!_masterCandidate.isMaster) {
              _masterCandidate = _masterCandidate.id < message.data.id ? _masterCandidate : message.data;
            }
          }
        }
        break;
      case 'electionWinner':
        _voting = false;
        if (!_master || _master.id !== message.data.newMaster.id) {
          _master = message.data.newMaster;
          coordinator.emit('newMaster', _extends({}, _master, {
            name: (0, _utils.nodeIdToName)(_master.id)
          }));
        } else {
          debug(`Master election: confirmed master ${(0, _utils.nodeIdToName)(_master.id)}`);
        }
    }
    _intCmd.send([messenger, _, '']);
  }

  // Public API
  function bind() {
    _intCmd.bindSync(`tcp://0.0.0.0:${coordinationPort}`);
  }
  function unbind() {
    _intCmd.unbindSync(`tcp://0.0.0.0:${coordinationPort}`);
  }
  function startElection() {
    if (_voting) return;
    debug('Calling master election');
    _voting = true;
    _electionCaller = true;
    _broadcastMessage('electionStart');
    setTimeout(function () {
      if (!_masterCandidate) {
        _electionCaller = false;
        debug(`No nodes answered to the master election call. Check the settings of DNS`);
        coordinator.emit('failedElection');
        return;
      }
      let newMaster = {
        id: _masterCandidate.id,
        endpoints: _masterCandidate.endpoints
      };
      debug('Master election: time finished');
      debug(`Master election: winner is ${(0, _utils.nodeIdToName)(newMaster.id)} ${JSON.stringify(newMaster, null, 2)}`);
      _broadcastMessage('electionWinner', { newMaster: newMaster });
      _electionCaller = false;
      _masterCandidate = false;
    }, electionTimeout);
  }

  return Object.defineProperties(coordinator, {
    voting: {
      get: () => _voting
    },
    bind: { value: bind },
    unbind: { value: unbind },
    startElection: { value: startElection }
  });
}

exports.default = ElectionCoordinator;