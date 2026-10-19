// The merged assertion goes where the first was, before the call with `2`, so the test fails
import { expect, test, vi } from 'vitest'

test('calls', () => {
  const mock = vi.fn()
  mock(1)
  expect(mock).toHaveBeenCalledOnce()
  mock(2)
  expect(mock).toHaveBeenCalledWith(2)
})
