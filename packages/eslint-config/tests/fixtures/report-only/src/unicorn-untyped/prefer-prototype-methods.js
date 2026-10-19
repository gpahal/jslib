// A shadowed `Array`, such as Effect's `Array` module, has no `prototype`
import { Array } from 'effect'

export const toList = (args) => [].slice.call(args)
export const first = Array.head
