// `new Array(...a, ...b)` with `a = [3]` and `b = []` is a sparse array of length 3, and `[...a, ...b]` is `[3]`
export function make(a: Array<number>, b: Array<number>): Array<number> {
  return new Array(...a, ...b)
}
