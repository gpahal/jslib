import { useMemo } from 'react'

export function Logger({ value }) {
  const logged = useMemo(() => {
    console.log(value)
  }, [value])
  return <div>{logged}</div>
}
