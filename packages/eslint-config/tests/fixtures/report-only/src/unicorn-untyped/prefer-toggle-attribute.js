// An `@xmldom/xmldom` element has `setAttribute` and `removeAttribute` but no `toggleAttribute`
export function toggleHidden(element) {
  if (element.hasAttribute('hidden')) {
    element.removeAttribute('hidden')
  } else {
    element.setAttribute('hidden', '')
  }
}
