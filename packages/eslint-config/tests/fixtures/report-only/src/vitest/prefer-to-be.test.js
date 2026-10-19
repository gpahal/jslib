// The first fix gives `.not.toBeDefined()`, and the next pass inverts it to `.toBeUndefined()`
import { expect, test } from 'vitest'

test('is set', () => {
  const value = 1
  expect(value).not.toEqual(undefined)
})
