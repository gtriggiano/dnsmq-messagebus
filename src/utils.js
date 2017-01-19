import os from 'os'
import { ZMQ_LAST_ENDPOINT } from 'zeromq'
import { curry } from 'lodash'

const prefixString = curry(function prefixString (prefix, str) {
  return `${prefix}${str}`
})

function nodeIdToName (id) { return id.substring(3, 11) }

function boxExternalIps () {
  let ifaces = os.networkInterfaces()
  return Object.keys(ifaces).reduce((ips, ifaceName) => {
    return ips.concat(ifaces[ifaceName].filter(address => !address.internal && address.family === 'IPv4'))
  }, []).map(({address}) => address)
}

function getSocketEndpoint (socket) {
  let address = socket.getsockopt(ZMQ_LAST_ENDPOINT)
  let ip = boxExternalIps()[0]
  return ip ? address.replace(/0\.0\.0\.0/, ip) : undefined
}

function zeropad (num, len) {
  let str = String(num)
  while (str.length < len) {
    str = `0${str}`
  }
  return str
}

export {
  nodeIdToName,
  prefixString,
  getSocketEndpoint,
  zeropad
}
