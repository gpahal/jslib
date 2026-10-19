export function pick(a, b, x, y) {
  return a ? (b ? x : y) : y
}
