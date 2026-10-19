// `createRoot(element).render` returns `undefined` and drops the callback
import ReactDOM from 'react-dom'

export function start(element, onDone) {
  return ReactDOM.render(<div />, element, onDone)
}
