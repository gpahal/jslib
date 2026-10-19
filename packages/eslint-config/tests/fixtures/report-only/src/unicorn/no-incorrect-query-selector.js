// A missing element is `undefined` here and `null` from `querySelector`
export function first(root) {
  return root.querySelectorAll('.x')[0]
}
