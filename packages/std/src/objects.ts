export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

export function isObject(value: unknown): value is object {
  return value != null && typeof value === 'object'
}

export function omitUndefinedValues<T extends object>(o: T): T {
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

export function omitUndefinedValuesAndKeys<T extends object>(o: T, keys: Array<PropertyKey>): T {
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
