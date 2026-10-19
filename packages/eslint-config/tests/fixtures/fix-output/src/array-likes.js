/**
 * The last of `list`, an array-like that may have no `at`
 */
export function last(list) {
  return list[list.length - 1]
}

/**
 * The items of `list`, an array-like that may not be iterable
 */
export function items(list) {
  return Array.from(list)
}
