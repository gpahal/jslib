// The fix adds a second import of `useActionState`, a syntax error
import { useActionState } from 'react'
import { useFormState } from 'react-dom'

export function useForms(action) {
  return [useFormState(action, 0), useActionState(action, 0)]
}
