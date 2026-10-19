// A value that's already escaped is escaped again
export function find(root, selector) {
  return root.querySelector(`[data-id="${selector}"]`)
}
