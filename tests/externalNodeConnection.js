import should from 'should/as-function'

import { ExternalNode } from '../src'

const DNSHOST = 'cluster'

describe('DNS-MessageBus-ExternalNode', () => {
  it('should be able to connect to an existing cluster', function (done) {
    this.timeout(1000)
    let node = ExternalNode(DNSHOST, {debug: true})
    node.connect()
    node.on('connect', () => {
      done()
    })
    node.on('nodes', id => console.log(id))
  })
})
