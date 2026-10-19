// `sort` sorts `items` in place and returns it, and a `Set` is a copy that misses what's pushed later
const items = ['b', 'a']
const sorted = items.sort()

export function check(value) {
  items.push('z')
  return sorted.includes(value)
}
