/**
 * Sleeps, timeouts, bounded concurrency, a mutex and promise checks. Contract: callbacks,
 * iterables, async iterables, thenables and signals from the developer's own code. A signal is any
 * object with a boolean `aborted` and `addEventListener` and `removeEventListener` methods, so one
 * from another realm or a polyfill works. An invalid number rejects with a `RangeError`, and an
 * argument of the wrong type with a `TypeError`
 */

import { describeValue } from '@/internal/describe'
import { stdMessage } from '@/internal/message'
import { checkFunction, checkNumber, checkOptions } from '@/internal/options'
import { MAX_TIMER_DELAY_MS } from '@/internal/timers'
import { createQueue, type Queue } from '@/queue'

export { MAX_TIMER_DELAY_MS } from '@/internal/timers'

/**
 * Check if a value is `instanceof Promise`, so a promise from another realm doesn't pass. Use
 * {@link isPromiseLike} to accept those and any other thenable
 */
export function isPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise
}

/**
 * Check if a value is a thenable: an object or a function with a `then` method. It reads `then`
 * once, as `await` does. A value whose `then` getter throws isn't a thenable
 */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (value == null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false
  }
  try {
    return typeof Reflect.get(value, 'then') === 'function'
  } catch {
    return false
  }
}

function getJitteredDelay(caller: string, ms: number, jitterRatio: number): number {
  checkNumber(caller, '`ms`', ms)
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_TIMER_DELAY_MS) {
    throw new RangeError(
      stdMessage(
        [caller, '`ms`'],
        `expected a number between 0 and ${MAX_TIMER_DELAY_MS}, received ${describeValue(ms)}`,
      ),
    )
  }
  checkNumber(caller, '`options.jitterRatio`', jitterRatio, 'a number or `undefined`')
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new RangeError(
      stdMessage(
        [caller, '`options.jitterRatio`'],
        `expected a number between 0 and 1, received ${describeValue(jitterRatio)}`,
      ),
    )
  }

  // Jitter can push a valid delay past the timer limit, which would make the timer fire after 1ms
  return jitterRatio > 0
    ? Math.min(ms * (1 + jitterRatio * (Math.random() * 2 - 1)), MAX_TIMER_DELAY_MS)
    : ms
}

/**
 * Not `instanceof AbortSignal`, which a signal from another realm, such as jsdom's, or a polyfill
 * fails
 */
function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const signal = value as Partial<Record<keyof AbortSignal, unknown>>
  return (
    typeof signal.aborted === 'boolean' &&
    typeof signal.addEventListener === 'function' &&
    typeof signal.removeEventListener === 'function'
  )
}

/**
 * Any other value would fail later, after a timer or a waiter was set up
 */
function checkSignal(caller: string, signal: unknown): void {
  if (signal !== undefined && !isAbortSignalLike(signal)) {
    throw new TypeError(
      stdMessage(
        [caller, '`options.signal`'],
        `expected an \`AbortSignal\` or \`undefined\`, received ${describeValue(signal)}`,
      ),
    )
  }
}

function checkLimit(caller: string, limit: number): void {
  checkNumber(caller, '`limit`', limit)
  // eslint-disable-next-line unicorn/prefer-number-is-safe-integer -- A limit at or above the item count behaves the same, so one past 2 ** 53 is valid
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) {
    throw new RangeError(
      stdMessage(
        [caller, '`limit`'],
        `expected a positive integer or \`Infinity\`, received ${describeValue(limit)}`,
      ),
    )
  }
}

/**
 * A duck-typed signal can abort with an `undefined` reason, which a real `AbortSignal` replaces with
 * an `AbortError`, so this does too. `null` is kept
 */
function getAbortReason(signal: AbortSignal | undefined): unknown {
  const reason: unknown = signal?.reason
  return reason === undefined
    ? new DOMException('This operation was aborted', 'AbortError')
    : reason
}

export type SleepOptions = { jitterRatio?: number | undefined; signal?: AbortSignal | undefined }

/**
 * Sleep for `ms` milliseconds, between 0 and 2^31 - 1. A `jitterRatio` between 0 and 1 picks the
 * time at random within `ms * (1 ± jitterRatio)`. Aborting `signal`, even before the call, rejects
 * with the signal's `reason`, or an `AbortError` `DOMException` when it is `undefined`
 *
 * @example
 * ```ts
 * import { sleep } from '@gpahal/std/promises'
 *
 * await sleep(10)
 * ```
 */
