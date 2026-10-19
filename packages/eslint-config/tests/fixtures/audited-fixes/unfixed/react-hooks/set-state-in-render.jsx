import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  setCount(count + 1)
  return <div>{count}</div>
}
