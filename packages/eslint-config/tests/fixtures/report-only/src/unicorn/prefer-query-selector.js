// `getElementsByClassName` is live, so the loop ends, and `querySelectorAll` is static
export function clear(list) {
  const items = list.getElementsByClassName('done')
  while (items.length > 0) {
    items[0].classList.remove('done')
  }
}
