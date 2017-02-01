const codePath = `../${process.env.CODE_PATH}`
const DNSHOST = 'bus'
const EXTERNAL = !!process.env.EXTERNAL

import should from 'should/as-function'

const _Node = require(codePath).Node
const Node = () => _Node(DNSHOST, {external: EXTERNAL})

const { DNS_NODE, EXTERNAL_NODE } = require(`${codePath}/Constants`)

describe(`Connectivity of ${EXTERNAL ? 'an ExternalNode' : 'a DNSNode'}`, () => {
  it('connects to the bus', (done) => {
    let node = Node()
    should(node.type).equal(EXTERNAL ? EXTERNAL_NODE : DNS_NODE)
    node.once('ready', () => {
      node.deactivate()
    })
    node.once('deactivated', () => {
      done()
    })
    node.activate()
  })
})
describe(`Properties of ${EXTERNAL ? 'an ExternalNode' : 'a DNSNode'} connectivity state`, () => {
  it('node.canPublish is true/false depending on the state of the publishing connection to master', (done) => {
    let node = Node()
    should(node.canPublish).be.False()
    node.on('ready', () => {
      should(node.canPublish).be.True()
      node.deactivate()
    })
    node.once('deactivated', () => {
      should(node.canPublish).be.False()
      done()
    })
    node.activate()
  })
  it('node.isReceiving is true/false depending on the state of the subscribing connection to master', (done) => {
    let node = Node()
    should(node.isReceiving).be.False()
    node.on('ready', () => {
      should(node.isReceiving).be.True()
      node.deactivate()
    })
    node.once('deactivated', () => {
      should(node.isReceiving).be.False()
      done()
    })
    node.activate()
  })
  it('node.isReady is true/false depending on the states of both the subscribing and the publishing connections to master', (done) => {
    let node = Node()
    should(node.isReady).be.False()
    node.on('ready', () => {
      should(node.isReady).be.True()
      node.deactivate()
    })
    node.once('deactivated', () => {
      should(node.isReady).be.False()
      done()
    })
    node.activate()
  })
})
describe(`${EXTERNAL ? 'An ExternalNode' : 'A DNSNode'} as an EventEmitter`, () => {
  it('emits a `ready` event when the node connects to the master', (done) => {
    let node = Node()
    node.on('ready', () => {
      node.deactivate()
    })
    node.once('deactivated', () => {
      done()
    })
    node.activate()
  })
  it('emits a `deactivated` event upon deactivation', (done) => {
    let node = Node()
    node.on('ready', () => {
      node.deactivate()
    })
    node.on('deactivated', () => {
      done()
    })
    node.activate()
  })
  it('emits a `not:ready` event when the node disconnects from the master', (done) => {
    let node = Node()
    node.on('ready', () => {
      node.deactivate()
    })
    node.once('not:ready', () => {
      done()
    })
    node.activate()
  })
  it('emits a `can:publish` event upon connection to the master sub socket', (done) => {
    let node = Node()
    node.on('can:publish', () => {
      node.deactivate()
    })
    node.once('not:ready', () => {
      done()
    })
    node.activate()
  })
  it('emits a `cannot:publish` event upon disconnection from the master sub socket', (done) => {
    let node = Node()
    node.on('can:publish', () => {
      node.deactivate()
    })
    node.once('cannot:publish', () => {
      done()
    })
    node.activate()
  })
  it('emits a `receiving` event upon connection to the master pub socket', (done) => {
    let node = Node()
    node.once('receiving', () => {
      node.deactivate()
    })
    node.once('deactivated', () => {
      done()
    })
    node.activate()
  })
  it('emits a `not:receiving` event upon disconnection from the master pub socket', (done) => {
    let node = Node()
    node.on('receiving', () => {
      node.deactivate()
    })
    node.once('not:receiving', () => {
      done()
    })
    node.activate()
  })
})