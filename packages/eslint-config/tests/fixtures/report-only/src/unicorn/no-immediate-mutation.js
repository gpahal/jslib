// `Object.assign` sets the prototype from an own `__proto__` key, and spread copies it as a key
export function copy(parsed) {
  const target = {}
  Object.assign(target, parsed)
  return target
}
