/* eslint react-hooks/config: ["error", { "environment": { "moduleTypeProvider": 1 } }] */
import { format } from './format.js'

export function Label({ date }) {
  return <span>{format(date)}</span>
}
