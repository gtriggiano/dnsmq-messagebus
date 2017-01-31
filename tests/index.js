import should from 'should/as-function'

import { Node } from '../src'

describe('dnsmq-messagebus', () => {
  it('should be fun', () => {})
  it('should export a Node factory function', () => {
    should(Node).be.a.function
  })
})

require('./Node')
