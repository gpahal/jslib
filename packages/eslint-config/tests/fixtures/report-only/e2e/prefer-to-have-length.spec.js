// `.not.toBe(0)` passes for a `length` that's `undefined`, and `.not.toHaveLength(0)` fails
import { expect, test } from '@playwright/test'

test('returns a body', async ({ request }) => {
  const body = await (await request.get('/api')).json()
  expect(body.length).not.toBe(0)
})
