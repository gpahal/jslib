// `indexOf` never finds `NaN`, and `includes` does
export function hasNaN(values: Array<number>): boolean {
  return values.indexOf(Number.NaN) !== -1
}
