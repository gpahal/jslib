// Renaming the test orphans its snapshot
import { expect, test } from 'vitest'

test(' adds ', () => {
  expect(1 + 1).toMatchSnapshot()
})
