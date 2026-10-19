import { expect, test } from 'vitest'

test('greets', () => {
  const name = 'world'
  expect(`hello ${name}`).toMatchInlineSnapshot(`"hello ${name}"`)
})
