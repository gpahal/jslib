import { isFunction } from '@/functions'

export function match<T extends string | number = string, R = unknown>(
  value: T,
  lookup: Record<T, R | ((...args: Array<unknown>) => R)>,
  ...args: Array<unknown>
): R {
  if (Object.hasOwn(lookup, value)) {
    const returnValue = lookup[value]
    return (isFunction(returnValue) ? returnValue(...args) : returnValue) as R
  }

  const error = new Error(
    `Tried to match "${value}" but there is no handler defined. Valid values are: ${Object.keys(
      lookup,
    )
      .map((key) => `"${key}"`)
      .join(', ')}.`,
  )
  // captureStackTrace is a V8-only API, so it is feature-detected before use
  const errorWithCaptureStackTrace = Error as {
    captureStackTrace?: (target: Error, constructor: unknown) => void
  }
  if (typeof errorWithCaptureStackTrace.captureStackTrace === 'function') {
    errorWithCaptureStackTrace.captureStackTrace(error, match)
  }
  throw error
}
