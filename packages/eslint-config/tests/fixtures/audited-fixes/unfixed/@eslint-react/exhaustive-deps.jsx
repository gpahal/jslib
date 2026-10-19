/* eslint @eslint-react/exhaustive-deps: "error" */
import { useEffect } from 'react'

export function Logger({ value }) {
  useEffect(() => {
    console.log(value)
  }, [])
  return null
}
