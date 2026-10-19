import { clamp } from '@/numbers'

describe('clamp', () => {
  it('limits the value to the range, bounds included, and keeps NaN', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(5, -Infinity, Infinity)).toBe(5)
    expect(clamp(NaN, 0, 10)).toBeNaN()
  })

  it.each([
    [[1n, 0, 2], new TypeError('@gpahal/std: `clamp`: `value`: expected a number, received `1n`')],
    [
      [1, 0, null],
      new TypeError('@gpahal/std: `clamp`: `max`: expected a number, received `null`'),
    ],
    [
      [1, NaN, 10],
      new RangeError('@gpahal/std: `clamp`: `min`: expected a number, received `NaN`'),
    ],
    [
      [1, 10, 0],
      new RangeError(
        '@gpahal/std: `clamp`: `min`: expected at most `max`, which is `0`, received `10`',
      ),
    ],
  ])('throws for invalid arguments, case %#', (args, error) => {
    // @ts-expect-error - Not numbers, as a JavaScript caller can pass
    expect(() => clamp(...args)).toThrow(error)
  })
})
