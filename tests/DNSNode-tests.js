import should from 'should/as-function'
import sinon from 'sinon'

import { DNSNode } from '../src'

const DNSHOST = process.env.DNSHOST

describe('DNSNode(host [, settings])', () => {
  it('should throw if host is not passed as first parameter', () => {
    function trowingCall () {
      return DNSNode()
    }
    should(trowingCall).throw()
  })
  it('should throw if settings.coordinationPort is not a positive integer', () => {
    function trowingCall () {
      return DNSNode(DNSHOST, {coordinationPort: -30})
    }
    function trowingCall1 () {
      return DNSNode(DNSHOST, {coordinationPort: ''})
    }
    should(trowingCall).throw()
    should(trowingCall1).throw()
  })
  it('should throw if settings.electionTimeout is not a positive integer', () => {
    function trowingCall () {
      return DNSNode(DNSHOST, {electionTimeout: -30})
    }
    function trowingCall1 () {
      return DNSNode(DNSHOST, {electionTimeout: ''})
    }
    should(trowingCall).throw()
    should(trowingCall1).throw()
  })
  it('should throw if settings.electionPriority is not an integer between 0 and 99', () => {
    function trowingCall () {
      return DNSNode(DNSHOST, {electionPriority: -3})
    }
    function trowingCall1 () {
      return DNSNode(DNSHOST, {electionPriority: 100})
    }
    function trowingCall2 () {
      return DNSNode(DNSHOST, {electionPriority: ''})
    }
    should(trowingCall).throw()
    should(trowingCall1).throw()
    should(trowingCall2).throw()
  })
  it('should throw if settings.externalUpdatesPort is not a positive integer', () => {
    function trowingCall () {
      return DNSNode(DNSHOST, {externalUpdatesPort: -30})
    }
    function trowingCall1 () {
      return DNSNode(DNSHOST, {externalUpdatesPort: ''})
    }
    should(trowingCall).throw()
    should(trowingCall1).throw()
  })
  it('should throw if settings.coordinationPort and settings.externalUpdatesPort are equal', () => {
    function trowingCall () {
      return DNSNode(DNSHOST, {coordinationPort: 50061, externalUpdatesPort: 50061})
    }
    should(trowingCall).throw()
  })
  it('should console.warn() if settings.electionTimeout is set to less than 400 msec', () => {
    let stub = sinon.stub(console, 'warn')
    ;(function () {
      return new DNSNode(DNSHOST, {electionTimeout: 399})
    })()
    sinon.assert.calledOnce(stub)
    stub.restore()
  })
})
