import vm from 'node:vm'

import {
  clonePlain,
  isObject,
  isPlainObject,
  isRecord,
  omit,
  omitUndefinedValues,
  omitUndefinedValuesAndKeys,
  pick,
} from '@/objects'
import type { NonFunctionObject, PlainClone, RecordObject } from '@/objects'

import { trackArrayReads } from './array-reads'

/**
 * An interface has no implicit index signature, unlike a type alias, so it's the case to cover
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- As above
interface Options {
  a?: number
  b?: string
}

describe('isObject', () => {
  it('accepts non-null objects, arrays included, but not functions', () => {
    // `unknown`, as type guards take: a guard on a value of its own type is a lint error
    const values: Array<unknown> = [{}, [], null, () => 1]
    expect(values.map((value) => isObject(value))).toEqual([true, true, false, false])
    const value: unknown = {}
    if (isObject(value)) {
      expectTypeOf(value).toEqualTypeOf<NonFunctionObject>()
    }
  })
})

describe('isRecord', () => {
  it('accepts objects other than arrays and functions, and a revoked proxy without throwing', () => {
    const values: Array<unknown> = [{}, new Date(), [], () => 1, null]
    expect(values.map((value) => isRecord(value))).toEqual([true, true, false, false, false])
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(isRecord(proxy)).toBe(false)
  })

  it('narrows a union to its object type, keeping interface and class types', () => {
    const options = {} as Options | boolean
    if (isRecord(options)) {
      expectTypeOf(options).toEqualTypeOf<Options & RecordObject>()
    }
    const object = {} as object | string
    if (isRecord(object)) {
      expectTypeOf(object).toEqualTypeOf<Record<PropertyKey, unknown>>()
    } else {
      expectTypeOf(object).toEqualTypeOf<object | string>()
    }
    const value: unknown = {}
    if (isRecord(value)) {
      expectTypeOf(value).toExtend<Options>()
    }
  })
})

describe('isPlainObject', () => {
  it.each<[string, unknown]>([
    ['an object literal', { a: 1 }],
    ['a plain object from another realm', vm.runInNewContext('({ a: 1 })')],
    ['an error-like object', { name: 'V', message: 'b' }],
  ])('accepts %s', (_, value) => {
    expect(isPlainObject(value)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['an array', []],
    ['a class instance', new Map()],
    ['a class instance from another realm', vm.runInNewContext('new (class A {})()')],
    ['a function', () => 1],
    ['a primitive', 'a'],
    ['null', null],
    ['arguments from another realm', vm.runInNewContext('(function () { return arguments })()')],
    ['a child of a null-prototype object', Object.create(Object.create(null) as object)],
    [
      'a child of a fake Object.prototype',
      Object.create(Object.assign(Object.create(null) as object, { constructor: Object })),
    ],
    ['Object.prototype', Object.prototype],
    [
      'a revoked proxy',
      (() => {
        const { proxy, revoke } = Proxy.revocable({}, {})
        revoke()
        return proxy
      })(),
    ],
  ])('rejects %s', (_, value) => {
    expect(isPlainObject(value)).toBe(false)
  })

  it('rejects a module namespace', async () => {
    const namespace: unknown = await import('@/hash')
    expect(isPlainObject(namespace)).toBe(false)
  })

  it('narrows a union to the members that can be plain objects', () => {
    const options = {} as Options | string
    if (isPlainObject(options)) {
      expectTypeOf(options).toEqualTypeOf<Options & RecordObject>()
    } else {
      // An interface can be a class instance's type too
      expectTypeOf(options).toEqualTypeOf<Options | string>()
    }
    expectTypeOf(isPlainObject<TypeError | string>).guards.toEqualTypeOf<TypeError & RecordObject>()
  })

  it('drops members that no plain object can be, such as maps, arrays and private classes', () => {
    class WithPrivateField {
      readonly #a = 1
      getA(): number {
        return this.#a
      }
    }
    expectTypeOf(
      isPlainObject<
        | Options
        | Map<string, number>
        | Date
        | Uint8Array
        | Array<string>
        | (() => void)
        | WithPrivateField
      >,
    ).guards.toEqualTypeOf<Options & RecordObject>()
  })
})

describe('omitUndefinedValues', () => {
  it('returns a copy without undefined values, including under symbol keys', () => {
    const symbol = Symbol('s')
    const o = { a: 1, b: undefined, [symbol]: undefined }
    expect(Reflect.ownKeys(omitUndefinedValues(o))).toEqual(['a'])
    expect(Reflect.ownKeys(o)).toEqual(['a', 'b', symbol])
    const input: { a: undefined; b: number; c?: string } = { a: undefined, b: 1, c: 'c' }
    expectTypeOf(omitUndefinedValues(input)).toEqualTypeOf<{ a?: never; b: number; c?: string }>()
  })

  it('keeps an own __proto__ key as a property and a null prototype', () => {
    const o = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<string, unknown>
    const result = omitUndefinedValues(o)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.keys(result)).toEqual(['__proto__', 'a'])
    const dictionary = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 })
    expect(Object.getPrototypeOf(omitUndefinedValues(dictionary))).toBeNull()
  })

  it('rejects objects that are not plain', () => {
    class WithPublicField {
      readonly a = 1
    }
    // @ts-expect-error - A date isn't a plain object
    expect(() => omitUndefinedValues(new Date())).toThrow(
      new TypeError(
        "@gpahal/std: `omitUndefinedValues`: `o`: expected a plain object, received an instance of `Date`. A plain object's prototype is `Object.prototype` or `null`, and its tag is `[object Object]`",
      ),
    )
    // Its type can't be told apart from an object literal's
    expect(() => omitUndefinedValues(new WithPublicField())).toThrow(TypeError)
  })
})

describe('omitUndefinedValuesAndKeys', () => {
  it('removes string, number and symbol keys', () => {
    const symbol = Symbol('s')
    const o = { a: 1, b: 2, 1: 'one', [symbol]: 's' }
    expect(Reflect.ownKeys(omitUndefinedValuesAndKeys(o, ['a', 1, symbol]))).toEqual(['b'])
    // @ts-expect-error - `nme` isn't a key
    omitUndefinedValuesAndKeys({ name: 'a' }, ['nme'])
  })

  it('maps each member of a union, removing a key of only some members', () => {
    type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; side: number }
    const shape = { kind: 'circle', radius: 1 } as Shape
    const result = omitUndefinedValuesAndKeys(shape, ['radius'])
    expect(result).toEqual({ kind: 'circle' })
    expectTypeOf(result).toEqualTypeOf<{ kind: 'circle' } | { kind: 'square'; side: number }>()
  })

  it('throws a TypeError for keys that are not an array', () => {
    // @ts-expect-error - Not an array, as a JavaScript caller can pass
    expect(() => omitUndefinedValuesAndKeys({ a: 1 }, 'a')).toThrow(
      new TypeError(
        '@gpahal/std: `omitUndefinedValuesAndKeys`: `keys`: expected an array, received `"a"`',
      ),
    )
  })
})

function fn(): number {
  return 1
}

describe('clonePlain', () => {
  it('copies nested arrays and plain objects, and keeps other values as they are', () => {
    const date = new Date(0)
    const original = { a: [1, { b: [2] }], c: { d: 'e' }, fn, date }
    const copy = clonePlain(original)
    expect(copy).toEqual(original)
    expect(copy.a[1]).not.toBe(original.a[1])
    copy.c.d = 'changed'
    expect(original.c.d).toBe('e')
    expect(copy.fn).toBe(fn)
    expect(copy.date).toBe(date)
  })

  it('keeps the holes and length of a sparse array, and copies only its set items', () => {
    const sparse: Array<number> = []
    sparse[50_000_000] = 1
    const { proxy, reads } = trackArrayReads(sparse)
    const copy = clonePlain(proxy)
    // The index loop stops after about a thousand holes, where a loop over every index would check
    // 50 million
    expect(reads.has).toBeLessThan(2000)
    expect(copy).toHaveLength(50_000_001)
    expect(Object.keys(copy)).toEqual(['50000000'])
  })

  it("drops an array's keys that aren't indexes and its own constructor", () => {
    const list = Object.assign([1, 2], { extra: 'x', '05': 'x', '4294967295': 'x' })
    expect(Object.keys(clonePlain(list))).toEqual(['0', '1'])
    class Species extends Array<number> {}
    const species = Object.defineProperty([1], 'constructor', { value: Species })
    expect(Object.getPrototypeOf(clonePlain(species))).toBe(Array.prototype)
  })

  it('types the clone without array keys it drops, keeping tuples and readonly arrays', () => {
    const list = Object.assign([1], { extra: 'x' })
    expectTypeOf(clonePlain(list)).toEqualTypeOf<Array<number>>()
    expectTypeOf<PlainClone<readonly [number, string?]>>().toEqualTypeOf<
      readonly [number, string?]
    >()
    expectTypeOf(clonePlain({ list, fn })).toEqualTypeOf<{ list: Array<number>; fn: typeof fn }>()
    expectTypeOf<PlainClone<unknown>>().toBeUnknown()
  })

  it('copies an own __proto__ key as a property, and symbol keys and null prototypes', () => {
    const symbol = Symbol('s')
    const parsed = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>
    const copy = clonePlain(parsed)
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
    expect(Object.keys(copy)).toEqual(['__proto__'])
    const dictionary = Object.assign(Object.create(null) as object, { [symbol]: [1] })
    const dictionaryCopy = clonePlain(dictionary)
    expect(Object.getPrototypeOf(dictionaryCopy)).toBeNull()
    expect(Reflect.get(dictionaryCopy, symbol)).toEqual([1])
    expect(Reflect.get(dictionaryCopy, symbol)).not.toBe(Reflect.get(dictionary, symbol))
  })

  it('copies keys in their own order by assignment, skipping non-enumerable symbols', () => {
    const symbol = Symbol('s')
    const hidden = Symbol('hidden')
    const source: Record<PropertyKey, unknown> = { b: 1, [symbol]: 2, 1: 3, a: undefined }
    Object.defineProperty(source, hidden, { value: 4, enumerable: false })
    const defineProperty = vi.spyOn(Object, 'defineProperty')
    let copies: Array<object>
    let defines: number
    try {
      copies = [clonePlain(source), omit(source, []), pick(source, ['b', symbol, 1, 'a', hidden])]
      defines = defineProperty.mock.calls.length
    } finally {
      defineProperty.mockRestore()
    }
    expect(defines).toBe(0)
    for (const copy of copies) {
      expect(Reflect.ownKeys(copy)).toEqual(['1', 'b', 'a', symbol])
    }
  })

  it('copies a plain object from another realm with this realm’s prototype', () => {
    const copy = clonePlain(vm.runInNewContext('({ a: [1] })') as { a: Array<number> })
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
    expect(copy.a).toBeInstanceOf(Array)
  })

  it('copies a shared or cyclic object once', () => {
    const shared = { a: 1 }
    const cyclic: { shared: object; again: object; self?: object } = { shared, again: shared }
    cyclic.self = cyclic
    const copy = clonePlain(cyclic)
    expect(copy.self).toBe(copy)
    expect(copy.shared).toBe(copy.again)
    expect(copy.shared).not.toBe(shared)
  })

  it('copies a value nested deeper than the call stack allows', () => {
    let nested: Array<unknown> = []
    for (let i = 0; i < 100_000; i++) {
      nested = [nested]
    }
    let copy = clonePlain(nested)
    for (let i = 0; i < 100_000; i++) {
      copy = copy[0] as Array<unknown>
    }
    expect(copy).toEqual([])
  })
})

describe('pick', () => {
  it('copies the own enumerable properties named in keys, string or symbol keyed', () => {
    const symbol = Symbol('s')
    const source = { a: 1, b: 2, c: 3, [symbol]: 4 }
    const picked = pick(source, ['a', 'c', symbol])
    expectTypeOf(picked).toEqualTypeOf<{ a: number; c: number; [symbol]: number }>()
    expect(picked).toEqual({ a: 1, c: 3, [symbol]: 4 })
    const record: Record<string, number> = { x: 1 }
    expectTypeOf(pick(record, ['x'])).toEqualTypeOf<{ x?: number }>()
  })

  it('types as Pick in generic code', () => {
    function pickKey<T extends object, K extends keyof T>(o: T, key: K): Pick<T, K> {
      return pick(o, [key])
    }
    expect(pickKey({ a: 1, b: 2 }, 'b')).toEqual({ b: 2 })
  })

  it('leaves out inherited, non-enumerable and missing keys', () => {
    const source = Object.create({ inherited: 1 }) as {
      inherited?: number
      hidden?: number
      a?: number
    }
    Object.defineProperty(source, 'hidden', { value: 2, enumerable: false })
    expect(pick(source, ['inherited', 'hidden', 'a'])).toEqual({})
  })

  it('throws for a value that is not an object', () => {
    // @ts-expect-error - Not an object, as a JavaScript caller can pass
    expect(() => pick(null, [])).toThrow(
      new TypeError('@gpahal/std: `pick`: `o`: expected an object, received `null`'),
    )
  })
})

describe('omit', () => {
  it('copies the own enumerable properties except those named in keys', () => {
    const symbol = Symbol('s')
    const source = { a: 1, b: 2, c: 3, [symbol]: 4 }
    const omitted = omit(source, ['b'])
    expectTypeOf(omitted).toEqualTypeOf<{ a: number; c: number; [symbol]: number }>()
    expect(omitted).toEqual({ a: 1, c: 3, [symbol]: 4 })
    expect(omit(source, [symbol, 'a'])).toEqual({ b: 2, c: 3 })
    expect(omit({ 1: 'a', 2: 'b' }, [1])).toEqual({ 2: 'b' })
  })

  it('keeps the members of a union and takes a key of any member', () => {
    type Shape =
      { kind: 'circle'; radius: number; id: string } | { kind: 'square'; side: number; id: string }
    const shape = { kind: 'circle', radius: 1, id: 'c' } as Shape
    expectTypeOf(omit(shape, ['id'])).toEqualTypeOf<
      { kind: 'circle'; radius: number } | { kind: 'square'; side: number }
    >()
    // @ts-expect-error - Not a key of any member
    omit(shape, ['nope'])
  })

  it('types as Omit in generic code', () => {
    function dropKey<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
      return omit(o, [key])
    }
    expect(dropKey({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 })
  })

  it('copies a __proto__ key as a property, without changing the prototype', () => {
    const source = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>
    const omitted: object = omit(source, ['a'])
    expect(Object.getPrototypeOf(omitted)).toBe(Object.prototype)
    expect(Object.hasOwn(omitted, '__proto__')).toBe(true)
  })

  it('throws for keys that are not an array', () => {
    // @ts-expect-error - Not an array, as a JavaScript caller can pass
    expect(() => omit({ a: 1 }, undefined)).toThrow(
      new TypeError('@gpahal/std: `omit`: `keys`: expected an array, received `undefined`'),
    )
  })
})