export async function sleep(ms: number, options: SleepOptions = {}): Promise<void> {
  return startSleep('`sleep`', ms, options).promise
}

export type SleepWithWakeup = {
  /**
   * Resolves after the sleep time or on the first `wakeup()`, and rejects when the signal is
   * aborted
   */
  promise: Promise<void>
  /**
   * Ends the sleep early, resolving `promise`. Does nothing once `promise` has settled
   */
  wakeup: () => void
}

/**
 * {@link sleep}, with a `wakeup` function that ends the sleep early
 *
 * @example
 * ```ts
 * import { sleepWithWakeup } from '@gpahal/std/promises'
 *
 * const { promise, wakeup } = sleepWithWakeup(1000)
 * wakeup()
 *
 * await promise
 * ```
 */
export function sleepWithWakeup(ms: number, options: SleepOptions = {}): SleepWithWakeup {
  return startSleep('`sleepWithWakeup`', ms, options)
}

function startSleep(caller: string, ms: number, options: SleepOptions): SleepWithWakeup {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let signal: AbortSignal | undefined
  let settle: ((rejection?: { reason: unknown }) => void) | undefined

  const finish = (rejection?: { reason: unknown }) => {
    if (!settle) {
      return
    }

    const settleOnce = settle
    settle = undefined
    clearTimeout(timeout)
    // Settled first, so a signal whose `removeEventListener` throws can't keep the promise pending
    settleOnce(rejection)
    removeAbortListener(signal, onAbort)
  }
  const wakeup = () => {
    finish()
  }
  const onAbort = () => {
    finish({ reason: getAbortReason(signal) })
  }

  const promise = new Promise<void>((resolve, reject) => {
    // Checked inside the executor, so invalid options reject instead of throwing synchronously
    checkOptions(caller, options)
    const { jitterRatio = 0, signal: optionsSignal } = options
    checkSignal(caller, optionsSignal)
    const delay = getJitteredDelay(caller, ms, jitterRatio)
    signal = optionsSignal
    settle = (rejection) => {
      if (rejection) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- The signal's reason, whatever it is
        reject(rejection.reason)
      } else {
        resolve()
      }
    }
    // A listener added after the abort would never run
    if (signal?.aborted === true) {
      onAbort()
      return
    }

    // The timer goes last, so nothing that throws can leave it running after the promise rejects
    signal?.addEventListener('abort', onAbort, { once: true })
    timeout = setTimeout(wakeup, delay)
  })

  return { promise, wakeup }
}

export type AbortableOptions = { signal?: AbortSignal | undefined }

/**
 * Run `fn` with a time limit of `ms` milliseconds, between 0 and 2^31 - 1. `fn` gets a signal that
 * aborts when time runs out or `signal` aborts. The promise resolves with what `fn` gives, or
 * rejects with a `TimeoutError` `DOMException`, as `AbortSignal.timeout` does, whichever comes
 * first.
 *
 * Aborting `signal` rejects with the signal's `reason`, or an `AbortError` `DOMException` when it is
 * `undefined`, and aborts the signal `fn` gets with it too. An abort during a synchronous `fn` wins
 * over what it returns or throws, and one before the call rejects without calling `fn`
 *
 * @example
 * ```ts
 * import { withTimeout } from '@gpahal/std/promises'
 *
 * const response = await withTimeout(async (signal) => fetch('https://example.com', { signal }), 5000)
 * ```
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => T | PromiseLike<T>,
  ms: number,
  options: AbortableOptions = {},
): Promise<T> {
  const caller = '`withTimeout`'
  checkOptions(caller, options)
  const { signal } = options
  checkSignal(caller, signal)
  // Before the abort check, so invalid arguments reject even with an aborted signal, as in `sleep`
  const delay = getJitteredDelay(caller, ms, 0)
  checkFunction(caller, fn)
  if (signal?.aborted === true) {
    throw getAbortReason(signal)
  }

  const controller = new AbortController()
  const { promise: aborted, reject }: PromiseWithResolvers<never> = Promise.withResolvers()
  const onInternalAbort = () => {
    reject(controller.signal.reason)
  }
  controller.signal.addEventListener('abort', onInternalAbort, { once: true })
  const onAbort = () => {
    controller.abort(getAbortReason(signal))
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
  }, delay)
  try {
    // The async function turns a synchronous throw into a rejection; `Promise.try` is newer than
    // std's runtime baseline. `aborted` goes first, so it wins when `fn` aborts the signal and then
    // returns or throws
    return await Promise.race([aborted, (async () => fn(controller.signal))()])
  } finally {
    clearTimeout(timeout)
    removeAbortListener(controller.signal, onInternalAbort)
    removeAbortListener(signal, onAbort)
  }
}

/**
 * Ignores a throw, so a broken signal can't replace the result or keep the promise from settling
 */
