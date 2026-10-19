/* eslint react-hooks/preserve-manual-memoization: "error" */
import { useMemo } from 'react'

import { link } from './link.js'

export function List({ value }) {
  const a = {}
  const b = {}
  link(a, b)
  const list = useMemo(() => [a], [a])
  b.value = value
  return <div>{list.length}</div>
}
