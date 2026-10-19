// `setTimeout(report, 0, value)` would read `value` when the timer is scheduled, not when it fires
export function schedule(report) {
  let value = 'before'
  setTimeout(() => report(value), 0)
  value = 'after'
  return value
}
