import { useMemo } from 'react'

export function Total({ items }) {
  const total = useMemo((extra) => items.length + extra, [items])
  return <div>{total}</div>
}
