/**
 * Wrappers that control when a function runs: debounce, throttle, once and memoize. Contract:
 * functions from the developer's own code. The wrappers call them without a `this`. `memoize`
 * keeps every result until `clear()`, so it suits a bounded set of arguments
 */

import { describeValue } from '@/internal/describe'
import { stdMessage } from '@/internal/message'
import { checkFunction, checkNumber, checkOptions } from '@/internal/options'
import { MAX_TIMER_DELAY_MS } from '@/internal/timers'

/**
 * A function wrapped by {@link debounce} or {@link throttle}. A call schedules `fn` rather than
 * running it, so it returns nothing
 */
export type TimedFunction<A extends ReadonlyArray<unknown>, R> = {
  (...args: A): void
  /**
   * Drops the pending call, if any, and resets the timer, so the next call starts afresh
   */
  cancel: () => void
  /**
   * Runs the pending call now and returns its result, or `undefined` when no call is pending.
   * Running one starts another wait, as lodash does, so {@link throttle} keeps its calls `waitMs`
   * apart, and a {@link debounce} with `leading` doesn't treat the next call as a burst start
   */
  flush: () => R | undefined
}

export type DebounceOptions = {
  /**
   * Call `fn` at the start of a burst of calls. Default is `false`
   */
  leading?: boolean | undefined
  /**
   * Call `fn` with the last arguments once `waitMs` passes without a call. Default is `true`
   */
  trailing?: boolean | undefined
  /**
   * The longest time, in milliseconds, that a burst of calls can go without calling `fn`, as
   * lodash's `maxWait`. Once it passes, `fn` runs with the pending call's arguments or, without
   * `trailing`, at the next call. From `waitMs` to 2^31 - 1. Default is no limit
   */
  maxWaitMs?: number | undefined
}

export type ThrottleOptions = {
  /**
   * Call `fn` on the first call, when no call ran in the last `waitMs`. Default is `true`
   */
  leading?: boolean | undefined
  /**
   * Call `fn` at the end of the wait with the last arguments of the calls made during it. Default is
   * `true`
   */
  trailing?: boolean | undefined
}

function checkTimedArguments(
  caller: string,
  fn: unknown,
  waitMs: number,
  options: DebounceOptions | ThrottleOptions,
  defaults: { leading: boolean; trailing: boolean },
): { leading: boolean; trailing: boolean } {
  checkFunction(caller, fn)
  checkNumber(caller, '`waitMs`', waitMs)
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > MAX_TIMER_DELAY_MS) {
    throw new RangeError(
      stdMessage(
        [caller, '`waitMs`'],
        `expected a number between 0 and ${MAX_TIMER_DELAY_MS}, received ${describeValue(waitMs)}`,
      ),
    )
  }
  checkOptions(caller, options)
  const { leading = defaults.leading, trailing = defaults.trailing } = options
  for (const [name, value] of [
    ['`options.leading`', leading],
    ['`options.trailing`', trailing],
  ] as const) {
    if (typeof value !== 'boolean') {
      throw new TypeError(
        stdMessage(
          [caller, name],
          `expected a boolean or \`undefined\`, received ${describeValue(value)}`,
        ),
      )
    }
  }
  return { leading, trailing }
}

function checkMaxWait(waitMs: number, untypedMaxWaitMs: unknown): number | undefined {
  if (untypedMaxWaitMs === undefined) {
    return undefined
  }
  const maxWaitMs = checkNumber(
    '`debounce`',
    '`options.maxWaitMs`',
    untypedMaxWaitMs,
    'a number or `undefined`',
  )
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < waitMs || maxWaitMs > MAX_TIMER_DELAY_MS) {
    throw new RangeError(
      stdMessage(
        ['`debounce`', '`options.maxWaitMs`'],
        `expected a number between \`waitMs\`, which is ${describeValue(waitMs)}, and ${MAX_TIMER_DELAY_MS}, received ${describeValue(maxWaitMs)}`,
      ),
    )
  }
  return maxWaitMs
}

