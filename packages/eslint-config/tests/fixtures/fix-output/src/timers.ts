/**
 * Reports the value that `value` holds when the timer fires
 */
export function schedule(report: (value: string) => void): string {
  let value = 'before'
  // `e18e/prefer-timer-args`' fix would read `value` when the timer is scheduled
  setTimeout(() => report(value), 0)
  value = 'after'
  return value
}
