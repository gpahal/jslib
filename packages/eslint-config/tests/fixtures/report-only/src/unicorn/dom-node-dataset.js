// An element of an XML document has no `dataset`, so the fix throws where `setAttribute` works
export function tag(xml, id) {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  document.documentElement.setAttribute('data-id', id)
  return document
}
