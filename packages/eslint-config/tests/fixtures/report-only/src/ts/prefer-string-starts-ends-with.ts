// With `s = 'a'` and `x = 'ab'`, both sides are `-1`, so this is `true`, and `s.endsWith(x)` is `false`
export function ends(s: string, x: string): boolean {
  return s.lastIndexOf(x) === s.length - x.length
}
