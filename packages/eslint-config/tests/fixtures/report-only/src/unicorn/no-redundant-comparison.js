// Removing `b !== 1` runs `init(b)` when `b === 1` too
export function check(a, b, init) {
  return b !== 1 && init(b) && a === 1 && a !== b
}
