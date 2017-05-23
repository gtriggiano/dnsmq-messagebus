'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _dns = require('dns');

var _dns2 = _interopRequireDefault(_dns);

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

var _eventemitter = require('eventemitter3');

var _eventemitter2 = _interopRequireDefault(_eventemitter);

var _lodash = require('lodash');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * MasterElector factory
 *
 * @param {object} node - The dnsNode using this component
 * @param {object} masterBroker - The masterMessagesBroker of the dnsNode  using this component
 *
 * @return {object} masterElector component
 */
function MasterElector(node, masterBroker) {
  let resolver = new _eventemitter2.default();

  //  Debug
  const _debug = (0, _debug3.default)('dnsmq-messagebus:masterelector');
  const debug = function debug() {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _debug.apply(undefined, [node.name].concat(args));
  };

  let _electingMaster = false;
  let _advertiseId = null;

  let _inbox = _zeromq2.default.socket('router');

  /**
   * function receiving the messages from the coordination router
   * @param  {buffer} sender
   * @param  {void} _
   * @param  {buffer} msgBuffer
   */
  function _onInboxMessage(sender, _, msgBuffer) {
    let message = JSON.parse(msgBuffer);
    masterBroker.setIP(message.toAddress);

    switch (message.type) {
      case 'voteRequest':
        debug(`sending vote to ${node.name === message.from ? 'myself' : message.from}`);
        _inbox.send([sender, _, JSON.stringify({
          id: _advertiseId || node.id,
          name: node.name,
          endpoints: masterBroker.endpoints,
          isMaster: masterBroker.isMaster,
          candidate: !_advertiseId
        })]);
        break;
      case 'masterRequest':
        let connectedMaster = node.master;
        if (connectedMaster) {
          debug(`sending master coordinates to ${message.from}`);
          _inbox.send([sender, _, JSON.stringify(connectedMaster)]);
        } else {
          debug(`unable to send master coordinates to ${message.from}`);
          _inbox.send([sender, _, JSON.stringify(false)]);
        }
        break;
      case 'masterElected':
        _inbox.send([sender, _, '']);
        debug(`received notice of master election: ${message.data.name}`);
        resolver.emit('newmaster', message.data);
    }
  }
  /**
   * broadcasts a message to the coordination socket of all the dnsNodes
   * @param  {string} type - Type of message
   * @param  {object} data - Payload of the message
   */
  function _broadcastMessage(type, data) {
    data = data || {};
    let message = { type: type, data: data };
    var _node$settings = node.settings;
    let host = _node$settings.host,
        coordinationPort = _node$settings.coordinationPort;

    _dns2.default.resolve4(host, (err, addresses) => {
      if (err) {
        debug(`cannot resolve host '${host}'. Check DNS infrastructure.`);
        return;
      }
      debug(`broadcasting message '${type}' to '${host}' nodes: ${addresses}`);
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
  /**
   * requests the voting identity of all the eligible dnsNodes
   * @return {promise} An list of objects representing nodes eligible as master
   */
  function _requestVotes() {
    var _node$settings2 = node.settings;
    let host = _node$settings2.host,
        coordinationPort = _node$settings2.coordinationPort;

    let message = {
      type: 'voteRequest',
      data: {}
    };
    return new Promise((resolve, reject) => {
      let resolveStart = Date.now();
      _dns2.default.resolve4(host, (err, addresses) => {
        if (err) {
          debug(`cannot resolve host '${host}'. Check DNS infrastructure.`);
          return reject(err);
        }
        debug(`resolved ${addresses.length} IP(s) for host '${host}' in ${Date.now() - resolveStart} ms`);
        debug(`requesting votes from ${addresses.length} nodes`);
        Promise.all(addresses.map(address => new Promise((resolve, reject) => {
          let voteRequestTime = Date.now();
          let messenger = _zeromq2.default.socket('req');
          messenger.connect(`tcp://${address}:${coordinationPort}`);
          messenger.send(JSON.stringify(_extends({}, message, {
            toAddress: address,
            from: node.name
          })));

          let _resolved = false;
          function onEnd(candidateBuffer) {
            if (_resolved) return;
            _resolved = true;
            messenger.removeListener('message', onEnd);
            messenger.close();

            let candidate = candidateBuffer && JSON.parse(candidateBuffer);
            if (candidate) {
              let elapsed = Date.now() - voteRequestTime;
              candidate.candidate && debug(`received vote by ${candidate.name === node.name ? 'myself' : candidate.name}${candidate.isMaster ? ' (master)' : ''} in ${elapsed} ms`);
            } else {
              debug(`missed vote by peer at ${address}`);
            }
            resolve(candidate);
          }

          messenger.on('message', onEnd);
          setTimeout(onEnd, node.settings.voteTimeout);
        }))).then(nodes => (0, _lodash.compact)(nodes)).then(nodes => resolve(nodes.filter((_ref) => {
          let candidate = _ref.candidate;
          return candidate;
        })));
      });
    });
  }

  /**
   * Binds the coordination router socket to all interfaces
   * @return {object} masterElector
   */
  function bind() {
    _inbox.bindSync(`tcp://0.0.0.0:${node.settings.coordinationPort}`);
    _inbox.on('message', _onInboxMessage);
    return resolver;
  }
  /**
   * Unbinds the coordination router socket from all interfaces
   * @return {object} masterElector
   */
  function unbind() {
    _inbox.unbindSync(`tcp://0.0.0.0:${node.settings.coordinationPort}`);
    _inbox.removeListener('message', _onInboxMessage);
    return resolver;
  }
  /**
   * Triggers a master election
   * @alias resolve
   * @param  {string} [advertiseId] - A fake id to use for this node during the election
   * @return {promise} An object containing the name and the pub/sub endpoints of the master node
   */
  function electMaster(advertiseId) {
    _advertiseId = advertiseId || null;
    if (_electingMaster) return _electingMaster;
    _electingMaster = _requestVotes().then(nodes => {
      _electingMaster = false;
      _advertiseId = null;
      const masterNodes = nodes.filter((_ref2) => {
        let isMaster = _ref2.isMaster;
        return isMaster;
      });
      nodes = masterNodes.length ? masterNodes : nodes;
      const electedMaster = (0, _lodash.sortBy)(nodes, (_ref3) => {
        let id = _ref3.id;
        return id;
      })[0];
      if (!electedMaster) throw new Error('could not elect a master');

      debug(`elected master: ${electedMaster.name} ${JSON.stringify(electedMaster.endpoints)}`);
      _broadcastMessage('masterElected', electedMaster);
      return electedMaster;
    });

    _electingMaster.catch(() => {
      _electingMaster = false;
      _advertiseId = null;
    });
    return _electingMaster;
  }

  return Object.defineProperties(resolver, {
    bind: { value: bind },
    unbind: { value: unbind },
    isResolving: { get: () => !!_electingMaster },
    resolve: { value: electMaster }
  });
}

exports.default = MasterElector;