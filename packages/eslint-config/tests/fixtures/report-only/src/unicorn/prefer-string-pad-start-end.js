// `repeat` throws a `RangeError` for a code longer than 4 characters, and `padStart` returns it
export function pad(code) {
  return '0'.repeat(4 - code.length) + code
}