function removeAbortListener(signal: AbortSignal | undefined, onAbort: () => void): void {
  try {
    signal?.removeEventListener('abort', onAbort)
  } catch {
    // The listener only aborts a signal that has done its job
  }
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    value != null &&
    typeof (value as Partial<Record<typeof Symbol.iterator, unknown>>)[Symbol.iterator] ===
      'function'
  )
}

/**
 * A function counts, as spread and `for...of` accept one
 */
function isIteratorResult<T>(value: unknown): value is IteratorResult<T> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

/**
 * Map `items`, any iterable, with `fn`, running at most `limit` calls at once, or all of them with
 * `Infinity`, and resolve with the results in input order. `items` is read as calls finish, so a
 * generator can be long, but with `Infinity` it's read whole up front. `fn` gets each item, its
 * index and a signal that aborts when the mapping stops.
 *
 * On the first rejection or synchronous throw of `fn`, it starts no new calls, aborts the signal it
 * passed to `fn` with that error, closes the iterable and rejects with the error, or an
 * `AbortError` `DOMException` when it is `undefined`. Aborting `signal` does the same with the
 * signal's `reason`. A throw from the iterator or a malformed iterator result rejects without
 * closing the iterator, as with `for...of`
 *
 * @example
 * ```ts
 * import { mapLimit } from '@gpahal/std/promises'
 *
 * const urls = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c']
 * const responses = await mapLimit(urls, 2, async (url, _index, signal) => fetch(url, { signal }))
 * ```
 */
export async function mapLimit<T, R>(
  items: Iterable<T>,
  limit: number,
  fn: (item: T, index: number, signal: AbortSignal) => R | PromiseLike<R>,
  options: AbortableOptions = {},
): Promise<Array<R>> {
  const caller = '`mapLimit`'
  checkOptions(caller, options)
  const { signal } = options
  checkSignal(caller, signal)
  checkLimit(caller, limit)
  if (!isIterable(items)) {
    throw new TypeError(
      stdMessage([caller, '`items`'], `expected an iterable, received ${describeValue(items)}`),
    )
  }
  checkFunction(caller, fn)
  if (signal?.aborted === true) {
    throw getAbortReason(signal)
  }

  const controller = new AbortController()
  // Dropped once the mapping no longer reads it, so running calls don't keep the rest of `items`
  // alive, since an array iterator has no `return` that lets go of its array
  let iterator: Iterator<T> | undefined = items[Symbol.iterator]()
  const closeIterator = () => {
    const current = iterator
    iterator = undefined
    try {
      current?.return?.()
    } catch {
      // The mapping already failed with the first error
    }
  }
  // Creating the iterator can abort the caller's signal before the listener is added. The cast
  // undoes TypeScript's narrowing from the check above
  if ((signal?.aborted as boolean | undefined) === true) {
    closeIterator()
    throw getAbortReason(signal)
  }
  const results: Array<R> = []
  let nextIndex = 0
  let running = 0
  let isExhausted = false
  let isDone = false
  // A generator's `return` throws while its `next` runs, so a failure then closes it afterwards
  let isInNext = false

  return new Promise<Array<R>>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (isDone) {
        return
      }
      isDone = true
      // Calls that ignore the signal can keep this closure alive, so release the results now
      results.length = 0
      controller.abort(error)
      // As with `for...of`, an iterator whose `next` threw or that is done isn't closed, and one
      // whose `next` runs is closed after it returns
      if (!isExhausted && !isInNext) {
        closeIterator()
      }
      // The signal's reason, which differs from `error` when that is `undefined`
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- What `fn`, the iterable or the signal gave
      reject(controller.signal.reason)
      removeAbortListener(signal, onAbort)
    }
    const onAbort = () => {
      fail(getAbortReason(signal))
    }

    const startCalls = () => {
      while (!isExhausted && running < limit) {
        if (isDone) {
          return
        }
        const current = iterator
        if (current === undefined) {
          return
        }
        let step: unknown
        isInNext = true
        try {
          step = current.next()
        } catch (error) {
          isInNext = false
          isExhausted = true
          iterator = undefined
          fail(error)
          return
        }
        isInNext = false
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `onAbort` can set it during `next`, which TypeScript's narrowing doesn't see
        if (isDone) {
          closeIterator()
          return
        }
        let value: T
        // A malformed result fails without closing the iterator, as with `for...of`
        try {
          if (!isIteratorResult<T>(step)) {
            throw new TypeError(
              stdMessage(
                [caller, '`items`'],
                `expected an iterator result object, received ${describeValue(step)}`,
              ),
            )
          }
          // Any truthy `done` ends the iteration, as with `for...of`
          if (step.done ?? false) {
            isExhausted = true
            iterator = undefined
            break
          }
          value = step.value
        } catch (error) {
          isExhausted = true
          iterator = undefined
          fail(error)
          return
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `onAbort` can set it during the getters, which TypeScript's narrowing doesn't see
        if (isDone) {
          return
        }
        const index = nextIndex++
        running++
        // Not `Promise.try`, which is newer than std's runtime baseline
        // eslint-disable-next-line @typescript-eslint/no-floating-promises, no-loop-func -- It catches its own errors, and reads the shared state as it is when the call settles
        void (async () => {
          let result: R
          try {
            result = await fn(value, index, controller.signal)
          } catch (error) {
            fail(error)
            return
          }
          // A late success after a failure would fill the released results again
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `fail` can set it while `fn` runs, which TypeScript's narrowing doesn't see
          if (isDone) {
            return
          }
          results[index] = result
          running--
          startCalls()
        })()
      }
      if (isDone || !isExhausted || running > 0) {
        return
      }
      isDone = true
      resolve(results)
      removeAbortListener(signal, onAbort)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    startCalls()
  })
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value != null &&
    typeof (value as Partial<Record<typeof Symbol.asyncIterator, unknown>>)[
      Symbol.asyncIterator
    ] === 'function'
  )
}

