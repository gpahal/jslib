/**
 * Number helpers. Contract: numbers from the developer's own code
 */

import { describeValue } from '@/internal/describe'
import { stdMessage } from '@/internal/message'

/**
 * `value` limited to the range from `min` to `max`, both included. A `NaN` value gives `NaN`. An
 * argument that isn't a number throws a `TypeError`, and a `NaN` bound or a `min` above `max` throws
 * a `RangeError`
 *
 * @example
 * ```ts
 * import { clamp } from '@gpahal/std/numbers'
 *
 * clamp(15, 0, 10) // 10
 * clamp(-5, 0, 10) // 0
 * ```
 */
export function clamp(value: number, min: number, max: number): number {
  // Inline checks rather than a loop over arrays, which would allocate on every call
  checkNumber('`value`', value)
  checkNumber('`min`', min)
  checkNumber('`max`', max)
  checkBound('`min`', min)
  checkBound('`max`', max)
  if (min > max) {
    throw new RangeError(
      stdMessage(
        ['`clamp`', '`min`'],
        `expected at most \`max\`, which is ${describeValue(max)}, received ${describeValue(min)}`,
      ),
    )
  }
  return Math.min(Math.max(value, min), max)
}

/**
 * Without it, a bigint throws a raw error and a string is coerced
 */
function checkNumber(name: string, input: unknown): void {
  if (typeof input !== 'number') {
    throw new TypeError(
      stdMessage(['`clamp`', name], `expected a number, received ${describeValue(input)}`),
    )
  }
}

function checkBound(name: string, bound: number): void {
  if (Number.isNaN(bound)) {
    throw new RangeError(
      stdMessage(['`clamp`', name], `expected a number, received ${describeValue(bound)}`),
    )
  }
}
