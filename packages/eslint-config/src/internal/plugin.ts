import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

import { formatNames } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import { getPropertyName, isNode, TYPE_WRAPPER_TYPES } from '@/internal/ast'
import { commentLayout } from '@/internal/comment-layout'
import { getCoreRule } from '@/internal/core-rules'
import { nextjsServerComponent } from '@/internal/nextjs-server-component'
import { noBidiCharacters } from '@/internal/no-bidi-characters'
import { noInlineTypeOnlyExport } from '@/internal/no-inline-type-only-export'
import { noJsSpecifierForTs } from '@/internal/no-js-specifier-for-ts'
import { noNodeDynamicImports, noNodeImports } from '@/internal/no-node-imports'
import { noUnstrippableSyntax } from '@/internal/no-unstrippable-syntax'
import { PACKAGE_META } from '@/internal/package-meta'
import { formatErrorMessage, getDocsUrl, withReport } from '@/internal/utils'

/**
 * A copy under another name, so the guards don't share options with a `no-restricted-*` rule of
 * yours, which a later config would replace
 */
function aliasCoreRule(name: string): Rule.RuleModule {
  const rule = getCoreRule(name)
  if (!rule) {
    throw new Error(formatErrorMessage([formatNames([name])], "isn't a core rule that ESLint has"))
  }
  return {
    ...rule,
    meta: { ...rule.meta, docs: { ...rule.meta?.docs, url: getDocsUrl('own-rules') } },
  }
}

type JsonSchema = Exclude<NonNullable<Rule.RuleMetaData['schema']>, false | Array<unknown>>

/**
 * Its `{ name, message }` entries also take `allowProperties`
 */
const RESTRICTED_GLOBALS_SCHEMA: JsonSchema = {
  type: 'array',
  items: {
    oneOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          message: { type: 'string' },
          allowProperties: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        required: ['name'],
        additionalProperties: false,
      },
    ],
  },
  uniqueItems: true,
}

const ALIAS_GLOBALS_SCHEMA: Rule.RuleMetaData['schema'] = {
  anyOf: [
    RESTRICTED_GLOBALS_SCHEMA,
    {
      type: 'array',
      items: [
        {
          type: 'object',
          properties: {
            globals: RESTRICTED_GLOBALS_SCHEMA,
            checkGlobalObject: { type: 'boolean' },
            globalObjects: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          },
          required: ['globals'],
          additionalProperties: false,
        },
      ],
      additionalItems: false,
    },
  ],
}

function withoutTypeWrappers(node: ESTree.Node): ESTree.Node {
  let current = node
  while (TYPE_WRAPPER_TYPES.has(current.type)) {
    const expression: unknown = Reflect.get(current, 'expression')
    if (!isNode<ESTree.Node>(expression)) {
      break
    }
    current = expression
  }
  return current
}

/**
 * Through type assertions and optional chains, as in `typeof (globalThis as any).Buffer`. `typeof`
 * of an undeclared global doesn't read it, so the guards allow it
 */
function isTypeofOperand(node: unknown): boolean {
  if (!isNode<Rule.Node>(node)) {
    return false
  }
  let parent: Rule.Node | null = node.parent
  // `no-restricted-globals` with `checkGlobalObject` reports the property of `globalThis.process`
  if (
    parent?.type === 'MemberExpression' &&
    (!parent.computed ||
      parent.property.type === 'Literal' ||
      (parent.property.type === 'TemplateLiteral' && parent.property.expressions.length === 0)) &&
    parent.property === (node as ESTree.Node)
  ) {
    parent = parent.parent
  }
  while (
    parent !== null &&
    (TYPE_WRAPPER_TYPES.has(parent.type) || parent.type === 'ChainExpression')
  ) {
    parent = parent.parent
  }
  return parent?.type === 'UnaryExpression' && parent.operator === 'typeof'
}

function allowingTypeof(rule: Rule.RuleModule): Rule.RuleModule {
  return {
    ...rule,
    create: (context) =>
      rule.create(
        withReport(context, (descriptor) => {
          if (!isTypeofOperand('node' in descriptor ? descriptor.node : undefined)) {
            context.report(descriptor)
          }
        }),
      ),
  }
}

function getPatternPropertyName(property: ESTree.Property): string | undefined {
  const { key } = property
  if (!property.computed && key.type === 'Identifier') {
    return key.name
  }
  return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined
}

/**
 * `undefined` for a parameter's pattern
 */
function getDestructuredObject(
  node: ESTree.ObjectPattern & Rule.NodeParentExtension,
): ESTree.Node | undefined {
  const { parent } = node
  if (parent.type === 'VariableDeclarator') {
    return parent.init ?? undefined
  }
  return parent.type === 'AssignmentExpression' || parent.type === 'AssignmentPattern'
    ? parent.right
    : undefined
}

type RestrictedProperty = {
  message: string | undefined
  allowProperties: ReadonlySet<string> | undefined
}

