/**
 * A symbol check. Contract: any value. Accepts primitive and boxed symbols; spoofed tags do not
 * count
 */

// eslint-disable-next-line @typescript-eslint/unbound-method -- only ever called with `.call`
const symbolValueOf = Symbol.prototype.valueOf

/**
 * Check if a value is a symbol, either a primitive or a boxed `Object(Symbol())` from any realm. It
 * uses the brand check of `Symbol.prototype.valueOf`, so an object that fakes a `Symbol.toStringTag`
 * isn't one, and a boxed symbol with a changed tag still is
 */
// eslint-disable-next-line @typescript-eslint/no-wrapper-object-types -- boxed symbols are accepted on purpose
export function isSymbol(value: unknown): value is symbol | Symbol {
  if (typeof value === 'symbol') {
    return true
  }
  if (typeof value !== 'object' || value === null) {
    return false
  }
  try {
    symbolValueOf.call(value)
    return true
  } catch {
    return false
  }
}
