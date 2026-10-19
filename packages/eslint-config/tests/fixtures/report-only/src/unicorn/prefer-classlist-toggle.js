// `toggle('open', undefined)` toggles the class, where the `if` removes it for an `undefined` `open`
export function setOpen(element, open) {
  if (open) {
    element.classList.add('open')
  } else {
    element.classList.remove('open')
  }
}
