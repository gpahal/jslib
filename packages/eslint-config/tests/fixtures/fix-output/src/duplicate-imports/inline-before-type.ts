import { type Other } from './module'
import type { Shape } from './module'

/**
 * Pairs a shape with its id
 */
export function pair(shape: Shape, other: Other): [Shape, Other] {
  return [shape, other]
}
