export function read(source) {
  const map = Object.fromEntries(Object.entries(source))
  return map.name
}
