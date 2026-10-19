/* eslint react-hooks/incompatible-library: "error" */
import { useForm } from 'react-hook-form'

export function Form() {
  const { watch } = useForm()
  const name = watch('name')
  return <div>{name}</div>
}
