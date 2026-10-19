import { useEffect, useState } from 'react'

export function Mirror({ value }) {
  const [copy, setCopy] = useState(value)
  useEffect(() => {
    setCopy(value)
  }, [value])
  return <div>{copy}</div>
}
