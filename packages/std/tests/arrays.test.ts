import { chunk, isArray, isArrayOf, isNonEmpty, partition, toArray, unique } from '@/arrays'
import type { ReadonlyNonEmptyArray } from '@/arrays'

function isString(item: unknown): item is string {
  return typeof item === 'string'
}

describe('isArray', () => {
  it('accepts only arrays', () => {
    // `unknown`, as type guards take: a guard on a value of its own type is a lint error
    const array: unknown = [1]
    expect(isArray(array)).toBe(true)
    expect(isArray({ length: 0 })).toBe(false)
  })

  it('narrows to the array members of a union, keeping readonly and augmented arrays', () => {
    const list = ['a'] as ReadonlyArray<string> | string
    if (isArray(list)) {
      expectTypeOf(list).toEqualTypeOf<ReadonlyArray<string>>()
    } else {
      expectTypeOf(list).toEqualTypeOf<string>()
    }
    const value: unknown = []
    if (isArray(value)) {
      expectTypeOf(value).toEqualTypeOf<Array<unknown>>()
    }
    // An `object` can be an array of numbers, so it isn't narrowed to `Array<string>`
    const objectOrStrings = [] as object | Array<string>
    if (isArray(objectOrStrings)) {
      expectTypeOf(objectOrStrings).toEqualTypeOf<Array<unknown> | Array<string>>()
    }
    const augmented = Object.assign([123], { tag: 'n' }) as
      (Array<number> & { tag: string }) | string
    if (isArray(augmented)) {
      expectTypeOf(augmented).toEqualTypeOf<Array<number> & { tag: string }>()
    }
    expect(isArray(list)).toBe(true)
  })
})

describe('isArrayOf', () => {
  it('accepts arrays whose items all pass the check', () => {
    // `unknown`, as type guards take: a guard on a value of its own type is a lint error
    const values: Array<unknown> = [['a', 'b'], [], ['a', 1], 'a']
    expect(values.map((value) => isArrayOf(value, isString))).toEqual([true, true, false, false])
  })

  it('checks a hole in a sparse array as undefined', () => {
    const deleted = ['a', 'b']
    // eslint-disable-next-line @typescript-eslint/no-array-delete -- Leaves the hole that's tested
    delete deleted[0]
    // `unknown`, as type guards take: a guard on a value of its own type is a lint error
    const withHoles: Array<unknown> = [
      // eslint-disable-next-line no-sparse-arrays -- The hole is what's tested
      [, 'a'],
      // eslint-disable-next-line unicorn/no-new-array -- An array of holes, which `Array.from` doesn't make
      new Array(2),
      deleted,
    ]
    expect(withHoles.map((value) => isArrayOf(value, isString))).toEqual([false, false, false])
    const isOptionalString = (item: unknown) => item === undefined || isString(item)
    // eslint-disable-next-line no-sparse-arrays -- The hole is what's tested
    const optional: Array<unknown> = [[undefined], [, 'a']]
    expect(optional.map((value) => isArrayOf(value, isOptionalString))).toEqual([true, true])
  })

  it('keeps a readonly array or tuple readonly, refining its items', () => {
    const values = ['a'] as ReadonlyArray<string | number> | string
    if (isArrayOf(values, isString)) {
      expectTypeOf(values).toEqualTypeOf<ReadonlyArray<string>>()
      expectTypeOf(values).not.toHaveProperty('push')
    }
    if (isArrayOf(values, (item) => item !== 0)) {
      expectTypeOf(values).toEqualTypeOf<ReadonlyArray<string | number>>()
      expectTypeOf(values).not.toHaveProperty('push')
    }
    const tuple = ['a', 'b'] as readonly [unknown, string] | undefined
    if (isArrayOf(tuple, isString)) {
      expectTypeOf(tuple).toEqualTypeOf<readonly [string, string]>()
    }
    if (isArrayOf(tuple, (item) => item !== 0)) {
      expectTypeOf(tuple).toEqualTypeOf<readonly [unknown, string]>()
    }
    const mutable = ['a'] as Array<string | number> | undefined
    if (isArrayOf(mutable, isString)) {
      expectTypeOf(mutable).toEqualTypeOf<Array<string>>()
    }
  })
})

