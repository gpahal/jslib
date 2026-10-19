import { readFile } from 'node:fs/promises'

import { type Item } from './types'

/** Lists the elements. */
export function list(nodes: NodeListOf<Element>): Array<Element> {
  let items = Array.from(nodes)
  return items
}

// The item's name
export function nameOf(item: Item): string {
  return item.name
}
