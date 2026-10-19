// `RegExp(pattern)` returns the same regex, and `new RegExp(pattern)` a copy
export function same(pattern) {
  return RegExp(pattern) === pattern
}
