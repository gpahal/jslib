import { getEventListeners } from 'node:events'
import vm from 'node:vm'

import {
  createMutex,
  createTrackedPromise,
  isPromise,
  isPromiseLike,
  mapLimit,
  mapLimitIterable,
  MAX_TIMER_DELAY_MS,
  retry,
  sleep,
  sleepWithWakeup,
  withTimeout,
  type RetryOptions,
  type TrackedPromise,
} from '@/promises'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // Before `useRealTimers`, so restoring a `setTimeout` spy can't put back the fake timer
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/**
 * Whether `promise` settles within `ms` of fake time
 */
async function isSettledAfter(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let hasSettled = false
  const markSettled = () => {
    hasSettled = true
  }
  // eslint-disable-next-line unicorn/prefer-then-catch -- One `then`, so both outcomes mark it settled
  void promise.then(markSettled, markSettled)
  await vi.advanceTimersByTimeAsync(ms)
  return hasSettled
}

/**
 * What `promise` rejects with. It handles the rejection right away, so advancing the timers before
 * awaiting it doesn't report it as unhandled
 */
async function getRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

/**
 * Resolves `acquired` once it holds the lock, and releases it when `release` is called
 */
function hold(
  mutex: ReturnType<typeof createMutex>,
  options?: { signal?: AbortSignal },
): { acquired: Promise<void>; release: () => void; done: Promise<void> } {
  const { promise: acquired, resolve: onAcquired }: PromiseWithResolvers<void> =
    Promise.withResolvers()
  const { promise: released, resolve: release }: PromiseWithResolvers<void> =
    Promise.withResolvers()
  const done = mutex.runExclusive(async () => {
    onAcquired()
    await released
  }, options)
  return { acquired, release, done }
}

/**
 * The promises reported as unhandled rejections while `run` runs, with real timers. Node reports
 * unhandled rejections once the microtasks drain, before the next macrotask, so `setImmediate`
 * waits for them
 */
