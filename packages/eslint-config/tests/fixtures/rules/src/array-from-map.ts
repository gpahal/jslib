export function double(values: Set<number>): Array<number> {
  return [...values].map((value) => value * 2)
}
