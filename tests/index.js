import should from 'should/as-function'

import { DNSNode, ExternalNode } from '../src'

const DNSHOST = process.env.DNSHOST

describe('DNS-MessageBus', () => {
  it('should be fun', () => {})
  it('should export a DNSNode factory function', () => {
    should(DNSNode).be.a.function
    let dnsNode = DNSNode(DNSHOST)
    should(dnsNode).be.an.instanceof(DNSNode)
  })
  it('should export an ExternalNode factory function', () => {
    should(ExternalNode).be.a.function
    let externalNode = ExternalNode(DNSHOST)
    should(externalNode).be.an.instanceof(ExternalNode)
  })

  require('./DNSNode-tests')
  require('./ExternalNode-tests')
})