type CallOutcome<R> = { value: R } | { error: unknown }

/**
 * Map `items`, an iterable or async iterable, with `fn`, as an async iterable of the results in
 * input order. At most `limit` calls run and results wait at once, so a slow consumer slows the
 * reading of `items`. A result is yielded once it and the ones before it settle. `fn` gets each
 * item, its index and a signal that aborts when the mapping stops. Nothing runs until the first
 * result is asked for. With a `limit` of `Infinity`, `items` must be finite.
 *
 * On the first rejection or synchronous throw of `fn`, it starts no new calls, aborts the signal it
 * passed to `fn` with that error, closes the iterable and rejects with the error, or an
 * `AbortError` `DOMException` when it is `undefined`, even while earlier results are pending.
 * Aborting `signal` does the same with the signal's `reason`. When the consumer stops early, as
 * with `break`, it aborts the signal passed to `fn` with an `AbortError` and closes the iterable. A
 * throw from the iterator or a malformed iterator result rejects without closing the iterator, as
 * with `for await...of`. Invalid arguments throw when it's called, rather than reject
 *
 * @example
 * ```ts
 * import { mapLimitIterable } from '@gpahal/std/promises'
 *
 * const urls = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c']
 * for await (const response of mapLimitIterable(urls, 2, async (url, _index, signal) => fetch(url, { signal }))) {
 *   await response.text()
 * }
 * ```
 */
export function mapLimitIterable<T, R>(
  items: Iterable<T> | AsyncIterable<T>,
  limit: number,
  fn: (item: T, index: number, signal: AbortSignal) => R | PromiseLike<R>,
  options: AbortableOptions = {},
): AsyncIterable<R> {
  const caller = '`mapLimitIterable`'
  checkOptions(caller, options)
  const { signal } = options
  checkSignal(caller, signal)
  checkLimit(caller, limit)
  if (!isAsyncIterable(items) && !isIterable(items)) {
    throw new TypeError(
      stdMessage(
        [caller, '`items`'],
        `expected an iterable or an async iterable, received ${describeValue(items)}`,
      ),
    )
  }
  checkFunction(caller, fn)
  return {
    [Symbol.asyncIterator]: () => runMapLimitIterable({ items }, limit, fn, signal, caller),
  }
}

type PendingCall<R> = { outcome: CallOutcome<R> | undefined }

/**
 * An object, so TypeScript's narrowing of locals doesn't hide changes the closures make
 */
