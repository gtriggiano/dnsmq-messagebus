'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _dns = require('dns');

var _dns2 = _interopRequireDefault(_dns);

var _zeromq = require('zeromq');

var _zeromq2 = _interopRequireDefault(_zeromq);

var _eventemitter = require('eventemitter3');

var _eventemitter2 = _interopRequireDefault(_eventemitter);

var _Constants = require('./Constants');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * MasterFinder factory
 *
 * @param {object} node - The dnsNode using this component
 *
 * @return {object} masterFinder component
 */
function MasterFinder(node) {
  let resolver = new _eventemitter2.default();

  //  Debug
  const _debug = (0, _debug3.default)('dnsmq-messagebus:masterfinder');
  const debug = function debug() {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return _debug.apply(undefined, [node.name].concat(args));
  };

  let _findingMaster = false;

  /**
   * Connects to the coordination socket of all the reachable dnsNodes
   * to ask for the current master
   * Resolves as soon as it receives the first answer from a dnsNode
   * @alias resolve
   * @return {promise} An object containing the name and the pub/sub endpoints of the master node
   */
  function findMaster() {
    if (_findingMaster) return _findingMaster;
    _findingMaster = new Promise((resolve, reject) => {
      var _node$settings = node.settings;
      let host = _node$settings.host,
          coordinationPort = _node$settings.coordinationPort;

      debug(`seeking for master node at host '${host}'`);

      let resolveStart = Date.now();
      _dns2.default.resolve4(host, (err, addresses) => {
        if (err) {
          debug(`cannot resolve host '${host}'. Check DNS infrastructure.`);
          _findingMaster = false;
          return reject(err);
        }
        debug(`resolved ${addresses.length} IP(s) for host '${host}' in ${Date.now() - resolveStart} ms`);

        let _resolved = false;

        const onMasterFound = master => {
          if (_resolved) return;
          _resolved = true;

          _findingMaster = false;

          debug(`discovered master node ${master.name}`);
          resolve(master);
        };
        const onTimeout = () => {
          if (_resolved) return;
          _resolved = true;

          _findingMaster = false;

          debug(`failed to discover master node`);
          reject();
        };

        debug(`trying to get master coordinates from ${addresses.length} nodes`);
        addresses.forEach(address => {
          let messenger = _zeromq2.default.socket('req');
          messenger.connect(`tcp://${address}:${coordinationPort}`);
          messenger.send(JSON.stringify({
            type: 'masterRequest',
            toAddress: address,
            from: node.name
          }));

          let _resolved = false;
          const onEnd = msgBuffer => {
            if (_resolved) return;
            _resolved = true;
            messenger.removeListener('message', onEnd);
            messenger.close();

            let master = msgBuffer && JSON.parse(msgBuffer);
            if (master) onMasterFound(master);
          };
          messenger.once('message', onEnd);
          setTimeout(onEnd, _Constants.HEARTBEAT_TIMEOUT);
        });

        setTimeout(onTimeout, _Constants.HEARTBEAT_TIMEOUT);
      });
    });
    return _findingMaster;
  }

  return Object.defineProperties(resolver, {
    isResolving: { get: () => !!_findingMaster },
    resolve: { value: findMaster }
  });
}

exports.default = MasterFinder;