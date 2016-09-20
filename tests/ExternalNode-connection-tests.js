import should from 'should/as-function'

import { DNSNode, ExternalNode } from '../src'

const DNSHOST = 'cluster'

describe('DNS-MessageBus-ExternalNode', () => {
  it('should emit a `connect` event upon connection', function (done) {
    let node = ExternalNode(DNSHOST)
    node.connect()
    node.on('connect', () => {
      node.disconnect()
      done()
    })
  })
  it('should emit a `disconnect` event upon voluntary disconnection', function (done) {
    let node = ExternalNode(DNSHOST)
    node.connect()
    node.on('connect', () => {
      node.disconnect()
    })
    node.on('disconnect', () => {
      done()
    })
  })
  it('should emit a `disconnect` event upon cluster failure', function (done) {
    // Here the failure is caused disconnecting the only node of the cluster
    this.timeout(5000)
    let dnsNode = DNSNode('localhost')
    let externalNode = ExternalNode('localhost')
    externalNode.once('disconnect', () => {
      done()
      externalNode.disconnect()
    })

    dnsNode.connect()
    dnsNode.on('connect', () => {
      externalNode.connect()
      externalNode.on('connect', () => {
        setTimeout(function () {
          dnsNode.disconnect()
        }, 500)
      })
    })
  })
  it('should emit a `connection:failure` event if unable to connect to the cluster within 1.5s from startup', function (done) {
    this.timeout(1550)
    let node = ExternalNode('localhost')

    node.connect()
    node.on('connection:failure', () => {
      done()
      node.disconnect()
    })
  })
  it('can send a message through a channel', function (done) {
    let node = ExternalNode(DNSHOST)
    node.connect()
    node.subscribe('testchannel')
    node.on('testchannel', (testmessage) => {
      should(testmessage).equal('testmessage')
      done()
      node.disconnect()
    })
    node.on('connect', () => {
      node.publish('testchannel', 'testmessage')
    })
  })
  it('receives messages only from the channels it subscribed to', function (done) {
    let node = ExternalNode(DNSHOST)
    node.connect()

    node.subscribe('updates')

    let _update
    node.on('updates', (update) => { _update = update })
    node.on('otherthings', () => done(new Error('should not receive from `otherthings` channel')))
    node.on('connect', () => {
      node.publish('otherthings', 'otherthing')
      node.publish('updates', 'update')
      setTimeout(function () {
        should(_update).equal('update')
        done()
        node.disconnect()
      }, 50)
    })
  })
  it('cannot unsubscribe from channels: connect, disconnect, connection:failure', function (done) {
    let node = ExternalNode(DNSHOST)
    let nodeFailing = ExternalNode('localhost')
    node.unsubscribe(['connect', 'disconnect', 'connection:failure'])
    nodeFailing.unsubscribe(['connect', 'disconnect', 'connection:failure'])

    let _connect
    let _disconnect
    let _connectionFailure
    node.connect()
    nodeFailing.connect()
    node.on('connect', () => {
      _connect = true
      node.disconnect()
    })
    node.on('disconnect', () => {
      _disconnect = true
    })
    nodeFailing.on('connection:failure', () => {
      _connectionFailure = true
      nodeFailing.disconnect()
    })

    setTimeout(function () {
      if (_connect && _disconnect && _connectionFailure) {
        done()
      } else {
        console.log(_connect)
        console.log(_disconnect)
        console.log(_connectionFailure)
        done(new Error('All the events [connect, disconnect, connection:failure] should have been received'))
      }
    }, 1600)
  })
  it('cannot subscribe to `heartbeats` channel', function (done) {
    let node = ExternalNode(DNSHOST)
    node.subscribe(['heartbeats', 'test'])
    node.connect()
    node.on('heartbeats', () => done(new Error('should not emit heartbeats events')))
    node.on('connect', () => {
      setTimeout(function () {
        node.publish('test', 'test')
      }, 500)
    })
    node.on('test', () => {
      node.disconnect()
      done()
    })
  })
  it('cannot publish to connect, disconnect, connection:failure channels', function (done) {
    let node1 = ExternalNode(DNSHOST)
    let node2 = ExternalNode(DNSHOST)

    node1.connect()
    node2.connect()

    node1.once('connect', _publish)
    node2.once('connect', _publish)

    function _breakTest () { done(new Error('something went wrong')) }

    function _publish () {
      if (node1.connected && node2.connected) {
        node2.on('connect', _breakTest)
        node2.on('disconnect', _breakTest)
        node2.on('connection:failure', _breakTest)

        node1.publish('connect')
        node1.publish('disconnect')
        node1.publish('connection:failure')

        setTimeout(function () {
          node2.removeListener('connect', _breakTest)
          node2.removeListener('disconnect', _breakTest)
          node2.removeListener('connection:failure', _breakTest)
          done()
        }, 1000)
      }
    }
  })
})
