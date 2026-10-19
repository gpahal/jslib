// `new Date(timer)` is `NaN` for a non-`Date` with a `getTime`
export function at(timer) {
  return new Date(timer.getTime())
}
