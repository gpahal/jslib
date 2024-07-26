export type Prettify<T> = {
  [K in keyof T]: T[K]
  // eslint-disable-next-line @typescript-eslint/ban-types
} & {}

export function isObject(value: unknown): value is Record<string | number | symbol, unknown> {
  return value != null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]'
}

export function omitUndefinedValues<T extends Record<string | number | symbol, unknown>>(o: T): T {
  if (!o) {
    return o
  }

  const clone = Object.assign({}, o)
  for (const key in clone) {
    if (clone[key] === undefined) {
      delete clone[key]
    }
  }
  return clone
}

export function omitUndefinedValuesAndKeys<T extends Record<string | number | symbol, unknown>>(
  o: T,
  keys: Array<string>,
): T {
  if (!o) {
    return o
  }

  const clone = Object.assign({}, o)
  for (const key in clone) {
    if (clone[key] === undefined || key in keys) {
      delete clone[key]
    }
  }
  return clone
}
