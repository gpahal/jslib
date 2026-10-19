import vm from 'node:vm'

import { isSymbol } from '@/symbols'

describe('isSymbol', () => {
  it('accepts primitive and boxed symbols, including from another realm', () => {
    // `unknown`, as type guards take: a guard on a value of its own type is a lint error
    const symbol: unknown = Symbol('s')
    expect(isSymbol(symbol)).toBe(true)
    expect(isSymbol(new Object(Symbol('s')))).toBe(true)
    expect(isSymbol(vm.runInNewContext('Object(Symbol("s"))'))).toBe(true)
    expect(isSymbol('s')).toBe(false)
  })

  it('checks the internal slot, not Symbol.toStringTag', () => {
    expect(isSymbol({ [Symbol.toStringTag]: 'Symbol' })).toBe(false)
    expect(isSymbol(Object.create(new Object(Symbol('s'))) as object)).toBe(false)
    const boxed = new Object(Symbol('s'))
    Object.defineProperty(boxed, Symbol.toStringTag, { value: 'Other' })
    expect(isSymbol(boxed)).toBe(true)
  })
})