/**
 * The pending call's arguments are wrapped, so a call with no arguments still counts
 */
type TimerState<A> = {
  timeout: ReturnType<typeof setTimeout> | undefined
  pending: { args: A } | undefined
}

function runPending<A extends ReadonlyArray<unknown>, R>(
  state: TimerState<A>,
  fn: (...args: A) => R,
): R | undefined {
  const call = state.pending
  state.pending = undefined
  return call === undefined ? undefined : fn(...call.args)
}

/**
 * `flush` calls `startWait` before it runs a pending call, so a call that `fn` makes waits too
 */
function withControls<A extends ReadonlyArray<unknown>, R>(
  call: (...args: A) => void,
  state: TimerState<A>,
  fn: (...args: A) => R,
  { startWait, onCancel }: { startWait: () => void; onCancel?: () => void },
): TimedFunction<A, R> {
  return Object.assign(call, {
    cancel: () => {
      clearTimeout(state.timeout)
      state.timeout = undefined
      state.pending = undefined
      onCancel?.()
    },
    flush: (): R | undefined => {
      if (state.pending === undefined) {
        return undefined
      }
      startWait()
      return runPending(state, fn)
    },
  })
}

/**
 * Wrap `fn` so a burst of calls runs it once: with `trailing`, the default, with the last call's
 * arguments once `waitMs` milliseconds pass without a call, and with `leading`, at the first call.
 * With both, a burst of one call runs `fn` once. Each call restarts the wait, so a burst that never
 * pauses runs `fn` only at its start, unless `maxWaitMs` is set. `cancel()` drops a pending call and
 * ends the burst, and `flush()` runs the pending call now.
 *
 * Arguments of the wrong type throw a `TypeError`, and a `waitMs` outside 0 to 2^31 - 1 or a
 * `maxWaitMs` outside `waitMs` to 2^31 - 1 a `RangeError`. An error that `fn` throws at the end of a
 * wait is thrown from the timer, as an uncaught error
 *
 * @example
 * ```ts
 * import { debounce } from '@gpahal/std/functions'
 *
 * const saved: Array<string> = []
 * const save = debounce((text: string) => {
 *   saved.push(text)
 * }, 500)
 * save('a')
 * save('ab') // Only this call saves, 500ms after it
 * save.flush() // Saves now instead
 * saved // ['ab']
 * ```
 */
export function debounce<A extends ReadonlyArray<unknown>, R>(
  fn: (...args: A) => R,
  waitMs: number,
  options: DebounceOptions = {},
): TimedFunction<A, R> {
  const { leading, trailing } = checkTimedArguments('`debounce`', fn, waitMs, options, {
    leading: false,
    trailing: true,
  })
  const maxWaitMs = checkMaxWait(waitMs, options.maxWaitMs)
  const state: TimerState<A> = { timeout: undefined, pending: undefined }
  // `isMaxDue` is set when the `maxWaitMs` timer fired with no pending call, so the next call runs
  // `fn`
  let maxTimeout: ReturnType<typeof setTimeout> | undefined
  let isMaxDue = false
  const stopMaxWait = () => {
    clearTimeout(maxTimeout)
    maxTimeout = undefined
    isMaxDue = false
  }
  const startMaxWait = () => {
    stopMaxWait()
    if (maxWaitMs !== undefined) {
      maxTimeout = setTimeout(onMaxTimeout, maxWaitMs)
    }
  }
  const onTimeout = () => {
    state.timeout = undefined
    stopMaxWait()
    runPending(state, fn)
  }
  const onMaxTimeout = () => {
    if (state.pending === undefined) {
      maxTimeout = undefined
      isMaxDue = true
      return
    }
    startMaxWait()
    runPending(state, fn)
  }
  const debounced = (...args: A): void => {
    const isBurstStart = state.timeout === undefined
    clearTimeout(state.timeout)
    state.timeout = setTimeout(onTimeout, waitMs)
    if (isMaxDue || (isBurstStart && leading)) {
      startMaxWait()
      state.pending = undefined
      fn(...args)
      return
    }
    if (isBurstStart) {
      startMaxWait()
    }
    if (trailing) {
      state.pending = { args }
    }
  }
  return withControls(debounced, state, fn, {
    startWait: () => {
      clearTimeout(state.timeout)
      // Without `leading`, a burst that starts now runs as one that starts later
      state.timeout = leading ? setTimeout(onTimeout, waitMs) : undefined
      if (leading) {
        startMaxWait()
      } else {
        stopMaxWait()
      }
    },
    onCancel: stopMaxWait,
  })
}

