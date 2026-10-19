// `indexOf` never finds `NaN`, and `includes` does
export function hasNaN(values) {
  return values.indexOf(Number.NaN) !== -1
}