/**
 * As in `const { argv } = node` or `({ argv } = node)`
 */
function getDestructuringPattern(
  node: ESTree.Node,
  parent: Rule.Node,
): ESTree.ObjectPattern | undefined {
  if (
    parent.type === 'VariableDeclarator' &&
    parent.init === node &&
    parent.id.type === 'ObjectPattern'
  ) {
    return parent.id
  }
  return parent.type === 'AssignmentExpression' &&
    parent.right === node &&
    parent.left.type === 'ObjectPattern'
    ? parent.left
    : undefined
}

/**
 * A read of an allowed property, as in `globalThis.process?.env`, or a destructuring of only those,
 * as in `const { env } = globalThis.process`. Any other use, as in `if (globalThis.process)`,
 * passes too; a computed property or a rest element doesn't
 */
function isAllowedUse(node: Rule.Node, allowProperties: ReadonlySet<string>): boolean {
  let child: Rule.Node = node
  let parent: Rule.Node | null = node.parent
  while (parent !== null && TYPE_WRAPPER_TYPES.has(parent.type)) {
    child = parent
    parent = parent.parent
  }
  if (parent === null) {
    return true
  }
  const pattern = getDestructuringPattern(child, parent)
  if (pattern !== undefined) {
    return pattern.properties.every(
      (property) =>
        property.type === 'Property' &&
        !property.computed &&
        property.key.type === 'Identifier' &&
        allowProperties.has(property.key.name),
    )
  }
  if (parent.type !== 'MemberExpression' || parent.object !== (child as ESTree.Node)) {
    return true
  }
  const name = getPropertyName(parent)
  return name !== undefined && allowProperties.has(name)
}

function isImportMeta(node: ESTree.Node): boolean {
  return (
    node.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta'
  )
}

/**
 * `no-restricted-properties` by member access or destructuring. An entry for `globalThis` covers
 * each of `globalObjects`, and only a global object counts, not a local named `window`
 */
function globalPropertiesRule(globalObjects: ReadonlyArray<string>): Rule.RuleModule {
  const objectKey = (name: string) => (globalObjects.includes(name) ? 'globalThis' : name)
  return {
    meta: {
      type: 'suggestion',
      docs: {
        description: 'Disallow certain properties on global objects',
        url: getDocsUrl('own-rules'),
      },
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            object: { type: 'string' },
            property: { type: 'string' },
            message: { type: 'string' },
            allowProperties: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          },
          required: ['object', 'property'],
          additionalProperties: false,
        },
        uniqueItems: true,
      },
      messages: {
        restrictedObjectProperty:
          "'{{objectName}}.{{propertyName}}' is restricted from being used.{{message}}",
      },
    },
    create(context) {
      const restricted = new Map<string, Map<string, RestrictedProperty>>()
      for (const option of context.options as Array<unknown>) {
        if (!isRecord(option)) {
          continue
        }
        const { object, property, message, allowProperties } = option
        if (typeof object !== 'string' || typeof property !== 'string') {
          continue
        }
        const key = objectKey(object)
        const properties = restricted.get(key) ?? new Map<string, RestrictedProperty>()
        properties.set(property, {
          message: typeof message === 'string' ? message : undefined,
          allowProperties: Array.isArray(allowProperties)
            ? new Set(allowProperties.map(String))
            : undefined,
        })
        restricted.set(key, properties)
      }
      // `member` reads the property; a destructured property has none and passes the checks
      const check = (
        objectNode: ESTree.Node,
        propertyName: string,
        node: ESTree.Node,
        member?: Rule.Node,
      ) => {
        const object = withoutTypeWrappers(objectNode)
        const objectName =
          object.type === 'Identifier'
            ? object.name
            : isImportMeta(object)
              ? 'import.meta'
              : undefined
        if (objectName === undefined) {
          return
        }
        const entry = restricted.get(objectKey(objectName))?.get(propertyName)
        if (entry === undefined) {
          return
        }
        if (object.type === 'Identifier') {
          const variable = context.sourceCode
            .getScope(object)
            .references.find((reference) => reference.identifier === object)?.resolved
          // A declared variable, not a global
          if (variable && variable.defs.length > 0) {
            return
          }
        }
        if (
          entry.allowProperties &&
          (member === undefined || isAllowedUse(member, entry.allowProperties))
        ) {
          return
        }
        context.report({
          node,
          messageId: 'restrictedObjectProperty',
          data: {
            objectName,
            propertyName,
            message: entry.message === undefined ? '' : ` ${entry.message}`,
          },
        })
      }
      return {
        MemberExpression(node) {
          const name = getPropertyName(node)
          if (name !== undefined) {
            check(node.object, name, node, node)
          }
        },
        ObjectPattern(node) {
          const object = getDestructuredObject(node)
          if (object === undefined) {
            return
          }
          for (const property of node.properties) {
            const name = property.type === 'Property' ? getPatternPropertyName(property) : undefined
            if (name !== undefined) {
              check(object, name, property)
            }
          }
        },
      }
    },
  }
}

