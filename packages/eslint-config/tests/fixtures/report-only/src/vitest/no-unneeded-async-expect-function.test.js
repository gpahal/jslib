// `f()` throwing synchronously fails `expect(f())`, and the async function turns the throw into a rejection
import { expect, test } from 'vitest'

function f() {
  throw new Error('x')
}

test('rejects', async () => {
  await expect(async () => {
    await f()
  }).rejects.toThrow('x')
})
