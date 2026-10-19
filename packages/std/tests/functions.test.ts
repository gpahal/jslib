import v8 from 'node:v8'
import vm from 'node:vm'

import { debounce, memoize, once, throttle } from '@/functions'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('debounce', () => {
  it('calls fn once a burst ends, with the last arguments, and returns what flush runs', () => {
    const fn = vi.fn((value: number) => value * 2)
    const debounced = debounce(fn, 100)
    debounced(1)
    vi.advanceTimersByTime(50)
    debounced(2)
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn.mock.calls).toEqual([[2]])

    debounced(3)
    expect(debounced.flush()).toBe(6)
    expect(debounced.flush()).toBeUndefined()
  })

  it('calls fn at the start of a burst with leading, and at its end only after another call', () => {
    const fn = vi.fn<(value: number) => void>()
    const debounced = debounce(fn, 100, { leading: true })
    debounced(1)
    vi.advanceTimersByTime(100)
    debounced(2)
    debounced(3)
    vi.advanceTimersByTime(100)
    expect(fn.mock.calls).toEqual([[1], [2], [3]])
  })

  it('starts another wait when flush runs a pending call with leading', () => {
    const fn = vi.fn((value: number) => value)
    const debounced = debounce(fn, 200, { leading: true })
    debounced(1)
    debounced(2)
    expect(debounced.flush()).toBe(2)
    debounced(3)
    debounced(4)
    expect(fn.mock.calls).toEqual([[1], [2]])
    vi.advanceTimersByTime(200)
    expect(fn.mock.calls).toEqual([[1], [2], [4]])
  })

  it('calls fn at least once every maxWaitMs while calls keep coming', () => {
    const fn = vi.fn<(value: number) => void>()
    const debounced = debounce(fn, 100, { maxWaitMs: 250 })
    for (let t = 0; t < 1000; t += 50) {
      debounced(t)
      vi.advanceTimersByTime(50)
    }
    vi.advanceTimersByTime(1000)
    expect(fn.mock.calls).toEqual([[200], [450], [700], [950]])
  })

  it('starts maxWaitMs again after a flush, and stops it on cancel', () => {
    const fn = vi.fn<(value: number) => void>()
    const debounced = debounce(fn, 100, { maxWaitMs: 150 })
    debounced(1)
    vi.advanceTimersByTime(80)
    debounced(2)
    debounced.flush()
    vi.advanceTimersByTime(80)
    debounced(3)
    vi.advanceTimersByTime(80)
    // 150ms from the first call after the flush, not from the first call
    debounced(4)
    expect(fn.mock.calls).toEqual([[2]])
    vi.advanceTimersByTime(70)
    expect(fn.mock.calls).toEqual([[2], [4]])

    debounced(5)
    debounced.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn.mock.calls).toEqual([[2], [4]])
  })

  it.each([
    [
      // @ts-expect-error - JavaScript callers can pass anything
      () => debounce(1, 100),
      new TypeError('@gpahal/std: `debounce`: `fn`: expected a function, received `1`'),
    ],
    [
      () => debounce(() => 1, -1),
      new RangeError(
        '@gpahal/std: `debounce`: `waitMs`: expected a number between 0 and 2147483647, received `-1`',
      ),
    ],
    [
      // @ts-expect-error - JavaScript callers can pass anything
      () => debounce(() => 1, 1, { leading: 'yes' }),
      new TypeError(
        '@gpahal/std: `debounce`: `options.leading`: expected a boolean or `undefined`, received `"yes"`',
      ),
    ],
    [
      () => debounce(() => 1, 100, { maxWaitMs: 50 }),
      new RangeError(
        '@gpahal/std: `debounce`: `options.maxWaitMs`: expected a number between `waitMs`, which is `100`, and 2147483647, received `50`',
      ),
    ],
    [() => debounce(() => 1, 100, { maxWaitMs: NaN }), RangeError],
  ])('throws for invalid arguments, case %#', (call, error) => {
    expect(call).toThrow(error)
  })
})

