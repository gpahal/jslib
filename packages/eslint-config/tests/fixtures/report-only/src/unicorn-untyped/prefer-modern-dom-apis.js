// `insertBefore` with a `null` reference appends, and `next.before` throws
export function insert(parent, node, next) {
  parent.insertBefore(node, next)
}
