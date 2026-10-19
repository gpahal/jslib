// Destructuring iterates `items`, which can be a `Set`, and indexing a `Set` gives `undefined`
export function third(items) {
  const [, , value] = items
  return value
}