type MapLimitIterableState<R> = {
  /**
   * Started calls whose results the consumer hasn't taken
   */
  pending: Queue<PendingCall<R>>
  nextIndex: number
  isExhausted: boolean
  /**
   * At most one async `next` runs at a time
   */
  isReading: boolean
  /**
   * False once the iterator is done or its `next` failed, which need no closing, as with
   * `for await...of`
   */
  isOpen: boolean
  /**
   * A sync generator's `return` throws while its `next` runs, so a failure closes it after
   */
  isInSyncNext: boolean
  /**
   * So a read that settles later starts no call
   */
  isStopped: boolean
  /**
   * What the iteration rejects with
   */
  failure: { error: unknown } | undefined
  /**
   * Resolves the loop's current wait. Each wait has its own promise, so a long run doesn't pile
   * reactions on one that never settles
   */
  wake: (() => void) | undefined
}

/**
 * Throws a `TypeError` for a result that isn't an object, and what a `done` or `value` getter
 * throws
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- `T` is the item type of the caller's iterator, which an `unknown` step can't carry
function readStep<T>(step: unknown, caller: string): 'done' | { value: T } {
  if (!isIteratorResult<T>(step)) {
    throw new TypeError(
      stdMessage(
        [caller, '`items`'],
        `expected an iterator result object, received ${describeValue(step)}`,
      ),
    )
  }
  // Any truthy `done` ends the iteration, as with `for await...of`
  return (step.done ?? false) ? 'done' : { value: step.value }
}

type MapLimitIterableSource<T> = { items: Iterable<T> | AsyncIterable<T> }

/**
 * Empties `source`, since a failed call's error can keep the generator of
 * {@link runMapLimitIterable} and its arguments alive through its stack trace
 */
function takeIterator<T>(source: MapLimitIterableSource<T>): Iterator<T> | AsyncIterator<T> {
  const { items } = source
  source.items = []
  return isAsyncIterable(items) ? items[Symbol.asyncIterator]() : items[Symbol.iterator]()
}

async function* runMapLimitIterable<T, R>(
  source: MapLimitIterableSource<T>,
  limit: number,
  fn: (item: T, index: number, signal: AbortSignal) => R | PromiseLike<R>,
  signal: AbortSignal | undefined,
  caller: string,
): AsyncGenerator<R, undefined, undefined> {
  if (signal?.aborted === true) {
    throw getAbortReason(signal)
  }
  const controller = new AbortController()
  // Dropped once the mapping no longer reads it, as in `mapLimit`
  let iterator: Iterator<T> | AsyncIterator<T> | undefined = takeIterator(source)
  const state: MapLimitIterableState<R> = {
    pending: createQueue(),
    nextIndex: 0,
    isExhausted: false,
    isReading: false,
    isOpen: true,
    isInSyncNext: false,
    isStopped: false,
    failure: undefined,
    wake: undefined,
  }
  // During a sync `next`, closing waits until it returns
  const closeIterator = () => {
    if (state.isInSyncNext) {
      return
    }
    const current = iterator
    iterator = undefined
    if (!state.isOpen) {
      return
    }
    state.isOpen = false
    try {
      // Not awaited: an async generator's `return` waits for a `next` that may never settle
      void Promise.resolve(current?.return?.()).catch(() => undefined)
    } catch {
      // The mapping already stopped
    }
  }
  // Creating the iterator can abort the caller's signal before the listener is added. The cast
  // undoes TypeScript's narrowing from the check above
  if ((signal?.aborted as boolean | undefined) === true) {
    closeIterator()
    throw getAbortReason(signal)
  }
  const notify = () => {
    const { wake } = state
    state.wake = undefined
    wake?.()
  }
  const fail = (reason: unknown) => {
    if (state.failure !== undefined) {
      return
    }
    controller.abort(reason)
    // The signal's reason, which differs from `reason` when that is `undefined`
    state.failure = { error: controller.signal.reason }
    closeIterator()
    state.pending.clear()
    notify()
  }
  // For an iterator that is done or failed, which needs no closing. Never called during a sync
  // `next`
  const endIteration = () => {
    state.isOpen = false
    state.isExhausted = true
    iterator = undefined
  }
  const onAbort = () => {
    fail(getAbortReason(signal))
  }

  const startCall = (value: T) => {
    const index = state.nextIndex++
    const call: PendingCall<R> = { outcome: undefined }
    state.pending.enqueue(call)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises -- It catches its own errors
    void (async () => {
      try {
        call.outcome = { value: await fn(value, index, controller.signal) }
      } catch (error) {
        call.outcome = { error }
        fail(error)
      }
      notify()
    })()
  }
  const takeStep = (step: unknown) => {
    if (state.failure !== undefined || state.isStopped) {
      // A failure during a sync `next`, as by aborting the caller's signal, closes it now
      closeIterator()
      return
    }
    const read = readStep<T>(step, caller)
    if (read === 'done') {
      endIteration()
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `onAbort` can set it during the getters, which TypeScript's narrowing doesn't see
    if (state.failure !== undefined) {
      return
    }
    startCall(read.value)
  }
  const readNext = () => {
    const current = iterator
    if (current === undefined) {
      endIteration()
      return
    }
    let next: unknown
    try {
      state.isInSyncNext = true
      try {
        next = current.next()
      } finally {
        state.isInSyncNext = false
      }
      if (!isPromiseLike(next)) {
        takeStep(next)
        return
      }
    } catch (error) {
      endIteration()
      fail(error)
      return
    }
    state.isReading = true
    // A rejected `next` and a malformed result fail alike, without closing the iterator
    void Promise.resolve(next)
      .then((step) => {
        state.isReading = false
        takeStep(step)
      })
      .catch((error: unknown) => {
        state.isReading = false
        endIteration()
        fail(error)
      })
      .finally(notify)
  }

  // Rather than by a failure or the consumer stopping early
  let isComplete = false
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      // A settled result is yielded without waiting for the window to fill, so a slow source
      // doesn't hold it back
      while (
        !state.isExhausted &&
        !state.isReading &&
        state.failure === undefined &&
        state.pending.size < limit
      ) {
        readNext()
      }
      if (state.failure !== undefined) {
        break
      }
      const outcome = state.pending.peek()?.outcome
      if (outcome === undefined) {
        if (state.pending.size === 0 && !state.isReading) {
          break
        }
        await new Promise<void>((resolve) => {
          state.wake = resolve
        })
        continue
      }
      state.pending.dequeue()
      if ('error' in outcome) {
        break
      }
      yield outcome.value
    }
    if (state.failure !== undefined) {
      throw state.failure.error
    }
    isComplete = true
    return undefined
  } finally {
    state.isStopped = true
    // Stopping after the last result, once the source reported done, isn't early: nothing is left
    // to abort
    const isDelivered = state.isExhausted && !state.isReading && state.pending.size === 0
    if (!isComplete && !isDelivered && state.failure === undefined) {
      controller.abort(new DOMException('The iteration was stopped early', 'AbortError'))
    }
    closeIterator()
    state.pending.clear()
    state.wake = undefined
    removeAbortListener(signal, onAbort)
  }
}

