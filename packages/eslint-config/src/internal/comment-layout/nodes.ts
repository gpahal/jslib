import type { TSESLint, TSESTree } from '@typescript-eslint/utils'

import { isNode } from '@/internal/ast'
import { findFirstIndex } from '@/internal/search'

/**
 * A binary search, since a JSX element can have thousands of children, each with a comment. A hole,
 * as in `[, a]`, is skipped
 */
function childInListAt(children: Array<unknown>, offset: number): TSESTree.Node | undefined {
  let low = 0
  let high = children.length
  while (low < high) {
    const middle = (low + high) >>> 1
    let index = middle
    while (index < high && !isNode(children[index])) {
      index++
    }
    const child = children[index]
    if (!isNode(child) || child.range[0] > offset) {
      high = middle
    } else if (child.range[1] <= offset) {
      low = index + 1
    } else {
      return child
    }
  }
  return undefined
}

type NodeLookup = {
  /**
   * A binary search, since a file can have a comment before each of thousands of statements
   */
  countStatementsBefore: (offset: number) => number
  /**
   * From the top-level statement around it, since `getNodeByRangeIndex` walks every statement
   */
  deepestNodeAt: (offset: number) => TSESTree.Node | undefined
}

export function createNodeLookup(
  sourceCode: Readonly<TSESLint.SourceCode>,
  statements: Array<TSESTree.ProgramStatement>,
): NodeLookup {
  function countStatementsBefore(offset: number): number {
    return findFirstIndex(
      statements.length,
      (index) => (statements[index]?.range[0] ?? offset) >= offset,
    )
  }

  function childAt(node: TSESTree.Node, offset: number): TSESTree.Node | undefined {
    const keys = sourceCode.visitorKeys[node.type] ?? []
    for (const key of keys) {
      const value: unknown = Reflect.get(node, key)
      const child = Array.isArray(value) ? childInListAt(value, offset) : value
      if (isNode(child) && child.range[0] <= offset && offset < child.range[1]) {
        return child
      }
    }
    return undefined
  }

  function deepestNodeAt(offset: number): TSESTree.Node | undefined {
    let node: TSESTree.Node | undefined = statements[countStatementsBefore(offset + 1) - 1]
    if (node === undefined || offset >= node.range[1]) {
      return undefined
    }
    for (let child = childAt(node, offset); child !== undefined; child = childAt(node, offset)) {
      node = child
    }
    return node
  }

  return { countStatementsBefore, deepestNodeAt }
}
