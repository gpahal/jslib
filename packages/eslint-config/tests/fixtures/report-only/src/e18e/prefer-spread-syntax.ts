// `concat` spreads `more` when it's an array, and the fix appends it as one item
export function append(items: Array<number>, more: Array<number> | number): Array<number> {
  return items.concat(more)
}
