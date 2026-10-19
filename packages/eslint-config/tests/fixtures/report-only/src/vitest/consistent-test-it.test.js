// The fix renames `test` to `it`, which isn't imported
import { describe, expect, test } from 'vitest'

describe('sum', () => {
  test('adds', () => {
    expect(1 + 1).toBe(2)
  })
})
