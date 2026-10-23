import type { TSESTree } from '@typescript-eslint/utils'
import type { AST, Rule } from 'eslint'
import type * as ESTree from 'estree'

import { isObject, isRecord } from '@gpahal/std/objects'

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

/**
 * A node with the `parent` ESLint sets while it lints
 */
export function isRuleNode(value: unknown): value is Rule.Node {
  return isRecord(value) && typeof value['type'] === 'string' && 'parent' in value
}

export function isNodeOfType<T extends ESTree.Node['type']>(
  value: unknown,
  type: T,
): value is Extract<ESTree.Node, { type: T }> {
  return isRecord(value) && value['type'] === type
}

export function rangeOf(nodeOrToken: ESTree.Node | AST.Token): AST.Range {
  return nodeOrToken.range ?? [0, 0]
}

/**
 * The `range` of a value that may be a node, as a report's
 */
export function untypedRangeOf(value: unknown): [number, number] | undefined {
  const range: unknown = isRecord(value) ? value['range'] : undefined
  return Array.isArray(range) && typeof range[0] === 'number' && typeof range[1] === 'number'
    ? [range[0], range[1]]
    : undefined
}

/**
 * As in `process!` or `(process as any)`. typescript-eslint's, which ESTree's types leave out
 */
export const TYPE_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
])

/**
 * Computed only from a string literal or a template literal without expressions
 */
export function getPropertyName(node: ESTree.MemberExpression): string | undefined {
  const { property } = node
  if (!node.computed && property.type === 'Identifier') {
    return property.name
  }
  if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
    return property.quasis[0]?.value.cooked ?? undefined
  }
  return property.type === 'Literal' && typeof property.value === 'string'
    ? property.value
    : undefined
}

/**
 * `import type`, `export type`, or only inline `type` specifiers, as in `import { type A }`.
 * `importKind` and `exportKind` are TypeScript syntax, which the ESTree types lack
 */
export function isTypeOnlyImport(node: object): boolean {
  if (Reflect.get(node, 'importKind') === 'type' || Reflect.get(node, 'exportKind') === 'type') {
    return true
  }
  const specifiers: unknown = Reflect.get(node, 'specifiers')
  return (
    Array.isArray(specifiers) &&
    specifiers.length > 0 &&
    specifiers.every(
      (specifier: unknown) =>
        isRecord(specifier) &&
        (specifier['importKind'] === 'type' || specifier['exportKind'] === 'type'),
    )
  )
}
