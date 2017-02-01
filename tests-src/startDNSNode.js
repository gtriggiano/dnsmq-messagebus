const codePath = `../${process.env.CODE_PATH}`
const DNSHOST = process.env.DNSHOST

var Node = require(codePath).Node

var node = Node(DNSHOST)

node.activate()

process.on('SIGTERM', shutDown)
process.on('SIGINT', shutDown)

function shutDown () {
  node.on('deactivated', () => process.exit(0))
  node.deactivate()
}
