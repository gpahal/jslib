/**
 * Schemas and resolvers for the options of the config packages' functions, such as `defineConfig`.
 * Contract: trusted values from the developer's own code. Types and unknown keys are checked, but
 * hostile getters, proxies and iterators aren't defended against
 */

import type * as z from 'zod/mini'

import { isArrayOf } from '@gpahal/std/arrays'
import { describeValue, formatMessage, formatNames, getErrorReason } from '@gpahal/std/errors'

import { expectedError, loadZod, strictObject, typeCheck } from '@/node/zod'
import type { ExpectedOptions } from '@/node/zod'

/**
 * A function that gets a copy of a list option's defaults and returns the list to use
 */
export type ListTransform<T = string> = (defaults: Array<T>) => ReadonlyArray<T>

/**
 * A list option whose defaults are known: an array replaces the defaults, and a
 * {@link ListTransform} transforms them
 */
export type ListOption<T = string> = ReadonlyArray<T> | ListTransform<T>

declare const REQUIRED: unique symbol

declare const DEFERRED: unique symbol

type ValueSchema<V> = z.ZodMiniType<V>

export type RequiredSchema<V = unknown> = ValueSchema<V> & { readonly [REQUIRED]: true }

/**
 * Its input type is its output type, as `assertValid` and {@link booleanOr} take. `NoInfer` lets
 * `deferred()` infer `V` from the key's type alone, since a shape's schemas take any input
 */
export type DeferredSchema<V = unknown> = z.ZodMiniType<V, NoInfer<V>> & {
  readonly [DEFERRED]: true
}

/**
 * A key typed `unknown` takes only a {@link deferred} schema, so a bare `z.unknown()` fails to
 * compile
 */
type KeySchema<V> = unknown extends V ? DeferredSchema : ValueSchema<V>

/**
 * A schema for each key of the options type `T`, whose output fits the key's type without
 * `undefined`, wrapped in {@link required} exactly where `T` can't leave the key out. A required key
 * may instead take a bare {@link deferred} schema, which leaves its presence to the later check.
 * A missing schema, a wrong `required`, a schema whose output doesn't fit, or a required key whose
 * type includes `undefined` but isn't `unknown` fails to compile
 */
export type OptionsShape<T> = {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- An object without `K` is `{}`, which `Pick<T, K>` takes when `K` is optional
  readonly [K in keyof T]-?: {} extends Pick<T, K>
    ? KeySchema<Exclude<T[K], undefined>> & { readonly [REQUIRED]?: never }
    : undefined extends T[K]
      ? unknown extends T[K]
        ? DeferredSchema & { readonly [REQUIRED]?: true }
        : never
      : KeySchema<T[K]> & ({ readonly [REQUIRED]: true } | { readonly [DEFERRED]: true })
}

/**
 * Marks the schema of a required key of an {@link optionsObject}, which fails when the key is left
 * out or `undefined`. Give the schema an error that reads well for `undefined` too, such as
 * `expectedError('an absolute path')`
 */
export function required<V>(
  schema: DeferredSchema<V>,
): RequiredSchema<Exclude<V, undefined>> & DeferredSchema<Exclude<V, undefined>>
export function required<V>(schema: ValueSchema<V>): RequiredSchema<Exclude<V, undefined>>
export function required(schema: z.ZodMiniType): RequiredSchema {
  const z = loadZod()
  // A new schema, so a schema shared with optional keys stays optional there. `z.nonoptional`
  // rejects an explicit `undefined` too, which a schema such as `deferred()` takes
  const copy: z.ZodMiniType = z.nonoptional(schema)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The brand is type-only; `isRequired` tells the schema by its `nonoptional` type at run time
  return copy as RequiredSchema
}

/**
 * Told by the schema's type rather than its identity, since `.check()` returns a copy that keeps
 * the type
 */
function isRequired(schema: z.ZodMiniType): boolean {
  return schema._zod.def.type === 'nonoptional'
}

/**
 * A schema whose output is trusted as a `V`, for a key that a later check validates, such as one
 * passed on to a tool that checks it. It checks only what `schema` checks, and without `schema`
 * takes any value. The named stand-in for `z.unknown()` and other schemas whose output doesn't
 * fit their key, which {@link OptionsShape} rejects, so each unchecked key is deliberate
 */
export function deferred<V = unknown>(
  schema: z.ZodMiniType = loadZod().unknown(),
): DeferredSchema<V> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The output type and the brand are trusted; the caller's later check validates the value
  return schema as DeferredSchema<V>
}

/**
 * The options object of type `T`: a {@link strictObject} with the keys of `shape`. A key is
 * optional unless its schema is {@link required}, and the output leaves out an optional key given
 * as `undefined`. `assertValid` returns the options as a `T`, trusting each key's schema for its
 * value's type, as deep as it checks.
 *
 * @example
 * ```ts
 * import * as z from 'zod/mini'
 * import { optionsObject } from '@gpahal/internal/node/options'
 * import { assertValid } from '@gpahal/internal/node/zod'
 *
 * type Options = { semi?: boolean | undefined }
 * const options: unknown = { semi: true }
 * const { semi } = assertValid(optionsObject<Options>({ semi: z.boolean() }), options, {
 *   prefix: '@scope/config',
 * })
 * ```
 */