describe('isNonEmpty', () => {
  it('accepts arrays with an item and narrows the first item', () => {
    const array: ReadonlyArray<number> = [2]
    expect(isNonEmpty([])).toBe(false)
    expect(isNonEmpty([undefined])).toBe(true)
    // eslint-disable-next-line no-sparse-arrays -- The hole is what's tested
    expect(isNonEmpty([,])).toBe(false)
    expect(isNonEmpty(array)).toBe(true)
    if (!isNonEmpty(array)) {
      return
    }
    expectTypeOf(array[0]).toEqualTypeOf<number>()
    expectTypeOf(array).toEqualTypeOf<ReadonlyNonEmptyArray<number>>()
  })
})

describe('toArray', () => {
  it('copies an array', () => {
    const list = Object.freeze(['a', 'b'])
    const copy = toArray<string>(list)
    expect(copy).toEqual(['a', 'b'])
    expect(copy).not.toBe(list)
    expectTypeOf(toArray(['a'] as ReadonlyArray<string> | string)).toEqualTypeOf<Array<string>>()
  })

  it('copies an array by index, without running a custom Symbol.iterator', () => {
    const list = ['a', 'b']
    const iterator = vi.fn<() => Iterator<string>>(() => ['x'][Symbol.iterator]())
    Object.defineProperty(list, Symbol.iterator, { value: iterator })
    expect(toArray(list)).toEqual(['a', 'b'])
    expect(iterator).not.toHaveBeenCalled()
  })

  it('keeps the holes of a sparse array, as clonePlain does', () => {
    // eslint-disable-next-line no-sparse-arrays -- A sparse array is the case under test
    const copy = toArray(['a', , 'c'])
    expect(copy).toHaveLength(3)
    expect(Object.hasOwn(copy, 1)).toBe(false)
    expect(copy[0]).toBe('a')
    expect(copy[2]).toBe('c')
    expect(toArray(Array.from({ length: 2 }))).toEqual([undefined, undefined])
  })

  it('rejects items that are arrays', () => {
    expectTypeOf(toArray(1 as number | ReadonlyArray<string>)).toEqualTypeOf<
      Array<number | string>
    >()
    // @ts-expect-error -- an item can't be an array
    toArray([['a']])
  })
})

describe('unique', () => {
  it('keeps the first of equal items, in order, comparing as a Set does', () => {
    expect(unique(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c'])
    expect(unique([NaN, NaN, 0, -0])).toEqual([NaN, 0])
    expect(unique([])).toEqual([])
  })
})

describe('chunk', () => {
  it('splits the items into arrays of size items, the last one shorter', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk(new Set(['a', 'b', 'c']), 5)).toEqual([['a', 'b', 'c']])
    expect(chunk([], 3)).toEqual([])
  })

  it.each([0, 1.5, NaN])('throws for a size of %d', (size) => {
    expect(() => chunk([1], size)).toThrow(
      new RangeError(
        `@gpahal/std: \`chunk\`: \`size\`: expected a positive integer, received \`${String(size)}\``,
      ),
    )
  })

  it('throws a TypeError for a size that is not a number', () => {
    // @ts-expect-error - A string, as a JavaScript caller can pass
    expect(() => chunk([1], '2')).toThrow(
      new TypeError('@gpahal/std: `chunk`: `size`: expected a number, received `"2"`'),
    )
  })
})

describe('partition', () => {
  it('narrows both arrays with a type guard', () => {
    const [strings, others] = partition(['a', 1, 'b', null], isString)
    expectTypeOf(strings).toEqualTypeOf<Array<string>>()
    expectTypeOf(others).toEqualTypeOf<Array<number | null>>()
    expect([strings, others]).toEqual([
      ['a', 'b'],
      [1, null],
    ])
  })
})
