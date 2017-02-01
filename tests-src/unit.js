import should from 'should/as-function'
import EventEmitter from 'eventemitter3'

const codePath = `../${process.env.CODE_PATH}`

const DNSHOST = 'host'

var Node = require(codePath).Node

describe('dnsmq-messagebus', () => {
  it('should be fun', () => {})
  it('should export a Node factory function', () => {
    should(Node).be.a.Function()
  })
})

describe('Node(host [, settings])', () => {
  it('should throw if host is not passed as first parameter', () => {
    function trowingCall () {
      return Node()
    }
    should(trowingCall).throw()
  })
  it('should throw if settings.coordinationPort is not a positive integer', () => {
    function trowingCall () {
      return Node(DNSHOST, {coordinationPort: -30})
    }
    function trowingCall1 () {
      return Node(DNSHOST, {coordinationPort: ''})
    }
    should(trowingCall).throw()
    should(trowingCall1).throw()
  })
  it('should throw if settings.voteTimeout is not a positive integer', () => {
    function trowingCall () {
      return Node(DNSHOST, {voteTimeout: -30})
    }
    function trowingCall1 () {
      return Node(DNSHOST, {voteTimeout: ''})
    }
    should(trowingCall).throw()
    should(trowingCall1).throw()
  })
  it('should throw if settings.electionPriority is not an integer between 0 and 99', () => {
    function trowingCall () {
      return Node(DNSHOST, {electionPriority: -3})
    }
    function trowingCall1 () {
      return Node(DNSHOST, {electionPriority: 100})
    }
    function trowingCall2 () {
      return Node(DNSHOST, {electionPriority: ''})
    }
    should(trowingCall).throw()
    should(trowingCall1).throw()
    should(trowingCall2).throw()
  })
})

describe('node instance', () => {
  let node = Node(DNSHOST)
  it('is an eventemitter', () => should(node).be.instanceof(EventEmitter))
  it('has property `id`', () => should(node.id).be.a.String())
  it('has property `name`', () => should(node.name).be.a.String())
  it('has property `settings`', () => should(node.settings).be.a.Object())
  it('has property `type`', () => should(node.type).be.a.String())
  it('has property `canPublish`', () => should(node.canPublish).be.a.Boolean())
  it('has property `isReceiving`', () => should(node.isReceiving).be.a.Boolean())
  it('has property `isReady`', () => should(node.isReady).be.a.Boolean())
  it('has property `subscribedChannels`', () => should(node.subscribedChannels).be.a.Array())
  it('has property `master`', () => node.master && should(node.master).be.a.Object())
  it('has method `activate`', () => should(node.activate).be.a.Function())
  it('has method `deactivate`', () => should(node.deactivate).be.a.Function())
  it('has method `publish`', () => should(node.publish).be.a.Function())
  it('has method `subscribe`', () => should(node.subscribe).be.a.Function())
  it('has method `unsubscribe`', () => should(node.unsubscribe).be.a.Function())
})
