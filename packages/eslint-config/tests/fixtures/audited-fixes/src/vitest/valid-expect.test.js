import { expect, test } from 'vitest'

test('resolves', async () => {
  expect(Promise.resolve(1)).resolves.toBe(1)
})
