/**
 * Checks the options and callback arguments of std's own functions
 */

import { describeValue } from '@/internal/describe'
import { stdMessage } from '@/internal/message'

/**
 * Throw a `TypeError` unless `options` is an object, so `null` fails with the repo's error shape
 * rather than when it's destructured
 */
export function checkOptions(caller: string, options: unknown): void {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError(
      stdMessage([caller, '`options`'], `expected an object, received ${describeValue(options)}`),
    )
  }
}

export function checkFunction(caller: string, fn: unknown): void {
  if (typeof fn !== 'function') {
    throw new TypeError(
      stdMessage([caller, '`fn`'], `expected a function, received ${describeValue(fn)}`),
    )
  }
}
