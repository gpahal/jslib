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

/**
 * `value`, or a `TypeError` unless it's a number, before a range check that would otherwise report
 * a value of the wrong type as a `RangeError`. `expected` names what's accepted, such as
 * ``'a number or `undefined`'`` for an option. It returns rather than asserts, since most callers'
 * values are typed as numbers already
 */
export function checkNumber(
  caller: string,
  name: string,
  value: unknown,
  expected = 'a number',
): number {
  if (typeof value !== 'number') {
    throw new TypeError(
      stdMessage([caller, name], `expected ${expected}, received ${describeValue(value)}`),
    )
  }
  return value
}