/**
 * Wrap `fn` so it runs at most once every `waitMs` milliseconds: with `leading`, the default, at a
 * call when none ran in the last `waitMs`, and with `trailing`, the default, at the end of the wait
 * with the last arguments of the calls made during it, which starts another wait. `cancel()` drops a
 * pending call and ends the wait, and `flush()` runs the pending call now and starts another wait.
 *
 * Arguments of the wrong type throw a `TypeError`, and a `waitMs` outside 0 to 2^31 - 1 a
 * `RangeError`. An error that `fn` throws at the end of a wait is thrown from the timer, as an
 * uncaught error
 *
 * @example
 * ```ts
 * import { throttle } from '@gpahal/std/functions'
 *
 * const seen: Array<number> = []
 * const report = throttle((y: number) => {
 *   seen.push(y)
 * }, 100)
 * report(1) // Runs now
 * report(2)
 * report(3) // Runs at the end of the wait, and 2 never does
 * report.flush() // Runs the pending call now instead, and starts another wait
 * report(4) // Runs at the end of that wait
 * seen // [1, 3]
 * ```
 */
export function throttle<A extends ReadonlyArray<unknown>, R>(
  fn: (...args: A) => R,
  waitMs: number,
  options: ThrottleOptions = {},
): TimedFunction<A, R> {
  const { leading, trailing } = checkTimedArguments('`throttle`', fn, waitMs, options, {
    leading: true,
    trailing: true,
  })
  const state: TimerState<A> = { timeout: undefined, pending: undefined }
  const onTimeout = () => {
    // A trailing call starts another wait, so calls stay `waitMs` apart
    if (state.pending === undefined) {
      state.timeout = undefined
      return
    }
    state.timeout = setTimeout(onTimeout, waitMs)
    runPending(state, fn)
  }
  const throttled = (...args: A): void => {
    if (state.timeout !== undefined) {
      if (trailing) {
        state.pending = { args }
      }
      return
    }
    state.timeout = setTimeout(onTimeout, waitMs)
    if (leading) {
      fn(...args)
    } else if (trailing) {
      state.pending = { args }
    }
  }
  return withControls(throttled, state, fn, {
    startWait: () => {
      clearTimeout(state.timeout)
      state.timeout = setTimeout(onTimeout, waitMs)
    },
  })
}

/**
 * Wrap `fn` so only the first call runs it. Every call returns what that call returned, or throws
 * what it threw, so a returned promise is reused. Later arguments are ignored. An `fn` that isn't a
 * function throws a `TypeError`, and so does a call from inside `fn`, which has no result yet
 *
 * @example
 * ```ts
 * import { once } from '@gpahal/std/functions'
 *
 * const load = once(() => ({ loadedAt: Date.now() }))
 * const first = load()
 * load() === first // true
 * ```
 */
export function once<A extends ReadonlyArray<unknown>, R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  checkFunction('`once`', fn)
  // Drops `fn` after the first call, so its closure can be collected
  let state: { fn: (...args: A) => R } | { value: R } | { error: unknown } = { fn }
  let isRunning = false
  return (...args: A): R => {
    if (isRunning) {
      throw new TypeError(
        stdMessage(['`once`'], 'the function was called again while its first call runs'),
      )
    }
    if ('fn' in state) {
      const call = state.fn
      isRunning = true
      try {
        state = { value: call(...args) }
      } catch (error) {
        state = { error }
      } finally {
        isRunning = false
      }
    }
    if ('error' in state) {
      throw state.error
    }
    return state.value
  }
}

