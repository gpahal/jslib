import { useRef } from 'react'

export function Counter() {
  const count = useRef(0)
  count.current = count.current + 1
  return <div>{count.current}</div>
}
