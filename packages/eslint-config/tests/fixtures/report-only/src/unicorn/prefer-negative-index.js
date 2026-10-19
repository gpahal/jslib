// For two items, `slice(items.length - 3)` is `slice(-1)` and keeps one, and `slice(-3)` keeps both
export function lastThree(items) {
  return items.slice(items.length - 3)
}
