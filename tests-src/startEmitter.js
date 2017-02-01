const codePath = `../${process.env.CODE_PATH}`
const DNSHOST = 'bus'

var Node = require(codePath).Node

var node = Node(DNSHOST, {external: true})

var _canPublish = false
node.on('can:publish', () => { _canPublish = true })
node.on('cannot:publish', () => { _canPublish = false })

var messageNo = 0
var emissionInterval = setInterval(() => {
  switch (_canPublish) {
    case true:
      messageNo++
      node.publish('testChannelOne', node.name, messageNo)
      node.publish('testChannelTwo', node.name, messageNo)
      break
    default:
      console.log()
      console.log(`Cannot publish, will delay emission of message ${messageNo + 1}`)
      console.log()
  }
}, 300)

node.activate()

process.on('SIGTERM', shutDown)
process.on('SIGINT', shutDown)

function shutDown () {
  clearInterval(emissionInterval)
  node.on('deactivated', () => process.exit(0))
  node.deactivate()
}
