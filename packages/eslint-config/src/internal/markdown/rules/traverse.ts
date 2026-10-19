import type { Nodes } from 'mdast'

/**
 * Calls `visit` on each node of `tree` in document order, `tree` first. Unlike `unist-util-visit`,
 * which looks up each node's index in its parent's children, so a parent of many children takes
 * time quadratic in their number, it computes no index. Without recursion, so deep nesting can't
 * overflow the stack
 */
export function forEachNode(tree: Nodes, visit: (node: Nodes) => void): void {
  const stack: Array<Nodes> = [tree]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    visit(node)
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]
        if (child !== undefined) {
          stack.push(child)
        }
      }
    }
  }
}
