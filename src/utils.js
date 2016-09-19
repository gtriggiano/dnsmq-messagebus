import os from 'os'
import { ZMQ_LAST_ENDPOINT } from 'zmq'
import { curry, noop } from 'lodash'

const prefixString = curry(function prefixString (prefix, str) {
  return `${prefix}${str}`
})

function nodeIdToName (id) { return id.substring(3, 11) }

function debugLog (prefix, enabled) {
  if (!enabled) return noop
  return (...args) => console.log(prefix, new Date().toISOString(), ...args)
}

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
  debugLog,
  getSocketEndpoint,
  zeropad
}
