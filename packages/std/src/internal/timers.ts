/**
 * Timer limits, shared by `promises` and `functions` so that loading `functions` doesn't load
 * `promises`
 */

/**
 * The largest delay `setTimeout` supports, in milliseconds. A larger delay overflows and fires after
 * 1ms, so the sleeps, `withTimeout`, `retry`, `debounce` and `throttle` reject or throw a
 * `RangeError` for one, and cap a jittered delay at it
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647