export type RetryOptions = {
  /**
   * How many times to call `fn` again after it fails, a non-negative safe integer or `Infinity`.
   * Default is 3. With `Infinity`, pass a `signal` too, so the retries can stop
   */
  retries?: number | undefined
  /**
   * The wait before the first retry, in milliseconds. Default is 100
   */
  minDelayMs?: number | undefined
  /**
   * The longest wait between attempts, in milliseconds, at least `minDelayMs`. Default is the larger
   * of 10,000 and `minDelayMs`
   */
  maxDelayMs?: number | undefined
  /**
   * What each wait is multiplied by for the next, a finite number of at least 1. Default is 2
   */
  factor?: number | undefined
  /**
   * Picks each wait at random within `delay * (1 ± jitterRatio)`, capped at `maxDelayMs`. Between 0
   * and 1. Default is 0
   */
  jitterRatio?: number | undefined
  /**
   * Whether to retry after attempt `attempt`, counted from 1, failed with `error`. Can return a
   * promise. Default retries every error
   */
  shouldRetry?: ((error: unknown, attempt: number) => boolean | PromiseLike<boolean>) | undefined
  /**
   * Passed to `fn`, and checked between attempts: aborting it stops the retries
   */
  signal?: AbortSignal | undefined
}

function checkRetryNumber(
  name: string,
  untypedValue: unknown,
  { min, max }: { min: number; max: number },
): void {
  if (untypedValue === undefined) {
    return
  }
  const subject = `\`options.${name}\``
  const value = checkNumber('`retry`', subject, untypedValue, 'a number or `undefined`')
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(
      stdMessage(
        ['`retry`', subject],
        `expected ${max === Infinity ? `a finite number of at least ${min}` : `a number between ${min} and ${max}`}, received ${describeValue(value)}`,
      ),
    )
  }
}

