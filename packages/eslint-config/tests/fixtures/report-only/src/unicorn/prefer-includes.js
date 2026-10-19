// `indexOf` never finds `NaN`, and `includes` does
export function isMissing(values, value) {
  return values.indexOf(value) === -1
}
