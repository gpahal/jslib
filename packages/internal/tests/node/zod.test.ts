import * as z from 'zod/mini'

import {
  assertValid,
  expectedError,
  loadZod,
  plainObject,
  strictObject,
  stringOrStrings,
  typeCheck,
} from '@/node/zod'

import { CONTEXT, getMessage } from './helpers'

test("`loadZod` returns the namespace that `import` gives, so schemas mix with the caller's", () => {
  expect(loadZod()).toBe(z)
})

test('`expectedError` names the expected value and the value received, then the hint', () => {
  const hinted = z.custom((value) => value === 1, { error: expectedError('one', 'Pass `1`') })
  expect(getMessage(hinted, 'a')).toBe(
    '@scope/config: options: expected one, received `"a"`. Pass `1`',
  )
})

describe('plainObject', () => {
  it.each([
    [[], 'an array'],
    [new Map(), 'an instance of `Map`'],
    [null, '`null`'],
  ])('rejects %o', (value, described) => {
    expect(getMessage(plainObject(), value)).toBe(
      `@scope/config: options: expected an object, received ${described}`,
    )
  })

  it('outputs a copy without a prototype, so a JSON `__proto__` key stays an own key', () => {
    expect(getMessage(plainObject(), Object.create(null))).toBeUndefined()
    const value: unknown = JSON.parse('{"a":1,"__proto__":{"polluted":1}}')
    const valid = assertValid(plainObject(), value, CONTEXT)
    expect(valid).not.toBe(value)
    expect(Object.getPrototypeOf(valid)).toBeNull()
    expect(Object.keys(valid)).toEqual(['a', '__proto__'])
    expect(valid['polluted']).toBeUndefined()
  })
})

describe('strictObject', () => {
  const schema = strictObject(
    { quotes: z.optional(z.literal(['single', 'double'])), semi: z.boolean() },
    { noun: 'option' },
  )

  it('takes known keys, required unless optional, and names each invalid value by its path', () => {
    expect(getMessage(schema, { semi: true })).toBeUndefined()
    expect(getMessage(schema, { quotes: 'back', semi: 'yes' })).toBe(
      [
        '@scope/config: options: 2 issues',
        '  `quotes`: expected `"single"` or `"double"`, received `"back"`',
        '  `semi`: expected a boolean, received `"yes"`',
      ].join('\n'),
    )
    expect(getMessage(schema, 'all')).toBe(
      '@scope/config: options: expected an object, received `"all"`',
    )
  })

  it('names each unknown key, including `Object.prototype` names and enumerable symbols, with the known ones', () => {
    expect(getMessage(schema, { semi: 1, [Symbol('q')]: 1, toString: 2 })).toBe(
      [
        '@scope/config: options: 3 issues',
        '  `[Symbol(q)]`: unknown option. Known options: `quotes`, `semi`',
        '  `semi`: expected a boolean, received `1`',
        '  `toString`: unknown option. Known options: `quotes`, `semi`',
      ].join('\n'),
    )
    expect(getMessage(strictObject({}), { a: 1 })).toBe(
      '@scope/config: options: `a`: unknown key. It takes no keys',
    )
  })

  it('writes a quoted key with its JSON escapes, and shortens a key over 40 characters', () => {
    const known = 'unknown option. Known options: `quotes`, `semi`'
    expect(getMessage(schema, { semi: true, 'a"b': 1 })).toBe(
      `@scope/config: options: \`["a\\"b"]\`: ${known}`,
    )
    const key = `${'a'.repeat(100)}${'b'.repeat(100)}`
    expect(getMessage(schema, { semi: true, [key]: 1 })).toBe(
      `@scope/config: options: \`${'a'.repeat(20)}…${'b'.repeat(19)}\`: ${known}`,
    )
  })
})

test('`stringOrStrings` names a bad item, or the expected types', () => {
  expect(getMessage(stringOrStrings(), ['a', 'b'])).toBeUndefined()
  expect(getMessage(stringOrStrings(), ['a', 1])).toBe(
    '@scope/config: options: `[1]`: expected a string, received `1`',
  )
  expect(getMessage(stringOrStrings(), 1)).toBe(
    '@scope/config: options: expected a string or an array of strings, received `1`',
  )
})