describe('throttle', () => {
  it('calls fn at once, then with the last arguments of each wait, keeping calls waitMs apart', () => {
    const fn = vi.fn<(value: number) => void>()
    const throttled = throttle(fn, 100)
    throttled(1)
    throttled(2)
    throttled(3)
    expect(fn.mock.calls).toEqual([[1]])
    vi.advanceTimersByTime(100)
    expect(fn.mock.calls).toEqual([[1], [3]])
    throttled(4)
    expect(fn.mock.calls).toEqual([[1], [3]])
    vi.advanceTimersByTime(100)
    expect(fn.mock.calls).toEqual([[1], [3], [4]])
  })

  it('honors leading and trailing', () => {
    const trailingOnly = vi.fn<(value: number) => void>()
    const throttledTrailingOnly = throttle(trailingOnly, 100, { leading: false })
    throttledTrailingOnly(1)
    throttledTrailingOnly(2)
    expect(trailingOnly).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(trailingOnly.mock.calls).toEqual([[2]])

    const leadingOnly = vi.fn<(value: number) => void>()
    const throttledLeadingOnly = throttle(leadingOnly, 100, { trailing: false })
    throttledLeadingOnly(1)
    throttledLeadingOnly(2)
    vi.advanceTimersByTime(100)
    throttledLeadingOnly(3)
    expect(leadingOnly.mock.calls).toEqual([[1], [3]])
  })

  it('runs the pending call on flush and starts another wait, as lodash does', () => {
    const fn = vi.fn((value: number) => value)
    const throttled = throttle(fn, 200)
    throttled(1)
    throttled(2)
    expect(throttled.flush()).toBe(2)
    throttled(3)
    throttled(4)
    vi.advanceTimersByTime(199)
    expect(fn.mock.calls).toEqual([[1], [2]])
    vi.advanceTimersByTime(1)
    expect(fn.mock.calls).toEqual([[1], [2], [4]])
  })

  it('drops the pending call on cancel and ends the wait', () => {
    const fn = vi.fn((value: number) => value)
    const throttled = throttle(fn, 100)
    throttled(1)
    throttled(2)
    throttled.cancel()
    vi.advanceTimersByTime(100)
    throttled(3)
    expect(fn.mock.calls).toEqual([[1], [3]])
  })
})

describe('once', () => {
  it('calls fn once and returns its first result every time', () => {
    const fn = vi.fn((value: number) => value * 2)
    const doubled = once(fn)
    expect(doubled(1)).toBe(2)
    expect(doubled(5)).toBe(2)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws the first error every time', () => {
    const error = new Error('failed')
    const fn = vi.fn(() => {
      throw error
    })
    const failing = once(fn)
    expect(() => failing()).toThrow(error)
    expect(() => failing()).toThrow(error)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws for a call made while the first one runs', () => {
    const reentrant: () => number = once(() => reentrant() + 1)
    expect(() => reentrant()).toThrow(
      new TypeError('@gpahal/std: `once`: the function was called again while its first call runs'),
    )
  })
})

describe('memoize', () => {
  it('keeps a result by the argument, as a Map compares keys', () => {
    const fn = vi.fn((value: unknown) => [value])
    const wrap = memoize(fn)
    expect(wrap('a')).toBe(wrap('a'))
    expect(wrap(NaN)).toBe(wrap(NaN))
    expect(wrap(0)).toBe(wrap(-0))
    expect(wrap('1')).not.toBe(wrap(1))
    const key = {}
    expect(wrap(key)).toBe(wrap(key))
    expect(wrap({})).not.toBe(wrap({}))
    expect(fn).toHaveBeenCalledTimes(8)
  })

  it('holds an object key weakly, so a kept result does not keep it from being collected', async () => {
    vi.useRealTimers()
    v8.setFlagsFromString('--expose-gc')
    const gc = vm.runInNewContext('gc') as () => void
    const wrap = memoize((value: object) => [value])
    const ref = keepResultForTemporaryKey(wrap)
    // A weak reference holds its target until the current job ends
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    gc()
    expect(ref.deref()).toBeUndefined()
  })

  it('keeps undefined results, and keeps no result when fn throws', () => {
    const undefinedFn = vi.fn((_: string): undefined => undefined)
    const wrapped = memoize(undefinedFn)
    wrapped('a')
    wrapped('a')
    expect(undefinedFn).toHaveBeenCalledOnce()

    let calls = 0
    const flaky = memoize((value: number) => {
      calls++
      if (calls === 1) {
        throw new Error('first')
      }
      return value
    })
    expect(() => flaky(1)).toThrow('first')
    expect(flaky(1)).toBe(1)
    expect(calls).toBe(2)
  })

  it('keeps results by what key gives, passing every argument to fn, until clear', () => {
    const fn = vi.fn((a: string, b: number) => `${a}${b}`)
    const join = memoize(fn, { key: (a, b) => `${a}:${b}` })
    expect(join('a', 1)).toBe('a1')
    expect(join('a', 1)).toBe('a1')
    expect(join('a', 2)).toBe('a2')
    join.clear()
    join('a', 1)
    expect(fn.mock.calls).toEqual([
      ['a', 1],
      ['a', 2],
      ['a', 1],
    ])
  })

  it('needs key for a function of more than one parameter or a rest parameter', () => {
    // @ts-expect-error - Two parameters without `key`
    memoize((a: string, b: number) => `${a}${b}`)
    // @ts-expect-error - A rest parameter without `key`
    memoize((...parts: Array<string>) => parts.join(''))
    const optional = memoize((a?: string) => a ?? '')
    expectTypeOf(optional).parameters.toEqualTypeOf<[a?: string | undefined]>()
  })
})

/**
 * Call `wrap` with an object made here, and give a weak reference to it, so no variable of the
 * test holds it
 */
function keepResultForTemporaryKey(wrap: (value: object) => unknown): WeakRef<object> {
  const key = {}
  wrap(key)
  return new WeakRef(key)
}
