export function isBelow(value: number, limit: number): boolean {
  // Negated so that `NaN` fails too
  return !(value >= limit)
}