describe('assertValid', () => {
  it('names an issue of the value itself by the root subject, and others by their path', () => {
    const schema = strictObject({ semi: z.boolean() }, { expected: 'an object of options' })
    const context = { prefix: '@scope/config', rootSubject: 'options' }
    expect(() => assertValid(schema, null, context)).toThrow(
      new TypeError('@scope/config: options: expected an object of options, received `null`'),
    )
    expect(() => assertValid(schema, { semi: 1 }, context)).toThrow(
      new TypeError('@scope/config: `semi`: expected a boolean, received `1`'),
    )
    expect(() => assertValid(schema, null, { ...context, subject: '`a`' })).toThrow(
      new TypeError('@scope/config: `a`: options: expected an object of options, received `null`'),
    )
  })

  it('reports only the branches of a union that took the value type', () => {
    const schema = z.union(
      [
        z.boolean(),
        typeCheck<() => void>((value) => typeof value === 'function', { expected: 'a function' }),
        strictObject({ refresh: z.optional(z.boolean()) }),
        z.string().check(z.minLength(5)),
        z.string().check(z.regex(/^a/)),
      ],
      { error: expectedError('a boolean, a function, an object or a string') },
    )
    expect(getMessage(schema, { refresh: 'yes' })).toBe(
      '@scope/config: options: `refresh`: expected a boolean, received `"yes"`',
    )
    expect(getMessage(schema, 'b')).toBe(
      [
        '@scope/config: options: 2 issues',
        '  expected a string of at least 5 characters, received `"b"`',
        '  invalid string: must match pattern /^a/, received `"b"`',
      ].join('\n'),
    )
    expect(getMessage(schema, 1)).toBe(
      '@scope/config: options: expected a boolean, a function, an object or a string, received `1`',
    )
  })

  it('reports a nested union whose branches all rejected the type as a type mismatch', () => {
    const schema = z.union(
      [z.boolean(), z.union([z.array(z.string()), z.number().check(z.minimum(5))])],
      { error: expectedError('a boolean, strings or a number') },
    )
    expect(getMessage(schema, 'a')).toBe(
      '@scope/config: options: expected a boolean, strings or a number, received `"a"`',
    )
    expect(getMessage(schema, 1)).toBe(
      '@scope/config: options: expected a number greater than or equal to `5`, received `1`',
    )
  })

  it("names the types of a union without its own error that rejected the value's type", () => {
    const schema = z.union([
      z.string(),
      z.literal(['a', 'b']),
      typeCheck<() => void>((value) => typeof value === 'function', { expected: 'a function' }),
      z.union([z.number(), z.null()]),
    ])
    expect(getMessage(schema, true)).toBe(
      '@scope/config: options: expected a string, `"a"`, `"b"`, a function, a number or `null`, received `true`',
    )
  })

  it.each([
    [z.string().check(z.minLength(2)), 'a', 'a string of at least 2 characters', '`"a"`'],
    [
      z.array(z.number()).check(z.maxLength(1)),
      [1, 2],
      'an array of at most 1 item',
      'an array of 2 items',
    ],
    [z.number().check(z.gt(1)), 1, 'a number greater than `1`', '`1`'],
    [
      z.date().check(z.lt(new Date('2020-01-01T00:00:00Z'))),
      new Date('2020-01-01T00:00:00Z'),
      'a date before `2020-01-01T00:00:00.000Z`',
      '`2020-01-01T00:00:00.000Z`',
    ],
    [z.int(), 1.5, 'an integer', '`1.5`'],
  ])('words a size, bound or type issue as expected %#', (schema, value, expected, received) => {
    expect(getMessage(schema, value)).toBe(
      `@scope/config: options: expected ${expected}, received ${received}`,
    )
  })

  it("lowercases Zod's own message for other issues, naming the value of a format issue", () => {
    expect(getMessage(z.string().check(z.regex(/^a/)), 'b')).toBe(
      '@scope/config: options: invalid string: must match pattern /^a/, received `"b"`',
    )
    expect(getMessage(z.number().check(z.multipleOf(2)), 3)).toBe(
      '@scope/config: options: invalid number: must be a multiple of 2',
    )
  })

  it('lists at most 20 issues', () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, 1]))
    const lines = getMessage(z.record(z.string(), z.string()), many)?.split('\n')
    expect(lines?.[0]).toBe('@scope/config: options: 25 issues, the first 20 shown')
    expect(lines).toHaveLength(21)
  })

  it('names nested paths, quoting keys that are not identifiers', () => {
    const schema = strictObject({
      overrides: z.array(strictObject({ files: stringOrStrings() })),
      a: z.optional(z.record(z.string(), z.number())),
    })
    expect(
      getMessage(schema, { overrides: [{ files: 'a' }, { files: 1 }], a: { 'b-c': 'x' } }),
    ).toBe(
      [
        '@scope/config: options: 2 issues',
        '  `overrides[1].files`: expected a string or an array of strings, received `1`',
        '  `a["b-c"]`: expected a number, received `"x"`',
      ].join('\n'),
    )
  })

  it('returns a copy of each strict object with its own keys and no prototype, and keeps the Zod error as the cause', () => {
    const schema = strictObject({
      toString: z.optional(z.string()),
      nested: z.optional(strictObject({ name: z.optional(z.string()) })),
      list: z.optional(z.array(z.string())),
      transform: z.optional(
        typeCheck<() => void>((value) => typeof value === 'function', { expected: 'a function' }),
      ),
    })
    const value = { nested: {}, list: ['a'], transform: noop }
    Reflect.set(Object.prototype, 'name', 'polluted')
    try {
      const valid = assertValid(schema, value, CONTEXT)
      expect(Object.getPrototypeOf(valid)).toBeNull()
      expect(valid.toString).toBeUndefined()
      expect(valid.nested?.name).toBeUndefined()
      expect(valid.list).not.toBe(value.list)
      // Values that schemas check without copying keep their identity
      expect(valid.transform).toBe(noop)
    } finally {
      Reflect.deleteProperty(Object.prototype, 'name')
    }
    expect(() => assertValid(z.boolean(), 1, CONTEXT)).toThrow(
      expect.objectContaining({ cause: expect.any(z.core.$ZodError) as unknown }),
    )
  })

  it('fails to compile for a schema whose output differs from its input', () => {
    const value: unknown = '123'
    // @ts-expect-error - Coerces a string to a number, but the value stays a string
    expect(() => assertValid(z.coerce.number(), value, CONTEXT)).not.toThrow()
    // @ts-expect-error - Defaults `semi`, but the value stays without it
    assertValid(strictObject({ semi: z._default(z.boolean(), true) }), {}, CONTEXT)
  })
})

function noop(): void {
  // A function, which `assertValid` keeps as it is
}
