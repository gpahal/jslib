// `getHTML` is newer than `innerHTML`, and an older browser or DOM library lacks it
export function html(element) {
  return element.innerHTML
}
