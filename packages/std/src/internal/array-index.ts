const MAX_ARRAY_INDEX = 2 ** 32 - 2

/**
 * Whether a string key is an array index in canonical form, such as `'5'` but not `'05'` or `'-0'`
 */
function isArrayIndex(key: string): boolean {
  const index = Number(key)
  // The integer check isn't redundant: `'1.5'` is in range and in canonical form
  return (
    Number.isSafeInteger(index) && index >= 0 && index <= MAX_ARRAY_INDEX && String(index) === key
  )
}

/**
 * The longest array whose length {@link copyArrayItems} sets before the items. Past it, setting
 * the length of an empty array allocates for all of it, which a long sparse array can't afford
 */
const MAX_PRESET_LENGTH = 1_000_000

/**
 * `source` copied by `Array.prototype.slice`, many times faster than {@link copyArrayItems}, or
 * `undefined` when `slice` wouldn't copy it the same way. `slice` makes an array of `source`'s
 * species, so it runs only for a plain array of this realm without an own `constructor`, and only up
 * to {@link MAX_PRESET_LENGTH}, as it takes time for the length
 */
export function sliceArray(source: ReadonlyArray<unknown>): Array<unknown> | undefined {
  return source.length <= MAX_PRESET_LENGTH &&
    Object.getPrototypeOf(source) === Array.prototype &&
    !Object.hasOwn(source, 'constructor')
    ? Array.prototype.slice.call(source)
    : undefined
}

/**
 * Replace each item of `target`, a copy that {@link sliceArray} made, with what `copyItem` gives
 * for it, writing only the items that change, so holes stay holes
 */
export function copyItemsInPlace(
  target: Array<unknown>,
  copyItem: (item: unknown) => unknown,
): void {
  for (let index = 0; index < target.length; index++) {
    const item = target[index]
    const copied = copyItem(item)
    if (copied !== item) {
      target[index] = copied
    }
  }
}

/**
 * The holes past twice the items so far after which {@link copyArrayItems} stops its index loop,
 * as V8 stores an array sparsely once a gap passes 1,024 items
 */
const MAX_EXTRA_HOLES = 1024

/**
 * Copy each own item of `source`, enumerable or not, into `target`, an empty array, through
 * `copyItem`, keeping holes and the length. A loop over indexes is several times faster than reading
 * the keys, so it runs while the holes stay within twice the items plus {@link MAX_EXTRA_HOLES}.
 * Past that, the rest come from the own keys, so a long sparse array takes time for its items rather
 * than its length
 */
export function copyArrayItems(
  source: ReadonlyArray<unknown>,
  target: Array<unknown>,
  copyItem: (item: unknown) => unknown,
): void {
  const { length } = source
  if (length <= MAX_PRESET_LENGTH) {
    target.length = length
  }
  let items = 0
  let holes = 0
  let index = 0
  for (; index < length; index++) {
    if (Object.hasOwn(source, index)) {
      target[index] = copyItem(source[index])
      items++
    } else if (++holes > 2 * items + MAX_EXTRA_HOLES) {
      break
    }
  }
  if (index < length) {
    // The loop stopped at a hole, so the items left are past it
    for (const key of Object.getOwnPropertyNames(source)) {
      if (!isArrayIndex(key)) {
        continue
      }
      const keyIndex = Number(key)
      if (keyIndex > index) {
        target[keyIndex] = copyItem(source[keyIndex])
      }
    }
  }
  target.length = length
}