function checkRetries(untypedRetries: unknown): void {
  if (untypedRetries === undefined) {
    return
  }
  const retries = checkNumber(
    '`retry`',
    '`options.retries`',
    untypedRetries,
    'a number or `undefined`',
  )
  if (retries !== Infinity && !(Number.isSafeInteger(retries) && retries >= 0)) {
    throw new RangeError(
      stdMessage(
        ['`retry`', '`options.retries`'],
        `expected a safe integer of at least 0 or \`Infinity\`, received ${describeValue(retries)}`,
      ),
    )
  }
}

async function isRetried(
  shouldRetry: NonNullable<RetryOptions['shouldRetry']> | undefined,
  error: unknown,
  attempt: number,
): Promise<boolean> {
  if (shouldRetry === undefined) {
    return true
  }
  const result: unknown = await shouldRetry(error, attempt)
  if (typeof result !== 'boolean') {
    throw new TypeError(
      stdMessage(
        ['`retry`', '`options.shouldRetry`'],
        `expected a result of \`true\` or \`false\`, received ${describeValue(result)}`,
      ),
      { cause: error },
    )
  }
  return result
}

/**
 * Call `fn` until it succeeds, waiting longer after each failure, and resolve with what it gives.
 * `fn` gets the attempt, counted from 1, and `options.signal`, or a signal that never aborts. After
 * a failure, it waits `minDelayMs`, multiplied by `factor` after each attempt, jittered by
 * `jitterRatio` and capped at `maxDelayMs`, then calls `fn` again, up to `retries` times. It
 * rejects with the last error once the retries run out or `shouldRetry` gives `false`. Pass a
 * `shouldRetry` to see the earlier errors. A throw from `shouldRetry` rejects with that error, and
 * a result that isn't a boolean with a `TypeError` whose `cause` is `fn`'s error.
 *
 * Aborting `signal` stops the retries, rejecting with the signal's `reason`, or an `AbortError`
 * `DOMException` when it is `undefined`. While `fn` or `shouldRetry` runs, it waits for them to
 * settle first, and a value `fn` resolves with is kept
 *
 * @example
 * ```ts
 * import { retry } from '@gpahal/std/promises'
 *
 * const response = await retry(
 *   async (_attempt, signal) => fetch('https://example.com', { signal }),
 *   { retries: 2, shouldRetry: (error) => !(error instanceof TypeError) },
 * )
 * ```
 */
export async function retry<T>(
  fn: (attempt: number, signal: AbortSignal) => T | PromiseLike<T>,
  options: RetryOptions = {},
): Promise<T> {
  const caller = '`retry`'
  checkOptions(caller, options)
  const {
    retries = 3,
    minDelayMs = 100,
    maxDelayMs = Math.max(10_000, minDelayMs),
    factor = 2,
    jitterRatio = 0,
    shouldRetry,
    signal,
  } = options
  checkSignal(caller, signal)
  checkFunction(caller, fn)
  checkRetries(retries)
  checkRetryNumber('minDelayMs', minDelayMs, { min: 0, max: MAX_TIMER_DELAY_MS })
  checkRetryNumber('maxDelayMs', maxDelayMs, { min: minDelayMs, max: MAX_TIMER_DELAY_MS })
  checkRetryNumber('factor', factor, { min: 1, max: Infinity })
  checkRetryNumber('jitterRatio', jitterRatio, { min: 0, max: 1 })
  if (shouldRetry !== undefined && typeof shouldRetry !== 'function') {
    throw new TypeError(
      stdMessage(
        [caller, '`options.shouldRetry`'],
        `expected a function or \`undefined\`, received ${describeValue(shouldRetry)}`,
      ),
    )
  }

  // A signal that never aborts without one, so `fn` can always pass it on, as to `fetch`
  const fnSignal = signal ?? new AbortController().signal
  let delay = minDelayMs
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted === true) {
      throw getAbortReason(signal)
    }
    try {
      return await fn(attempt, fnSignal)
    } catch (error) {
      // The cast undoes TypeScript's narrowing, though `fn` can abort the signal
      if ((signal?.aborted as boolean | undefined) === true) {
        throw getAbortReason(signal)
      }
      if (attempt > retries) {
        throw error
      }
      const retried = await isRetried(shouldRetry, error, attempt)
      // `shouldRetry` can abort the signal, or it can abort while an async one runs
      if ((signal?.aborted as boolean | undefined) === true) {
        throw getAbortReason(signal)
      }
      if (!retried) {
        throw error
      }
    }
    // Capped after the jitter, so `maxDelayMs` is the longest wait
    await sleep(Math.min(getJitteredDelay(caller, delay, jitterRatio), maxDelayMs), { signal })
    delay = Math.min(delay * factor, maxDelayMs)
  }
}

