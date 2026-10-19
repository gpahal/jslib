// `node:test`'s `mock` and its runner aren't Vitest's
import { mock, test } from 'node:test'

test('mocks', () => {
  mock.fn()
})
