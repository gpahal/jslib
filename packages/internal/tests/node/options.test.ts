import * as z from 'zod/mini'

import {
  booleanOr,
  deferred,
  isStringOrStrings,
  listOption,
  optionsObject,
  required,
  resolveListOption,
  resolveSubOptions,
} from '@/node/options'
import type { ListOption, ListTransform, OptionsShape } from '@/node/options'
import { assertValid, plainObject } from '@/node/zod'

import { CONTEXT, getMessage } from './helpers'

type Options = {
  root: string
  semi?: boolean | undefined
  react?: boolean | { refresh?: boolean | undefined } | undefined
}

const SHAPE: OptionsShape<Options> = {
  root: required(z.string()),
  semi: z.boolean(),
  react: booleanOr(optionsObject<{ refresh?: boolean | undefined }>({ refresh: z.boolean() })),
}

describe('optionsObject', () => {
  const schema = optionsObject<Options>(SHAPE)

  it('requires the required keys, and leaves an optional key given as `undefined` out of the output', () => {
    expect(getMessage(schema, { semi: true })).toBe(
      '@scope/config: options: `root`: expected a string, received `undefined`',
    )
    const options = assertValid(schema, { root: '/a', semi: undefined, react: true }, CONTEXT)
    expectTypeOf(options).toEqualTypeOf<Options>()
    expect(Object.keys(options)).toEqual(['root', 'react'])
  })

  it('names unknown options with the known ones', () => {
    expect(getMessage(schema, { root: '/a', reactt: true })).toBe(
      '@scope/config: options: `reactt`: unknown option. Known options: `root`, `semi`, `react`',
    )
  })

  it('requires a schema of the right type for every key, and `required` for exactly the required ones', () => {
    // @ts-expect-error - `root` is required
    const unmarked: OptionsShape<Options> = { ...SHAPE, root: z.string() }
    // @ts-expect-error - `semi` is optional
    const marked: OptionsShape<Options> = { ...SHAPE, semi: required(z.boolean()) }
    const { semi: _, ...rest } = SHAPE
    // @ts-expect-error - `semi` has no schema
    const missing: OptionsShape<Options> = rest
    // @ts-expect-error - `semi` is a boolean
    const mismatched: OptionsShape<Options> = { ...SHAPE, semi: z.string() }
    // @ts-expect-error - a required key can't be `undefined`, so its type can't include it
    const withUndefined: OptionsShape<{ a: number | undefined }> = { a: required(z.number()) }
    // @ts-expect-error - `deferred` names a pass-through schema, even for a key typed `unknown`
    const unknownKey: OptionsShape<{ a?: unknown }> = { a: z.unknown() }
    // A later check validates `b`'s presence too
    const deferredPresence: OptionsShape<{ b: number }> = { b: deferred() }
    expect([
      unmarked,
      marked,
      missing,
      mismatched,
      withUndefined,
      unknownKey,
      deferredPresence,
    ]).toHaveLength(7)
  })

  it('takes any value for a `deferred` key, and checks what its schema checks', () => {
    const anyValue = optionsObject<{ a: unknown }>({ a: required(deferred()) })
    expect(getMessage(anyValue, { a: null })).toBeUndefined()
    expect(getMessage(anyValue, { a: undefined })).toBe(
      '@scope/config: options: `a`: expected a value, received `undefined`',
    )
    type Rules = Record<string, 'off' | 'error'>
    const rules = optionsObject<{ rules?: Rules | undefined }>({
      rules: deferred<Rules>(plainObject()),
    })
    expect(getMessage(rules, { rules: 'off' })).toBe(
      '@scope/config: options: `rules`: expected an object, received `"off"`',
    )
  })
})

test('`booleanOr` names what it takes when a nested union rejects the type', () => {
  const schema = booleanOr(listOption(z.string(), 'globs'), {
    expected: 'a boolean or globs',
    hint: 'See X',
  })
  expect(getMessage(schema, 1)).toBe(
    '@scope/config: options: expected a boolean or globs, received `1`. See X',
  )
})

