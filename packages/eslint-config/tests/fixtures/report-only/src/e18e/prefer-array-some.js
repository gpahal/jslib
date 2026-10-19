// `find` returns the element, which is falsy for `0`, and `some` returns `true`
export function hasZero(values) {
  return values.find((value) => value === 0) ? 'found' : 'missing'
}
