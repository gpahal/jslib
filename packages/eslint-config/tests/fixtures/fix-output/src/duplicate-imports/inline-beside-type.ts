import type { Shape } from './module'
import { type Other, shape } from './module'

/**
 * The circle with an id
 */
export const pair: [Shape, Other] = [shape, { id: 1 }]
