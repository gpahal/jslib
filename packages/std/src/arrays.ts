export function isArray(value: unknown): value is Array<unknown> {
  return Array.isArray(value)
}

export type NonEmptyArray<T> = [T, ...Array<T>]

export function pushToArray<T>(array?: Array<T>, ...items: Array<T>): Array<T> {
  if (array) {
    array.push(...items)
    return array
  } else {
    return [...items]
  }
}

export function dedupeArray<T>(array?: Array<T>): Array<T> {
  return [...new Set(array)]
}
