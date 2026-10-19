import { useState } from 'react'

export function Counter() {
  const [state] = useState({ count: 0 })
  state.count = 1
  return <div>{state.count}</div>
}