/**
 * A function wrapped by {@link memoize}
 */
export type MemoizedFunction<A extends ReadonlyArray<unknown>, R> = {
  (...args: A): R
  /**
   * Forgets every kept result, so the next call with any arguments runs `fn` again
   */
  clear: () => void
}

export type MemoizeOptions<A extends ReadonlyArray<unknown>> = {
  /**
   * Gives the cache key of a call's arguments. Results are kept by the key, compared as a `Map`
   * compares keys. Default is the first argument
   */
  key?: ((...args: A) => unknown) | undefined
}

/**
 * Wrap `fn` so a call with the same cache key as an earlier one returns that call's result rather
 * than running `fn` again. The key is the first argument, or what `options.key` gives for the
 * arguments. Keys compare as in a `Map`, and object and function keys are held weakly. `fn` gets
 * every argument of the call.
 *
 * A result is kept until `clear()`, even `undefined` or a promise that rejects. A call that throws
 * keeps nothing.
 *
 * Without `key`, `fn` of more than one parameter, or a rest parameter, is a type error, since only
 * the first argument would be the key. Arguments of the wrong type throw a `TypeError`
 *
 * @example
 * ```ts
 * import { memoize } from '@gpahal/std/functions'
 *
 * const square = memoize((n: number) => n * n)
 * square(3) // 9
 * square(3) // 9, from the first call's result
 *
 * const area = memoize((width: number, height: number) => width * height, {
 *   key: (width, height) => `${width}x${height}`,
 * })
 * area(2, 3) // 6
 * area.clear()
 * ```
 */
export function memoize<A extends [] | [unknown] | [unknown?], R>(
  fn: (...args: A) => R,
  options?: MemoizeOptions<A>,
): MemoizedFunction<A, R>
/**
 * {@link memoize} for a function of more than one parameter or a rest parameter, which needs a
 * `key`
 */
export function memoize<A extends ReadonlyArray<unknown>, R>(
  fn: (...args: A) => R,
  options: MemoizeOptions<A> & { key: (...args: A) => unknown },
): MemoizedFunction<A, R>
export function memoize<A extends ReadonlyArray<unknown>, R>(
  fn: (...args: A) => R,
  options: MemoizeOptions<A> = {},
): MemoizedFunction<A, R> {
  checkFunction('`memoize`', fn)
  checkOptions('`memoize`', options)
  const { key } = options
  if (key !== undefined && typeof key !== 'function') {
    throw new TypeError(
      stdMessage(
        ['`memoize`', '`options.key`'],
        `expected a function or \`undefined\`, received ${describeValue(key)}`,
      ),
    )
  }
  let primitiveResults = new Map<unknown, R>()
  let objectResults = new WeakMap<object, R>()
  const memoized = (...args: A): R => {
    const cacheKey: unknown = key === undefined ? args[0] : key(...args)
    if (isWeakKey(cacheKey)) {
      if (objectResults.has(cacheKey)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The key has a result
        return objectResults.get(cacheKey) as R
      }
      const result = fn(...args)
      objectResults.set(cacheKey, result)
      return result
    }
    if (primitiveResults.has(cacheKey)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The key has a result
      return primitiveResults.get(cacheKey) as R
    }
    const result = fn(...args)
    primitiveResults.set(cacheKey, result)
    return result
  }
  return Object.assign(memoized, {
    clear: () => {
      primitiveResults = new Map()
      // A `WeakMap` can't be cleared
      objectResults = new WeakMap()
    },
  })
}

/**
 * Symbols go in the `Map`, since a registered one can't be a `WeakMap` key
 */
function isWeakKey(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}
