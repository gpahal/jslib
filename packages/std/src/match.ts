import { isFunction } from '~/function'

export function match<T extends string | number = string, R = unknown>(
  value: T,
  lookup: Record<T, R | ((...args: unknown[]) => R)>,
  ...args: unknown[]
): R {
  if (value in lookup) {
    const returnValue = lookup[value]
    return (isFunction(returnValue) ? returnValue(...args) : returnValue) as R
  }

  const error = new Error(
    `Tried to match "${value}" but there is no handler defined. Valid values are: ${Object.keys(lookup)
      .map((key) => `"${key}"`)
      .join(', ')}.`,
  )
  if (Error.captureStackTrace) Error.captureStackTrace(error, match)
  throw error
}
