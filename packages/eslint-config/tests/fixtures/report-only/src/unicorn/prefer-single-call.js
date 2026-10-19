// Merged, `element.classList[0]` is read before the first `add`
export function mark(element) {
  element.classList.add('active')
  element.classList.add(`${element.classList[0]}-marked`)
}