export function optionsObject<T>(
  shape: OptionsShape<T>,
  options: ExpectedOptions = {},
): z.ZodMiniType<T, T> {
  const z = loadZod()
  const entries = Object.entries<z.ZodMiniType>(shape).map(
    ([key, schema]) => [key, isRequired(schema) ? schema : z.optional(schema)] as const,
  )
  const object = strictObject(Object.fromEntries(entries), { ...options, noun: 'option' })
  const schema: z.ZodMiniType = z.pipe(object, z.transform(withoutUndefined))
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `OptionsShape<T>` has a schema for each key of `T`, required where `T` requires it
  return schema as z.ZodMiniType<T, T>
}

function withoutUndefined(object: Record<string, unknown>): Record<string, unknown> {
  return {
    __proto__: null,
    ...Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)),
  }
}

/**
 * A boolean or a value that `schema` takes, such as an option that turns a feature on or
 * configures it with an object
 */
export function booleanOr<T>(
  schema: z.ZodMiniType<T, T>,
  { expected = 'a boolean or an object', hint }: ExpectedOptions = {},
): z.ZodMiniType<boolean | T, boolean | T> {
  const z = loadZod()
  return z.union([z.boolean(), schema], { error: expectedError(expected, hint) })
}

/**
 * A {@link ListOption}: an array of items that `item` takes, or a function of the defaults.
 * `items` names the items for the error, such as `globs` in "expected an array of globs or a
 * function of the defaults". {@link resolveListOption} checks what a function returns
 */
export function listOption<T>(
  item: z.ZodMiniType<T, T>,
  items: string,
): z.ZodMiniType<ListOption<T>, ListOption<T>> {
  const z = loadZod()
  return z.union(
    [
      z.array(item),
      typeCheck<ListTransform<T>>((value) => typeof value === 'function', {
        expected: 'a function',
      }),
    ],
    {
      error: expectedError(`an array of ${items} or a function of the defaults`),
    },
  )
}

export type ResolveListOptionContext = {
  prefix: string
  /**
   * The option's name, such as `tailwindcss.functions`
   */
  name: string
  /**
   * What an array option is, for the error. Default is `an array of strings`
   */
  expected?: string | undefined
}

/**
 * Resolve a {@link ListOption} of strings against its defaults, as a new array.
 *
 * @example
 * ```ts
 * import { resolveListOption } from '@gpahal/internal/node/options'
 *
 * const context = { prefix: '@scope/config', name: 'functions' }
 * resolveListOption(['tw'], ['cn', 'clsx'], context) // ['tw']
 * resolveListOption((defaults) => [...defaults, 'tw'], ['cn', 'clsx'], context) // ['cn', 'clsx', 'tw']
 * ```
 *
 * @throws TypeError if the option is neither an array nor a function, an array has an item that
 *   isn't a string, or a function returns anything else, with a message such as "@scope/config:
 *   `functions`: expected an array of strings or a function of the defaults, received `"tw"`" or
 *   "@scope/config: `functions`: expected the function to return an array of strings, received an
 *   array with `1`". A function that throws, or a class, gives "@scope/config: `functions`: the
 *   function threw: <reason>", with the error as its `cause`.
 */
export function resolveListOption(
  option: ListOption | undefined,
  defaults: ReadonlyArray<string>,
  context: ResolveListOptionContext,
): Array<string> {
  const { prefix, name, expected = 'an array of strings' } = context
  if (option === undefined) {
    return [...defaults]
  }
  const subjects = [formatNames([name])]
  // A JavaScript caller can pass any value
  const value: unknown = option
  if (typeof value !== 'function') {
    if (isArrayOf(value, isString)) {
      return [...value]
    }
    throw new TypeError(
      formatMessage(
        prefix,
        subjects,
        `expected ${expected} or a function of the defaults, received ${describeList(value)}`,
      ),
    )
  }
  let list: unknown
  try {
    list = Reflect.apply(value, undefined, [[...defaults]])
  } catch (error) {
    // A class, which can't be called without `new`, throws here too
    throw new TypeError(
      formatMessage(prefix, subjects, `the function threw: ${getErrorReason(error)}`),
      { cause: error },
    )
  }
  if (isArrayOf(list, isString)) {
    return [...list]
  }
  throw new TypeError(
    formatMessage(
      prefix,
      subjects,
      `expected the function to return ${expected}, received ${describeList(list)}`,
    ),
  )
}

function describeList(value: unknown): string {
  if (!Array.isArray(value)) {
    return describeValue(value)
  }
  // `findIndex` visits holes, as `isArrayOf` checks them
  const index = value.findIndex((item) => !isString(item))
  return index === -1 ? describeValue(value) : `an array with ${describeValue(value[index])}`
}

/**
 * The object form of an option that also takes a boolean, or `undefined` for a boolean or an option
 * left out
 */
export function resolveSubOptions<T extends object>(
  option: boolean | T | undefined,
): T | undefined {
  return typeof option === 'boolean' ? undefined : option
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isStringOrStrings(value: unknown): value is string | Array<string> {
  return isString(value) || isArrayOf(value, isString)
}
