import { type Other } from './types'
import type { Shape } from './types'

/**
 * Pairs a shape with its id
 */
export function pair(shape: Shape, other: Other): [Shape, Other] {
  return [shape, other]
}
