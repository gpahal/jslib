import type { TSESTree } from '@typescript-eslint/utils'

import { isObject } from '@gpahal/std/objects'

/**
 * Whether `value` is a node of a parsed file, as `NodeType`, which defaults to typescript-eslint's
 * nodes: an object with a `type` and the `range` ESLint gives every node, unlike the other objects
 * in an AST, such as a regex literal's `regex`
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the node type of its AST, typescript-eslint's or ESTree's
export function isNode<NodeType extends { type: string } = TSESTree.Node>(
  value: unknown,
): value is NodeType {
  return isObject(value) && 'type' in value && 'range' in value
}
