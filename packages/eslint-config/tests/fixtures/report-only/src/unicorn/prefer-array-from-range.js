// `Array(1.5)` throws a `RangeError`, and `Array.from({ length: 1.5 }, …)` truncates
export function indexes(total, size) {
  return [...Array(total / size).keys()]
}
