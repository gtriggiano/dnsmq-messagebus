import should from 'should/as-function'
import sinon from 'sinon'

import { ExternalNode } from '../src'

const DNSHOST = process.env.DNSHOST

describe('ExternalNode(host [, settings])', () => {
  it('should throw if host is not passed as first parameter', () => {
    function trowingCall () {
      return ExternalNode()
    }
    should(trowingCall).throw()
  })
  it('should throw if settings.externalUpdatesPort is not a positive integer', () => {
    function trowingCall () {
      return ExternalNode(DNSHOST, {externalUpdatesPort: -30})
    }
    function trowingCall1 () {
      return ExternalNode(DNSHOST, {externalUpdatesPort: ''})
    }
    should(trowingCall).throw()
    should(trowingCall1).throw()
  })
})
