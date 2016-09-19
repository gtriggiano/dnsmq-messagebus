import { DNSNode } from '../src'

let messagebus = DNSNode('cluster', {debug: true})
messagebus.connect()
