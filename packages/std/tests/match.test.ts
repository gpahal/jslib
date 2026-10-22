import { match, matchValue } from '@/match'

describe('match', () => {
  it('returns the value for a key, matching a number against the string form of a numeric key', () => {
    const key = 'a' as 'a' | 'b'
    expect(match(key, { a: 1, b: 2 })).toBe(1)
    const id = 2 as 1 | 2
    expect(match(id, { 1: 'one', 2: 'two' })).toBe('two')
  })

  it('calls a function handler with the extra arguments, and returns a function it returns', () => {
    expect(match('a', { a: (x: number, y: number) => x * y }, 2, 3)).toBe(6)
    const fn = vi.fn<() => string>()
    expect(match('a', { a: () => fn })).toBe(fn)
    expect(fn).not.toHaveBeenCalled()
  })

  it('throws when there is no own entry, leaving itself out of the stack', () => {
    let error: unknown
    try {
      match('c' as 'a' | 'b', { a: 1, b: 2 })
    } catch (error_) {
      error = error_
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).stack).not.toMatch(/at match \(/)
    expect(() => match('toString' as 'a', { a: 1 })).toThrow(
      '@gpahal/std: `match`: expected a value with an entry in `lookup`, received `"toString"`',
    )
  })

  it('lists at most 20 valid values, and counts the others', () => {
    const keys = Array.from({ length: 21 }, (_, i) => `k${i}`)
    const missing = 'x'.repeat(1)
    const listed = keys
      .slice(0, 20)
      .map((key) => `\`"${key}"\``)
      .join(', ')
    expect(() => matchValue(missing, Object.fromEntries(keys.map((key) => [key, 1])))).toThrow(
      new Error(
        `@gpahal/std: \`matchValue\`: expected a value with an entry in \`lookup\`, received \`"x"\`. Known values: ${listed} and 1 other`,
      ),
    )
    expect(() => matchValue(missing, {})).toThrow(
      new Error(
        '@gpahal/std: `matchValue`: expected a value with an entry in `lookup`, received `"x"`. It has no values',
      ),
    )
  })
})

// `typecheck` checks these types (`tsc -p tests`): Vitest doesn't
describe('match types', () => {
  it('infers handler parameters and the result from the arguments and the entries', () => {
    expectTypeOf(match('a', { a: (x) => x + 1 }, 1)).toEqualTypeOf<number>()
    const value = 'b' as 'a' | 'b'
    expectTypeOf(match(value, { a: 'x', b: () => 1 })).toEqualTypeOf<number | string>()
    const key = 'a'.repeat(1)
    expectTypeOf(match(key, { a: 1, b: () => 'x' })).toEqualTypeOf<number | string>()
  })

  it('rejects arguments that some handler does not accept, and missing or extra entries', () => {
    const value = 'a' as 'a' | 'b'
    // @ts-expect-error - every handler must accept the arguments, not only the one that matches
    expect(match(value, { a: (x: number) => x, b: (x: string) => x }, 1)).toBe(1)
    // @ts-expect-error - there is no entry for `b`
    expect(() => match('b', { a: 1 })).toThrow(Error)
    // @ts-expect-error - `c` isn't a value `value` can be
    match(value, { a: 1, b: 2, c: 3 })
    // @ts-expect-error - as above
    matchValue(value, { a: 1, b: 2, c: 3 })
    // @ts-expect-error - there is no entry for `b`
    matchValue(value, { a: 1 })
  })
})

describe('matchValue', () => {
  it('returns function values without calling them', () => {
    const fn = vi.fn<() => string>()
    const value = 'a' as 'a' | 'b'
    const result = matchValue(value, { a: fn, b: 1 })
    expect(result).toBe(fn)
    expectTypeOf(result).toEqualTypeOf<typeof fn | number>()
    expect(fn).not.toHaveBeenCalled()
  })
})
