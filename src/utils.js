import uuid from 'uuid'
import { ZMQ_LAST_ENDPOINT } from 'zeromq'
import { curry } from 'lodash'

export const prefixString = curry(function prefixString (prefix, str) {
  return `${prefix}${str}`
})

export function nodeIdToName (id) { return id.substring(3, 11) }

export function getSocketPort (socket) {
  let address = socket.getsockopt(ZMQ_LAST_ENDPOINT)
  return address.replace(/tcp:\/\/0\.0\.0\.0:/, '')
}

export function zeropad (num, len) {
  let str = String(num)
  while (str.length < len) {
    str = `0${str}`
  }
  return str
}

export function getNodeId ({external, electionPriority}) {
  return external
    ? `EX-${uuid.v4()}`
    : `${zeropad(99 - electionPriority, 2)}-${uuid.v4()}`
}

export function timingoutCallback (fn, ms) {
  let _fired = false
  function callback (err, ...args) {
    if (_fired) return
    _fired = true
    fn(err, ...args)
  }
  setTimeout(() => {
    let error = new Error('Timeout')
    callback(error)
  }, ms)
  return callback
}
