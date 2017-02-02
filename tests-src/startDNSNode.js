const codePath = `../${process.env.CODE_PATH}`
const DNSHOST = 'dnsmq-messagebus-development-bus.docker'

var Node = require(codePath).Node

var node = Node(DNSHOST)

node.on('ready', () => console.log('bus node connected'))
node.on('not:ready', () => console.log('bus node disconnected'))

node.activate()

process.on('SIGTERM', shutDown)
process.on('SIGINT', shutDown)

function shutDown () {
  console.log('received kill signal')
  node.on('deactivated', () => process.exit(0))
  node.deactivate()
}
