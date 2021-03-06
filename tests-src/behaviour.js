const codePath = `../${process.env.CODE_PATH}`
const DNSHOST = 'dnsmq-messagebus-development-bus.docker'
const EXTERNAL = !!process.env.EXTERNAL

import Docker from 'dockerode'
const docker = new Docker({socketPath: '/var/run/docker.sock'})

const busNode1 = docker.getContainer('dnsmqmessagebus_bus_1')
function restartBusNode1 () {
  return new Promise((resolve, reject) => {
    busNode1.stop((err) => {
      if (err) return reject(err)
      busNode1.start((err) => {
        if (err) return reject(err)
        setTimeout(() => resolve(), 1000)
      })
    })
  })
}

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
  if (!EXTERNAL) {
    it('if master tries to elect a new master before deactivation, to ensure other nodes connectivity', function (done) {
      this.timeout(10000)

      let busNode = Node()

      let emitter = _Node(DNSHOST, {external: true})
      const publishOnA = () => emitter.publish('a', 'message')
      const publishOnB = () => emitter.publish('b', 'message')

      let receiver = _Node(DNSHOST, {external: true})
      receiver.subscribe(['a', 'b'])
      receiver.once('a', () => {
        should(emitter.master.name).equal(busNode.name)
        busNode.deactivate()
        busNode.on('deactivated', () => {
          publishOnB()
        })
      })
      receiver.once('b', () => {
        emitter.deactivate()
        receiver.deactivate()
        done()
      })

      receiver.once('ready', () => emitter.activate())
      emitter.once('ready', () => publishOnA())

      busNode.activate()
      busNode.once('ready', () => {
        restartBusNode1()
        .then(() => {
          receiver.activate()
        })
        .catch(done)
      })
    })
  }
})
describe(`As an EventEmitter ${EXTERNAL ? 'an ExternalNode' : 'a DNSNode'}`, () => {
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
describe(`As a messagebus node ${EXTERNAL ? 'an ExternalNode' : 'a DNSNode'}`, () => {
  it('can subscribe to channels')
  it('can unsubscribe from channels')
  it('can publish on the bus')
  it('exposes a list of subscribed channels through node.subscribedChannels', () => {
    let node = Node()
    node.subscribe('a')
    node.subscribe(['b', 'c'])
    should(node.subscribedChannels).be.an.Array()
    should(node.subscribedChannels.sort()).eql(['a', 'b', 'c'])
  })
  it('node.subscribedChannels is not settable nor mutable', () => {
    let node = Node()
    node.subscribe('a')

    should(() => { node.subscribedChannels = [] }).throw()
    node.subscribedChannels.push('b')
    should(node.subscribedChannels.length).equal(1)
  })
  it('has prop node.canPublish: true/false depending on the state of the publishing connection to master', (done) => {
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
  it('has prop node.isReceiving: true/false depending on the state of the subscribing connection to master', (done) => {
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
  it('has prop node.isReady: true/false depending on the states of both the subscribing and the publishing connections to master', (done) => {
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
  it('has prop node.master: null or an informational object about the master that the node is connected to', (done) => {
    let node = Node()
    should(node.master).be.Null()
    node.on('ready', () => {
      should(node.master.name).be.a.String()
      should(node.master.endpoints.sub).be.a.String()
      should(node.master.endpoints.pub).be.a.String()
      node.deactivate()
    })
    node.on('not:ready', () => {
      done()
    })
    node.activate()
  })
  it('prop node.master is not settable nor mutable', (done) => {
    let node = Node()
    should(() => { node.master = {} }).throw()
    node.on('ready', () => {
      node.master.prop = true
      node.master.endpoints.prop = true
      should(node.master.prop).be.Undefined()
      should(node.master.endpoints.prop).be.Undefined()
      node.deactivate()
    })
    node.on('deactivated', () => done())
    node.activate()
  })
  it('has prop node.isMaster: is a boolean', () => {
    let node = Node()
    should(node.isMaster).be.a.Boolean()
  })
  if (!EXTERNAL) {
    it('node.isMaster is true while the node has the master role', function (done) {
      this.timeout(10000)

      let node = Node()
      should(node.isMaster).be.False()
      node.activate()
      node.once('ready', () => {
        restartBusNode1()
        .then(() => {
          should(node.isMaster).be.True()
          node.deactivate()
        })
        .catch(done)
      })
      node.once('deactivated', () => {
        should(node.isMaster).be.False()
        done()
      })
    })
  }
})
