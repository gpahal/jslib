// `hydrateRoot` makes a concurrent root and drops the callback
import { hydrate } from 'react-dom'

export function start(element, onDone) {
  hydrate(<div />, element, onDone)
}
