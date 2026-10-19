// `Object.assign` sets the prototype from an own `__proto__` key, as `JSON.parse` makes one, and spread copies it as a key
export function copy(source) {
  return Object.assign({}, source)
}