export type Mutex = {
  /**
   * Wait for the mutex, lock it, run `fn` and settle like what it returns. The lock passes to the
   * next waiter, in call order, once `fn` settles. `fn` runs after the call returns, even when the
   * mutex is free.
   *
   * Aborting `signal` before the lock is acquired rejects with the signal's `reason`, or an
   * `AbortError` `DOMException` when it is `undefined`, without running `fn`. Aborting later does
   * nothing. Calling `runExclusive` on the same mutex from inside `fn` deadlocks
   */
  runExclusive: <T>(fn: () => T | PromiseLike<T>, options?: AbortableOptions) => Promise<T>
  /**
   * Whether a `runExclusive` call holds the lock
   */
  readonly isLocked: boolean
}

/**
 * Create a mutex, to run async callbacks one at a time
 *
 * @example
 * ```ts
 * import { sleep, createMutex } from '@gpahal/std/promises'
 *
 * const mutex = createMutex()
 *
 * async function runSomethingSequentially() {
 *   await mutex.runExclusive(async () => {
 *     await sleep(100)
 *   })
 * }
 * ```
 */
export function createMutex(): Mutex {
  let isLocked = false
  // An aborted waiter leaves right away, so aborted waiters don't pile up until the next release
  const waiters = createQueue<() => void>()

  const release = (): void => {
    // The lock passes straight to the next waiter. Waking never throws
    const next = waiters.dequeue()
    if (next === undefined) {
      isLocked = false
      return
    }
    next()
  }

  // eslint-disable-next-line @typescript-eslint/promise-function-async -- `async` would wrap the promise in another and add ticks
  const acquire = (signal: AbortSignal | undefined): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the caller picks the reason
        reject(getAbortReason(signal))
        return
      }
      if (!isLocked) {
        isLocked = true
        resolve()
        return
      }

      const onAbort = () => {
        waiters.remove(entry)
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the caller picks the reason
        reject(getAbortReason(signal))
      }
      const wake = () => {
        // Resolved first, so a signal whose `removeEventListener` throws can't leave the waiter
        // holding the lock without running. A later abort only rejects a settled promise
        resolve()
        removeAbortListener(signal, onAbort)
      }
      const entry = waiters.enqueue(wake)
      try {
        signal?.addEventListener('abort', onAbort, { once: true })
      } catch (error) {
        waiters.remove(entry)
        throw error
      }
    })

  const runExclusive = async <T>(
    fn: () => T | PromiseLike<T>,
    options: AbortableOptions = {},
  ): Promise<T> => {
    checkOptions('`mutex.runExclusive`', options)
    const { signal } = options
    checkSignal('`mutex.runExclusive`', signal)
    checkFunction('`mutex.runExclusive`', fn)
    await acquire(signal)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  return {
    runExclusive,
    get isLocked() {
      return isLocked
    },
  }
}

export type PromiseStatus = 'pending' | 'fulfilled' | 'rejected'

export type TrackedPromise<T> = {
  /**
   * Settles like the tracked promise
   */
  promise: Promise<T>
  getStatus: () => PromiseStatus
}

/**
 * Track the status of a promise or another thenable: returns a promise that settles like `promise`,
 * and a function that gives its status. An unhandled rejection of the returned promise is reported
 * even when the original is handled, so a caller that only polls `getStatus` must still handle it
 *
 * @example
 * ```ts
 * import { createTrackedPromise } from '@gpahal/std/promises'
 *
 * const { promise, getStatus } = createTrackedPromise(Promise.resolve('data'))
 * getStatus() // 'pending'
 * await promise
 * getStatus() // 'fulfilled'
 * ```
 */
export function createTrackedPromise<T>(promise: PromiseLike<T>): TrackedPromise<T> {
  let status: PromiseStatus = 'pending'

  // Both handlers go in one `then`, so a rejection updates the status in the same microtask as a
  // resolution would
  // eslint-disable-next-line unicorn/prefer-then-catch -- As above
  const trackedPromise = Promise.resolve(promise).then(
    (value) => {
      status = 'fulfilled'
      return value
    },
    (error: unknown) => {
      status = 'rejected'
      throw error
    },
  )
  return { promise: trackedPromise, getStatus: () => status }
}
