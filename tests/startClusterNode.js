import { DNSNode } from '../src'

let messagebus = DNSNode('cluster')
messagebus.connect()
messagebus.on('connect', () => {
  console.log('CONNECTED')
})
