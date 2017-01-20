import should from 'should/as-function'

import { DNSNode, ExternalNode } from '../src'

describe('DNS-MessageBus', () => {
  it('should be fun', () => {})
  it('should export a DNSNode factory function', () => {
    should(DNSNode).be.a.function
  })
  it('should export an ExternalNode factory function', () => {
    should(ExternalNode).be.a.function
  })

  require('./DNSNode-tests')
  require('./ExternalNode-tests')
})