test('`listOption` takes an array or a function, and names a bad item or value', () => {
  const schema = optionsObject<{ files?: ListOption | undefined }>({
    files: listOption(z.string(), 'globs'),
  })
  expect(getMessage(schema, { files: (defaults: Array<string>) => defaults })).toBeUndefined()
  expect(getMessage(schema, { files: ['src/**', 1] })).toBe(
    '@scope/config: options: `files[1]`: expected a string, received `1`',
  )
  expect(getMessage(schema, { files: 'src/**' })).toBe(
    '@scope/config: options: `files`: expected an array of globs or a function of the defaults, received `"src/**"`',
  )
})

describe('resolveListOption', () => {
  const listContext = { prefix: '@scope/config', name: 'functions' }
  const defaults = ['cn', 'clsx']

  it('returns a copy of the defaults when left out, and a copy of an array in their place', () => {
    const list = resolveListOption(undefined, defaults, listContext)
    expect(list).toEqual(defaults)
    expect(list).not.toBe(defaults)
    const option = Object.freeze(['tw'])
    const replaced = resolveListOption(option, defaults, listContext)
    expect(replaced).toEqual(['tw'])
    expect(replaced).not.toBe(option)
  })

  it('returns what a function returns from a copy of the defaults', () => {
    const withoutCn: ListOption = (list) => {
      list.push('mutated')
      return list.filter((item) => item !== 'cn')
    }
    expect(resolveListOption(withoutCn, defaults, listContext)).toEqual(['clsx', 'mutated'])
    expect(defaults).toEqual(['cn', 'clsx'])
    // A transform may return a frozen array
    const withTw: ListTransform = (list) => Object.freeze([...list, 'tw'])
    expect(resolveListOption(withTw, defaults, listContext)).toEqual(['cn', 'clsx', 'tw'])
  })

  it('reports an error a function option throws, keeping it as the cause', () => {
    const error = new Error('oops')
    expect(() =>
      resolveListOption(
        () => {
          throw error
        },
        defaults,
        listContext,
      ),
    ).toThrow(
      expect.objectContaining({
        name: 'TypeError',
        message: '@scope/config: `functions`: the function threw: oops',
        cause: error,
      }),
    )
  })

  it.each([
    ['tw', 'expected an array of strings or a function of the defaults, received `"tw"`'],
    [
      // eslint-disable-next-line no-sparse-arrays -- The hole is what's tested
      [, 'tw'],
      'expected an array of strings or a function of the defaults, received an array with `undefined`',
    ],
    [
      () => ['a', 1],
      'expected the function to return an array of strings, received an array with `1`',
    ],
  ])('throws a TypeError for the option %j', (option, description) => {
    // @ts-expect-error - Options of the wrong type, as a JavaScript config can pass
    const resolve = () => resolveListOption(option, defaults, listContext)
    expect(resolve).toThrow(new TypeError(`@scope/config: \`functions\`: ${description}`))
  })

  it('names what an array option is with `expected`, and escapes backticks in the name', () => {
    const context = { prefix: '@scope/config', name: 'a`b', expected: 'an array of globs' }
    // @ts-expect-error - An item of the wrong type, as a JavaScript config can pass
    expect(() => resolveListOption([1], defaults, context)).toThrow(
      new TypeError(
        '@scope/config: `a\\`b`: expected an array of globs or a function of the defaults, received an array with `1`',
      ),
    )
  })
})

test('`resolveSubOptions` gives the object form, or `undefined` for a boolean or an option left out', () => {
  expect(resolveSubOptions({ rules: {} })).toEqual({ rules: {} })
  expect(resolveSubOptions(true)).toBeUndefined()
  expect(resolveSubOptions(undefined)).toBeUndefined()
})

test('`isStringOrStrings` takes a string or an array of strings, holes excluded', () => {
  // eslint-disable-next-line no-sparse-arrays -- The hole is what's tested
  const values: Array<unknown> = ['a', ['a', 'b'], ['a', 1], {}, ['a', , 'b']]
  expect(values.map((value) => isStringOrStrings(value))).toEqual([true, true, false, false, false])
})