async function getUnhandledRejections(run: () => Promise<void>): Promise<Array<Promise<unknown>>> {
  vi.useRealTimers()
  const reported: Array<Promise<unknown>> = []
  const onUnhandled = (_reason: unknown, promise: Promise<unknown>) => {
    reported.push(promise)
  }
  process.on('unhandledRejection', onUnhandled)
  try {
    await run()
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  return reported
}

/**
 * Take every result of `iterable`
 */
async function collect<T>(iterable: AsyncIterable<T>): Promise<Array<T>> {
  // Not `Array.fromAsync`, which is newer than std's ES2024 lib
  const iterator = iterable[Symbol.asyncIterator]()
  const results: Array<T> = []
  for (let step = await iterator.next(); step.done !== true; step = await iterator.next()) {
    results.push(step.value)
  }
  return results
}

/**
 * A generator of `0` to `count - 1` that counts the items read and records whether it was closed
 */
function createCountingSource(count: number): {
  source: Generator<number, void, undefined>
  state: { read: number; isClosed: boolean }
} {
  const state = { read: 0, isClosed: false }
  function* generate() {
    try {
      for (let item = 0; item < count; item++) {
        state.read++
        yield item
      }
    } finally {
      state.isClosed = true
    }
  }
  return { source: generate(), state }
}

test.each<[string, (fn: () => unknown, signal: AbortSignal) => Promise<unknown>]>([
  ['mutex.runExclusive', async (fn, signal) => createMutex().runExclusive(fn, { signal })],
  ['sleep', async (_fn, signal) => sleep(10, { signal })],
  ['withTimeout', async (fn, signal) => withTimeout(fn, 10, { signal })],
  ['mapLimit', async (fn, signal) => mapLimit([1], 1, fn, { signal })],
])('%s rejects with an AbortError when a pre-aborted signal has no reason', async (_name, call) => {
  const fn = vi.fn<() => void>()
  // @ts-expect-error - Not an `AbortSignal`, but shaped like one
  const signal: AbortSignal = {
    aborted: true,
    reason: undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const error = await getRejection(call(fn, signal))
  expect(error).toBeInstanceOf(DOMException)
  expect(error).toHaveProperty('name', 'AbortError')
  expect(fn).not.toHaveBeenCalled()
})

describe('createMutex', () => {
  it('runs fn asynchronously, even when the lock is free', async () => {
    const mutex = createMutex()
    let hasRun = false
    const done = mutex.runExclusive(() => {
      hasRun = true
    })
    expect(hasRun).toBe(false)
    await done
    expect(hasRun).toBe(true)
  })

  it('runs critical sections one at a time, in order', async () => {
    const mutex = createMutex()
    const events: Array<string> = []
    const promises = Promise.all(
      Array.from({ length: 3 }, async (_, i) =>
        mutex.runExclusive(async () => {
          events.push(`start ${i}`)
          await sleep(100)
          events.push(`end ${i}`)
        }),
      ),
    )
    await vi.advanceTimersByTimeAsync(300)
    await promises
    expect(events).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2'])
  })

  it("returns fn's value, and releases the lock when fn throws or its promise rejects", async () => {
    const mutex = createMutex()
    await expect(mutex.runExclusive(async () => 1)).resolves.toBe(1)
    await expect(
      mutex.runExclusive(() => {
        throw new Error('sync')
      }),
    ).rejects.toThrow('sync')
    await expect(
      mutex.runExclusive(async () => {
        throw new Error('async')
      }),
    ).rejects.toThrow('async')
    expect(mutex.isLocked).toBe(false)
    await expect(mutex.runExclusive(() => 3)).resolves.toBe(3)
  })

  it('tells whether it is locked, until the last waiter is done', async () => {
    const mutex = createMutex()
    const first = hold(mutex)
    await first.acquired
    expect(mutex.isLocked).toBe(true)
    const second = hold(mutex)
    first.release()
    await second.acquired
    expect(mutex.isLocked).toBe(true)
    second.release()
    await second.done
    expect(mutex.isLocked).toBe(false)
  })

  it('removes a waiter whose signal is aborted, keeping the order of the others', async () => {
    const mutex = createMutex()
    const first = hold(mutex)
    await first.acquired
    const controller = new AbortController()
    const events: Array<string> = []
    const record = (event: string) => () => {
      events.push(event)
    }
    const second = mutex.runExclusive(record('second'))
    const aborted = mutex.runExclusive(record('aborted'), { signal: controller.signal })
    const last = mutex.runExclusive(record('last'))

    controller.abort(new Error('stop'))
    await expect(aborted).rejects.toThrow('stop')
    first.release()
    await Promise.all([second, last])
    expect(events).toEqual(['second', 'last'])
    expect(mutex.isLocked).toBe(false)
  })

  it('rejects right away with an already aborted signal, without taking the lock', async () => {
    const mutex = createMutex()
    const fn = vi.fn<() => void>()
    const signal = AbortSignal.abort(new Error('stop'))
    await expect(mutex.runExclusive(fn, { signal })).rejects.toThrow('stop')
    expect(fn).not.toHaveBeenCalled()
    expect(mutex.isLocked).toBe(false)
  })

  it('ignores an abort after the lock was acquired', async () => {
    const mutex = createMutex()
    const controller = new AbortController()
    const first = hold(mutex, { signal: controller.signal })
    await first.acquired
    controller.abort()
    const next = hold(mutex)
    expect(await isSettledAfter(next.acquired, 0)).toBe(false)
    first.release()
    await first.done
    expect(await isSettledAfter(next.acquired, 0)).toBe(true)
    next.release()
  })

  it('rejects a signal that is not an AbortSignal, leaving the lock and the queue intact', async () => {
    const mutex = createMutex()
    const first = hold(mutex)
    await first.acquired
    const fn = vi.fn<() => void>()
    const invalid = mutex.runExclusive(fn, {
      // @ts-expect-error - Not an `AbortSignal`
      signal: { aborted: false },
    })
    const last = mutex.runExclusive(() => 'last')
    await expect(invalid).rejects.toThrow(
      new TypeError(
        '@gpahal/std: `mutex.runExclusive`: `options.signal`: expected an `AbortSignal` or `undefined`, received an object',
      ),
    )
    first.release()
    await expect(last).resolves.toBe('last')
    expect(fn).not.toHaveBeenCalled()
    expect(mutex.isLocked).toBe(false)
  })

  it('rejects invalid options or fn, leaving the lock free', async () => {
    const mutex = createMutex()
    // @ts-expect-error - Not an object, as a JavaScript caller can pass
    await expect(mutex.runExclusive(() => undefined, null)).rejects.toThrow(
      new TypeError(
        '@gpahal/std: `mutex.runExclusive`: `options`: expected an object, received `null`',
      ),
    )
    // @ts-expect-error - Not a function, as a JavaScript caller can pass
    await expect(mutex.runExclusive(null)).rejects.toThrow(
      new TypeError(
        '@gpahal/std: `mutex.runExclusive`: `fn`: expected a function, received `null`',
      ),
    )
    expect(mutex.isLocked).toBe(false)
  })

  it('leaves no listener on a long-lived signal after its waiters run', async () => {
    const { signal } = new AbortController()
    const mutex = createMutex()
    await Promise.all(
      Array.from({ length: 3 }, async () => mutex.runExclusive(() => undefined, { signal })),
    )
    expect(getEventListeners(signal, 'abort')).toEqual([])
  })
})

describe('isPromise and isPromiseLike', () => {
  it('accepts promises of this realm only, and thenables as promise-like', () => {
    expect(isPromise(Promise.resolve())).toBe(true)
    const otherRealmPromise: unknown = vm.runInNewContext('Promise.resolve(1)')
    expect(isPromise(otherRealmPromise)).toBe(false)
    expect(isPromiseLike(otherRealmPromise)).toBe(true)
    // eslint-disable-next-line unicorn/no-thenable -- A thenable is the case under test
    const thenable = { then: () => undefined }
    expect(isPromise(thenable)).toBe(false)
    expect(isPromiseLike(thenable)).toBe(true)
    expect(isPromiseLike(Object.assign(() => undefined, thenable))).toBe(true)
    // eslint-disable-next-line unicorn/no-thenable -- A thenable is the case under test
    expect(isPromiseLike({ then: 1 })).toBe(false)
    expect(isPromiseLike(null)).toBe(false)
  })

  it('isPromiseLike returns false instead of throwing when reading then throws', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(isPromiseLike(proxy)).toBe(false)
  })
})

describe('createTrackedPromise', () => {
  it('tracks a fulfilled and a rejected promise', async () => {
    const fulfilled = createTrackedPromise(sleep(1000))
    expect(fulfilled.getStatus()).toBe('pending')
    await vi.advanceTimersByTimeAsync(1000)
    expect(fulfilled.getStatus()).toBe('fulfilled')
    const rejected = createTrackedPromise(Promise.reject(new Error('test')))
    await expect(rejected.promise).rejects.toThrow('test')
    expect(rejected.getStatus()).toBe('rejected')
  })

  it('updates the status of a rejected promise as soon as a fulfilled one', async () => {
    const fulfilled = createTrackedPromise(Promise.resolve())
    const rejected = createTrackedPromise(Promise.reject(new Error('test')))
    // Handled right away, not with `await`, which would wait for the status change under test
    rejected.promise.catch(() => undefined)
    await Promise.resolve()
    expect(fulfilled.getStatus()).toBe('fulfilled')
    expect(rejected.getStatus()).toBe('rejected')
  })

  it.each([false, true])(
    'reports an unhandled rejection only when nobody handles the returned promise (handled: %s)',
    async (isHandled) => {
      const error = new Error('test')
      let tracked: TrackedPromise<never> | undefined
      const reported = await getUnhandledRejections(async () => {
        const original = Promise.reject(error)
        tracked = createTrackedPromise(original)
        await expect(original).rejects.toBe(error)
        if (isHandled) {
          await tracked.promise.catch(() => undefined)
        }
      })
      expect(reported).toEqual(isHandled ? [] : [tracked?.promise])
    },
  )
})

describe('sleep', () => {
  it.each([
    ['0.5', TypeError],
    [null, TypeError],
    [NaN, RangeError],
    [2, RangeError],
  ])('rejects the jitter ratio %s without scheduling a timer', async (jitterRatio, ErrorType) => {
    const options = { jitterRatio: jitterRatio as number }
    await expect(sleep(100, options)).rejects.toThrow(ErrorType)
    await expect(sleepWithWakeup(100, options).promise).rejects.toThrow(ErrorType)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('names the invalid value in its error', async () => {
    // @ts-expect-error - A string, as JavaScript callers can pass
    await expect(sleep('100')).rejects.toThrow(
      new TypeError('@gpahal/std: `sleep`: `ms`: expected a number, received `"100"`'),
    )
    // @ts-expect-error - Not a number, as JavaScript callers can pass
    await expect(sleep(1, { jitterRatio: null })).rejects.toThrow(
      new TypeError(
        '@gpahal/std: `sleep`: `options.jitterRatio`: expected a number or `undefined`, received `null`',
      ),
    )
    await expect(sleep(-1)).rejects.toThrow(
      new RangeError(
        '@gpahal/std: `sleep`: `ms`: expected a number between 0 and 2147483647, received `-1`',
      ),
    )
    await expect(sleep(1, { jitterRatio: 2 })).rejects.toThrow(
      new RangeError(
        '@gpahal/std: `sleep`: `options.jitterRatio`: expected a number between 0 and 1, received `2`',
      ),
    )
  })

  it("settles when the signal's removeEventListener throws", async () => {
    const createBrokenSignal = (controller: AbortController) => {
      vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
        throw new Error('broken')
      })
      return controller.signal
    }
    const timedOut = sleep(5, { signal: createBrokenSignal(new AbortController()) })
    expect(await isSettledAfter(timedOut, 5)).toBe(true)
    const controller = new AbortController()
    const aborted = sleep(10_000, { signal: createBrokenSignal(controller) })
    expect(() => {
      controller.abort(new Error('stop'))
    }).not.toThrow()
    await expect(aborted).rejects.toThrow('stop')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with a null reason rather than an AbortError', async () => {
    const controller = new AbortController()
    const promise = getRejection(sleep(10_000, { signal: controller.signal }))
    controller.abort(null)
    expect(await promise).toBeNull()
  })
})

describe('sleepWithWakeup', () => {
  it('resolves after the given number of milliseconds', async () => {
    const { promise } = sleepWithWakeup(100)
    expect(await isSettledAfter(promise, 99)).toBe(false)
    expect(await isSettledAfter(promise, 1)).toBe(true)
  })

  it.each([
    [0, 90],
    [1 - Number.EPSILON, 109.999],
  ])('keeps jitter within the jitter ratio (random %d)', (random, expected) => {
    vi.spyOn(Math, 'random').mockReturnValue(random)
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    sleepWithWakeup(100, { jitterRatio: 0.1 }).wakeup()
    const delay = setTimeoutSpy.mock.calls[0]?.[1]
    expect(delay).toBeGreaterThanOrEqual(expected)
    expect(delay).toBeLessThan(110)
  })

  it('caps a jittered delay at MAX_TIMER_DELAY_MS', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1 - Number.EPSILON)
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const { wakeup } = sleepWithWakeup(MAX_TIMER_DELAY_MS, { jitterRatio: 1 })
    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBe(MAX_TIMER_DELAY_MS)
    wakeup()
  })

  it('rejects invalid arguments without throwing, and leaves no timer behind', async () => {
    let result: ReturnType<typeof sleepWithWakeup> | undefined
    expect(() => {
      result = sleepWithWakeup(MAX_TIMER_DELAY_MS + 1)
    }).not.toThrow()
    await expect(result!.promise).rejects.toThrow(RangeError)
    // @ts-expect-error - Not an `AbortSignal`
    await expect(sleepWithWakeup(10, { signal: { aborted: false } }).promise).rejects.toThrow(
      new TypeError(
        '@gpahal/std: `sleepWithWakeup`: `options.signal`: expected an `AbortSignal` or `undefined`, received an object',
      ),
    )
    // @ts-expect-error - Not an options object
    await expect(sleepWithWakeup(10, null).promise).rejects.toThrow(
      new TypeError(
        '@gpahal/std: `sleepWithWakeup`: `options`: expected an object, received `null`',
      ),
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with the reason when the signal is aborted, even before the call', async () => {
    const controller = new AbortController()
    const { promise } = sleepWithWakeup(10_000, { signal: controller.signal })
    expect(await isSettledAfter(promise, 10)).toBe(false)
    controller.abort(new Error('stop'))
    await expect(promise).rejects.toThrow('stop')
    const early = sleepWithWakeup(10_000, { signal: AbortSignal.abort(new Error('early')) })
    await expect(early.promise).rejects.toThrow('early')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops listening to the signal once woken up or timed out', async () => {
    const controller = new AbortController()
    const woken = sleepWithWakeup(10_000, { signal: controller.signal })
    woken.wakeup()
    await expect(woken.promise).resolves.toBeUndefined()
    const timedOut = sleepWithWakeup(10, { signal: controller.signal })
    expect(await isSettledAfter(timedOut.promise, 10)).toBe(true)
    expect(getEventListeners(controller.signal, 'abort')).toEqual([])
  })

  it('settles on the first wakeup or abort, and ignores the other', async () => {
    const wokenController = new AbortController()
    const woken = sleepWithWakeup(10_000, { signal: wokenController.signal })
    woken.wakeup()
    wokenController.abort(new Error('late'))
    await expect(woken.promise).resolves.toBeUndefined()
    const abortedController = new AbortController()
    const aborted = sleepWithWakeup(10_000, { signal: abortedController.signal })
    abortedController.abort(new Error('stop'))
    aborted.wakeup()
    await expect(aborted.promise).rejects.toThrow('stop')
  })
})