/**
 * With `allowProperties`, a global passes as the object of one of those properties, as in
 * `process.env.NODE_ENV`, and other uses are reported, such as `process.argv`
 */
function aliasGlobalsRule(): Rule.RuleModule {
  const rule = aliasCoreRule('no-restricted-globals')
  return {
    ...rule,
    meta: {
      ...rule.meta,
      schema: ALIAS_GLOBALS_SCHEMA,
    },
    create: (context) => {
      const allowed = new Map<string, ReadonlySet<string>>()
      const strip = (entries: Array<unknown>) =>
        entries.map((entry) => {
          if (!isRecord(entry) || !Array.isArray(entry['allowProperties'])) {
            return entry
          }
          const { allowProperties, ...rest } = entry
          allowed.set(String(rest['name']), new Set(allowProperties.map(String)))
          return rest
        })
      const [first] = context.options as Array<unknown>
      const options =
        isRecord(first) && Array.isArray(first['globals'])
          ? [{ ...first, globals: strip(first['globals']) }]
          : strip(context.options as Array<unknown>)
      const isAllowed = (node: unknown): boolean => {
        if (!isNode<ESTree.Node>(node)) {
          return false
        }
        const ancestors = context.sourceCode.getAncestors(node)
        let parent = ancestors.pop()
        // With `checkGlobalObject`, the rule reports the property of `globalThis.process`
        let global: ESTree.Node = node
        let name = node.type === 'Identifier' ? node.name : undefined
        if (
          parent?.type === 'MemberExpression' &&
          parent.property === node &&
          !(parent.computed && node.type === 'Identifier')
        ) {
          global = parent
          name = getPropertyName(parent)
          parent = ancestors.pop()
        }
        const properties = name === undefined ? undefined : allowed.get(name)
        while (parent !== undefined && TYPE_WRAPPER_TYPES.has(parent.type)) {
          global = parent
          parent = ancestors.pop()
        }
        if (properties === undefined || parent === undefined) {
          return false
        }
        const property =
          parent.type === 'MemberExpression' && parent.object === global
            ? getPropertyName(parent)
            : undefined
        return property !== undefined && properties.has(property)
      }
      const reporting = withReport(context, (descriptor) => {
        if (!isAllowed('node' in descriptor ? descriptor.node : undefined)) {
          context.report(descriptor)
        }
      })
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `Object.create` returns `any`, and the object is the context with the core rule's options
      const withOptions = Object.create(reporting, {
        options: { value: options, configurable: true },
      }) as Rule.RuleContext
      return rule.create(withOptions)
    },
  }
}

/**
 * ESLint's rule type rejects typescript-eslint's context type, though it's the same object
 */
function asEslintRule(rule: object): Rule.RuleModule {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ESLint passes this rule the context it types differently
  return rule as Rule.RuleModule
}

type GpahalRuleName =
  | 'comment-layout'
  | 'nextjs-server-component'
  | 'no-bidi-characters'
  | 'no-inline-type-only-export'
  | 'no-js-specifier-for-ts'
  | 'no-unstrippable-syntax'
  | 'no-node-globals'
  | 'no-node-global-properties'
  | 'no-node-imports'
  | 'no-node-dynamic-imports'
  | 'no-esm-in-commonjs'
  | 'no-browser-globals'
  | 'no-browser-global-properties'

/**
 * One object, since several configs register it, and ESLint refuses another under the same name
 */
export const GPAHAL_PLUGIN: {
  meta: { name: string; version: string }
  rules: Record<GpahalRuleName, Rule.RuleModule>
} = {
  meta: PACKAGE_META,
  rules: {
    'comment-layout': asEslintRule(commentLayout),
    'nextjs-server-component': nextjsServerComponent,
    'no-bidi-characters': noBidiCharacters,
    'no-inline-type-only-export': asEslintRule(noInlineTypeOnlyExport),
    'no-js-specifier-for-ts': asEslintRule(noJsSpecifierForTs),
    'no-unstrippable-syntax': asEslintRule(noUnstrippableSyntax),
    'no-node-globals': allowingTypeof(aliasGlobalsRule()),
    // Browser code reads globals from `window` and `self` too
    'no-node-global-properties': allowingTypeof(
      globalPropertiesRule(['globalThis', 'window', 'self']),
    ),
    'no-node-imports': noNodeImports,
    'no-node-dynamic-imports': noNodeDynamicImports,
    'no-esm-in-commonjs': aliasCoreRule('no-restricted-syntax'),
    'no-browser-globals': allowingTypeof(aliasCoreRule('no-restricted-globals')),
    'no-browser-global-properties': allowingTypeof(globalPropertiesRule(['globalThis'])),
  },
}
