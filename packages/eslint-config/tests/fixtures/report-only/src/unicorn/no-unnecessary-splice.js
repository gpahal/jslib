// `.length = 0` doesn't notify a reactive array that `splice(0)` does, as in some reactive frameworks
export function clear(items) {
  items.splice(0)
}