describe('withTimeout', () => {
  it.each(['returns', 'resolves', 'throws', 'rejects'] as const)(
    'settles, clears its timer and removes only its own listeners when fn %s',
    async (outcome) => {
      const controller = new AbortController()
      const onAbort = vi.fn<() => void>()
      const error = new Error('failed')
      let received: AbortSignal | undefined
      const promise = withTimeout(
        (signal): string | Promise<string> => {
          received = signal
          signal.addEventListener('abort', onAbort)
          switch (outcome) {
            case 'returns': {
              return 'done'
            }
            case 'resolves': {
              return Promise.resolve('done')
            }
            case 'throws': {
              throw error
            }
            case 'rejects': {
              return Promise.reject(error)
            }
          }
        },
        1000,
        { signal: controller.signal },
      )
      let result: unknown
      try {
        result = await promise
      } catch (error_) {
        result = error_
      }
      expect(result).toBe(outcome === 'returns' || outcome === 'resolves' ? 'done' : error)
      expect(getEventListeners(received!, 'abort')).toEqual([onAbort])
      expect(getEventListeners(controller.signal, 'abort')).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
      controller.abort()
      expect(received?.aborted).toBe(false)
      expect(onAbort).not.toHaveBeenCalled()
    },
  )

  it('rejects with a TimeoutError and aborts the signal of fn when time runs out', async () => {
    let received: AbortSignal | undefined
    const promise = withTimeout(async (signal) => {
      received = signal
      await sleep(200)
    }, 50)
    expect(await isSettledAfter(promise, 49)).toBe(false)
    expect(await isSettledAfter(promise, 1)).toBe(true)
    await expect(promise).rejects.toBeInstanceOf(DOMException)
    await expect(promise).rejects.toHaveProperty('name', 'TimeoutError')
    await expect(promise).rejects.toBe(received?.reason)
  })

  it("rejects with the caller's abort reason, and stops listening to the signal", async () => {
    const controller = new AbortController()
    let received: AbortSignal | undefined
    const promise = withTimeout(
      async (signal) => {
        received = signal
        return Promise.withResolvers<never>().promise
      },
      1000,
      { signal: controller.signal },
    )
    expect(await isSettledAfter(promise, 10)).toBe(false)
    const reason = new Error('stop')
    controller.abort(reason)
    await expect(promise).rejects.toBe(reason)
    expect(received?.reason).toBe(reason)
    expect(getEventListeners(controller.signal, 'abort')).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with the reason of an already aborted signal without calling fn', async () => {
    const fn = vi.fn<() => void>()
    await expect(
      withTimeout(fn, 1000, { signal: AbortSignal.abort(new Error('early')) }),
    ).rejects.toThrow('early')
    expect(fn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("rejects with the caller's reason when fn aborts the caller's signal and then returns", async () => {
    const controller = new AbortController()
    const reason = new Error('stop')
    const promise = withTimeout(
      () => {
        controller.abort(reason)
        return 'done'
      },
      1000,
      { signal: controller.signal },
    )
    await expect(promise).rejects.toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects invalid arguments without calling fn or scheduling a timer', async () => {
    const fn = vi.fn<() => void>()
    await expect(withTimeout(fn, -1)).rejects.toThrow(
      new RangeError(
        '@gpahal/std: `withTimeout`: `ms`: expected a number between 0 and 2147483647, received `-1`',
      ),
    )
    await expect(withTimeout(fn, MAX_TIMER_DELAY_MS + 1)).rejects.toThrow(RangeError)
    // @ts-expect-error - Not a number, as a JavaScript caller can pass
    await expect(withTimeout(fn, 10n)).rejects.toThrow(
      new TypeError('@gpahal/std: `withTimeout`: `ms`: expected a number, received `10n`'),
    )
    // @ts-expect-error - Not an `AbortSignal`, as a JavaScript caller can pass
    await expect(withTimeout(fn, 10, { signal: {} })).rejects.toThrow(TypeError)
    // @ts-expect-error - Not a function, as a JavaScript caller can pass
    await expect(withTimeout('fn', 10)).rejects.toThrow(
      new TypeError('@gpahal/std: `withTimeout`: `fn`: expected a function, received `"fn"`'),
    )
    expect(fn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports no unhandled rejection when work that ignores the signal rejects after a timeout', async () => {
    const reported = await getUnhandledRejections(async () => {
      const late = async () => {
        await sleep(20)
        throw new Error('late')
      }
      await expect(withTimeout(late, 1)).rejects.toThrow('aborted due to timeout')
      await sleep(40)
    })
    expect(reported).toEqual([])
  })
})

describe('mapLimit', () => {
  it.each([
    { limit: 2, maxRunning: 2 },
    { limit: Infinity, maxRunning: 6 },
  ])(
    'runs at most $limit calls at once and returns the results in input order',
    async ({ limit, maxRunning: expected }) => {
      let running = 0
      let maxRunning = 0
      const delays = [30, 10, 20, 5, 15, 25]
      const promise = mapLimit(delays, limit, async (delay, index) => {
        running++
        maxRunning = Math.max(maxRunning, running)
        await sleep(delay)
        running--
        return `${index}:${delay}`
      })
      await vi.runAllTimersAsync()
      await expect(promise).resolves.toEqual(['0:30', '1:10', '2:20', '3:5', '4:15', '5:25'])
      expect(maxRunning).toBe(expected)
    },
  )

  it('takes any iterable, reading it as calls finish', async () => {
    const { source, state } = createCountingSource(4)
    const promise = mapLimit(source, 1, async (item) => {
      await sleep(10)
      return item * 2
    })
    expect(state.read).toBe(1)
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toEqual([0, 2, 4, 6])
    await expect(mapLimit(new Set(['a']), 3, (item) => item)).resolves.toEqual(['a'])
    await expect(mapLimit([], 3, (item) => item)).resolves.toEqual([])
  })

  it('stops on the first rejection, aborting the signal of fn and closing the iterable', async () => {
    const { source, state } = createCountingSource(5)
    const signals: Array<AbortSignal> = []
    const error = new Error('fail')
    const fn = vi.fn<(item: number, index: number, signal: AbortSignal) => Promise<number>>(
      async (item, _index, signal) => {
        signals.push(signal)
        await sleep(10 * (item + 1))
        if (item === 0) {
          throw error
        }
        if (item === 1) {
          throw new Error('later')
        }
        return item
      },
    )
    const rejection = getRejection(mapLimit(source, 2, fn))
    await vi.runAllTimersAsync()
    expect(await rejection).toBe(error)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(signals[0]?.reason).toBe(error)
    expect(state.isClosed).toBe(true)
  })

  it('rejects when fn throws or the iterable throws', async () => {
    await expect(
      mapLimit([1], 1, () => {
        throw new Error('sync')
      }),
    ).rejects.toThrow('sync')
    const throwing: Iterable<number> = {
      [Symbol.iterator]: () => ({
        next: () => {
          throw new Error('iterator')
        },
      }),
    }
    await expect(mapLimit(throwing, 1, (item) => item)).rejects.toThrow('iterator')
  })

  it("stops when the caller's signal is aborted, and leaves no listener on it", async () => {
    const controller = new AbortController()
    const signals: Array<AbortSignal> = []
    const fn = vi.fn<(item: number, index: number, signal: AbortSignal) => Promise<void>>(
      async (_item, _index, signal) => {
        signals.push(signal)
        await sleep(100)
      },
    )
    const promise = mapLimit([1, 2, 3], 1, fn, { signal: controller.signal })
    expect(await isSettledAfter(promise, 10)).toBe(false)
    const reason = new Error('stop')
    controller.abort(reason)
    await expect(promise).rejects.toBe(reason)
    await vi.runAllTimersAsync()
    expect(fn).toHaveBeenCalledOnce()
    expect(signals[0]?.reason).toBe(reason)
    expect(getEventListeners(controller.signal, 'abort')).toEqual([])

    const { signal } = new AbortController()
    await mapLimit([1, 2, 3], 2, async (item) => item, { signal })
    expect(getEventListeners(signal, 'abort')).toEqual([])
  })

  it('rejects with the reason of an already aborted signal without calling fn', async () => {
    const fn = vi.fn<() => void>()
    await expect(
      mapLimit([1], 1, fn, { signal: AbortSignal.abort(new Error('early')) }),
    ).rejects.toThrow('early')
    expect(fn).not.toHaveBeenCalled()
  })

  it.each([
    [0, RangeError],
    [1.5, RangeError],
    [NaN, RangeError],
    ['2', TypeError],
  ])('rejects the limit %s without calling fn', async (limit, ErrorType) => {
    const fn = vi.fn<() => void>()
    await expect(mapLimit([1], limit as number, fn)).rejects.toThrow(ErrorType)
    expect(fn).not.toHaveBeenCalled()
  })

  it('rejects invalid arguments with the error shape', async () => {
    await expect(mapLimit([1], 0, (item) => item)).rejects.toThrow(
      new RangeError(
        '@gpahal/std: `mapLimit`: `limit`: expected a positive integer or `Infinity`, received `0`',
      ),
    )
    // @ts-expect-error - Not an iterable, as a JavaScript caller can pass
    await expect(mapLimit({}, 1, (item) => item)).rejects.toThrow(
      new TypeError('@gpahal/std: `mapLimit`: `items`: expected an iterable, received an object'),
    )
    // @ts-expect-error - Not an object, as a JavaScript caller can pass
    await expect(mapLimit([1], 1, (item) => item, null)).rejects.toThrow(
      new TypeError('@gpahal/std: `mapLimit`: `options`: expected an object, received `null`'),
    )
    // @ts-expect-error - Not a function, as a JavaScript caller can pass
    await expect(mapLimit([1], 1, undefined)).rejects.toThrow(
      new TypeError('@gpahal/std: `mapLimit`: `fn`: expected a function, received `undefined`'),
    )
  })
})

describe('retry', () => {
  it('calls fn again after each failure, waiting longer each time, until it succeeds', async () => {
    const times: Array<number> = []
    const start = Date.now()
    const promise = retry(
      async (attempt) => {
        times.push(Date.now() - start)
        if (attempt < 5) {
          throw new Error(`attempt ${attempt}`)
        }
        return attempt
      },
      { retries: 4, minDelayMs: 100, maxDelayMs: 250 },
    )
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe(5)
    expect(times).toEqual([0, 100, 300, 550, 800])
  })

  it('rejects with the last error once the retries run out', async () => {
    const fn = vi.fn(async (attempt: number) => {
      throw new Error(`attempt ${attempt}`)
    })
    const rejection = getRejection(retry(fn, { retries: 2, minDelayMs: 0 }))
    await vi.runAllTimersAsync()
    expect(await rejection).toEqual(new Error('attempt 3'))
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stops when shouldRetry returns or resolves false, or throws', async () => {
    const shouldRetry = vi.fn(async (_error: unknown, attempt: number) => attempt < 2)
    const rejection = getRejection(
      retry(
        async (attempt) => {
          throw new Error(`attempt ${attempt}`)
        },
        { minDelayMs: 0, shouldRetry },
      ),
    )
    await vi.runAllTimersAsync()
    expect(await rejection).toEqual(new Error('attempt 2'))
    expect(shouldRetry.mock.calls).toEqual([
      [new Error('attempt 1'), 1],
      [new Error('attempt 2'), 2],
    ])

    const thrown = new Error('shouldRetry failed')
    await expect(
      retry(
        () => {
          throw new Error('fn failed')
        },
        {
          shouldRetry: () => {
            throw thrown
          },
        },
      ),
    ).rejects.toBe(thrown)
  })

  it.each([
    { name: 'a string', result: 'no', described: '`"no"`' },
    { name: 'a promise of undefined', result: undefined, isAsync: true, described: '`undefined`' },
  ])('rejects when shouldRetry gives $name', async ({ result, isAsync = false, described }) => {
    const failure = new Error('failed')
    const fn = vi.fn(async () => {
      throw failure
    })
    const shouldRetry = isAsync ? async () => result : () => result
    // @ts-expect-error - Not a boolean, as a JavaScript caller can return
    const error = await getRejection(retry(fn, { shouldRetry }))
    expect(error).toEqual(
      new TypeError(
        `@gpahal/std: \`retry\`: \`options.shouldRetry\`: expected a result of \`true\` or \`false\`, received ${described}`,
      ),
    )
    expect((error as Error).cause).toBe(failure)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])(
    'rejects with the abort reason when the signal aborts while shouldRetry gives %s',
    async (result) => {
      const controller = new AbortController()
      const reason = new Error('aborted')
      const fn = vi.fn(async () => {
        throw new Error('failed')
      })
      const shouldRetry = async () => {
        controller.abort(reason)
        return result
      }
      const rejection = getRejection(
        retry(fn, { minDelayMs: 0, shouldRetry, signal: controller.signal }),
      )
      await vi.runAllTimersAsync()
      expect(await rejection).toBe(reason)
      expect(fn).toHaveBeenCalledTimes(1)
    },
  )

  it('retries without end with retries: Infinity, until the signal aborts', async () => {
    const controller = new AbortController()
    const reason = new Error('stop')
    const failing = vi.fn(async () => {
      throw new Error('failed')
    })
    const aborted = getRejection(
      retry(failing, { retries: Infinity, minDelayMs: 10, signal: controller.signal }),
    )
    await vi.advanceTimersByTimeAsync(1000)
    controller.abort(reason)
    expect(await aborted).toBe(reason)
    expect(failing.mock.calls.length).toBeGreaterThan(5)
  })

  it('passes the signal to fn and stops when it aborts, before, during a wait or during fn', async () => {
    const reason = new Error('stop')
    const fn = vi.fn<() => Promise<never>>()
    await expect(retry(fn, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
    expect(fn).not.toHaveBeenCalled()

    const waiting = new AbortController()
    const signals: Array<AbortSignal> = []
    const duringWait = getRejection(
      retry(
        async (_attempt, signal) => {
          signals.push(signal)
          throw new Error('failed')
        },
        { signal: waiting.signal },
      ),
    )
    await vi.advanceTimersByTimeAsync(50)
    waiting.abort(reason)
    expect(await duringWait).toBe(reason)
    expect(signals).toEqual([waiting.signal])
    expect(getEventListeners(waiting.signal, 'abort')).toHaveLength(0)

    const running = new AbortController()
    const duringFn = getRejection(
      retry(
        async () => {
          running.abort(reason)
          throw new Error('aborted')
        },
        { signal: running.signal },
      ),
    )
    expect(await duringFn).toBe(reason)
  })

  it.each<[object, ErrorConstructor, string]>([
    [
      { retries: 1.5 },
      RangeError,
      '`options.retries`: expected an integer of at least 0 or `Infinity`, received `1.5`',
    ],
    [
      { minDelayMs: 200, maxDelayMs: 100 },
      RangeError,
      '`options.maxDelayMs`: expected a number between 200 and 2147483647, received `100`',
    ],
    [
      { factor: 0.5 },
      RangeError,
      '`options.factor`: expected a number of at least 1, received `0.5`',
    ],
    [
      { retries: '2' },
      TypeError,
      '`options.retries`: expected a number or `undefined`, received `"2"`',
    ],
    [
      { minDelayMs: null },
      TypeError,
      '`options.minDelayMs`: expected a number or `undefined`, received `null`',
    ],
    [
      { jitterRatio: 1n },
      TypeError,
      '`options.jitterRatio`: expected a number or `undefined`, received `1n`',
    ],
    [
      { shouldRetry: true },
      TypeError,
      '`options.shouldRetry`: expected a function or `undefined`, received `true`',
    ],
  ])('rejects the invalid options %o', async (options, ErrorType, message) => {
    // Not options of the right types, as a JavaScript caller can pass
    await expect(retry(async () => 1, options as RetryOptions)).rejects.toThrow(
      new ErrorType(`@gpahal/std: \`retry\`: ${message}`),
    )
  })
})

describe('mapLimitIterable', () => {
  it('runs at most limit calls at once and yields the results in input order', async () => {
    let running = 0
    let maxRunning = 0
    const delays = [30, 10, 20, 5, 15, 25]
    const results = collect(
      mapLimitIterable(delays, 2, async (delay, index) => {
        running++
        maxRunning = Math.max(maxRunning, running)
        await sleep(delay)
        running--
        return `${index}:${delay}`
      }),
    )
    await vi.runAllTimersAsync()
    expect(await results).toEqual(['0:30', '1:10', '2:20', '3:5', '4:15', '5:25'])
    expect(maxRunning).toBe(2)
  })

  it('reads an async iterable, and an empty one', async () => {
    async function* generateSlowly() {
      yield 1
      await sleep(10)
      yield 2
    }
    const results = collect(mapLimitIterable(generateSlowly(), Infinity, async (item) => item * 2))
    await vi.runAllTimersAsync()
    expect(await results).toEqual([2, 4])
    expect(await collect(mapLimitIterable([], 1, (item) => item))).toEqual([])
  })

  it('starts no more than limit calls ahead of a slow consumer', async () => {
    const { source, state } = createCountingSource(10)
    const started: Array<number> = []
    const iterator = mapLimitIterable(source, 3, async (item) => {
      started.push(item)
      return item
    })[Symbol.asyncIterator]()
    expect(state.read).toBe(0)
    expect(await iterator.next()).toEqual({ done: false, value: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([0, 1, 2])
    expect(await iterator.next()).toEqual({ done: false, value: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([0, 1, 2, 3])
    expect(state.read).toBe(4)
  })

  it('closes the source and aborts the running calls when the consumer stops early', async () => {
    const { source, state } = createCountingSource(10)
    const signals: Array<AbortSignal> = []
    const controller = new AbortController()
    const iterator = mapLimitIterable(
      source,
      3,
      async (item, _index, signal) => {
        signals.push(signal)
        if (item > 0) {
          await sleep(100)
        }
        return item
      },
      { signal: controller.signal },
    )[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: 0 })
    // What `break` in a `for await...of` loop calls
    await iterator.return?.()
    expect(state.isClosed).toBe(true)
    expect(signals[0]?.reason).toHaveProperty('name', 'AbortError')
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('rejects on the first failure, even while an earlier call runs, aborting the calls and closing the source', async () => {
    const { source, state } = createCountingSource(10)
    const error = new Error('failed')
    const signals: Array<AbortSignal> = []
    const iterator = mapLimitIterable(source, 3, async (item, _index, signal) => {
      signals.push(signal)
      if (item === 0) {
        return Promise.withResolvers<never>().promise
      }
      if (item === 2) {
        throw error
      }
      return item
    })[Symbol.asyncIterator]()
    expect(await getRejection(iterator.next())).toBe(error)
    expect(signals[0]?.reason).toBe(error)
    expect(state.isClosed).toBe(true)
    expect(state.read).toBe(3)
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
  })

  it('rejects with the reason when the signal aborts, before or during the iteration', async () => {
    const reason = new Error('stop')
    const fn = vi.fn((item: number) => item)
    const { source, state } = createCountingSource(3)
    await expect(
      collect(mapLimitIterable(source, 1, fn, { signal: AbortSignal.abort(reason) })),
    ).rejects.toBe(reason)
    expect(fn).not.toHaveBeenCalled()
    expect(state.read).toBe(0)

    const controller = new AbortController()
    const counting = createCountingSource(3)
    const rejection = getRejection(
      collect(
        mapLimitIterable(counting.source, 1, async () => Promise.withResolvers<never>().promise, {
          signal: controller.signal,
        }),
      ),
    )
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(reason)
    expect(await rejection).toBe(reason)
    expect(counting.state.isClosed).toBe(true)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('rejects without closing the source when its next throws', async () => {
    const error = new Error('next failed')
    let isClosed = false
    const source: Iterable<number> = {
      [Symbol.iterator]: () => ({
        next: () => {
          throw error
        },
        return: () => {
          isClosed = true
          return { done: true, value: undefined }
        },
      }),
    }
    await expect(collect(mapLimitIterable(source, 2, (item) => item))).rejects.toBe(error)
    expect(isClosed).toBe(false)
  })

  it('throws invalid arguments when called', () => {
    expect(() => mapLimitIterable([1], 0, (item) => item)).toThrow(
      new RangeError(
        '@gpahal/std: `mapLimitIterable`: `limit`: expected a positive integer or `Infinity`, received `0`',
      ),
    )
    // @ts-expect-error - Not iterable, as a JavaScript caller can pass
    expect(() => mapLimitIterable(1, 1, (item) => item)).toThrow(
      new TypeError(
        '@gpahal/std: `mapLimitIterable`: `items`: expected an iterable or an async iterable, received `1`',
      ),
    )
  })
})
