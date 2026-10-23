import { builtinModules } from 'node:module'

import { ASTUtils } from '@typescript-eslint/utils'
import type { Rule } from 'eslint'
import type { Node } from 'estree'

import { isRecord } from '@gpahal/std/objects'

import { isNode, isTypeOnlyImport } from '@/internal/ast'
import { getDocsUrl } from '@/internal/utils'

/**
 * Without `node:`, such as `fs` and `fs/promises`. A browser port of one, such as the `buffer`
 * package, is reported too: import it under another name or give the file to the `server` scope
 */
const NODE_BUILTIN_MODULES: ReadonlySet<string> = new Set(
  builtinModules.filter((name) => !name.startsWith('node:')),
)

function isNodeImport(specifier: string): boolean {
  return specifier.startsWith('node:') || NODE_BUILTIN_MODULES.has(specifier)
}

/**
 * Of a literal or an expression of literals, as `` `fs` `` or `'f' + 's'`
 */
function getStaticString(node: unknown): string | undefined {
  return isNode(node) ? (ASTUtils.getStringIfConstant(node) ?? undefined) : undefined
}

/**
 * As in `'node:' + name` or `` `node:${name}` ``
 */
function getNodePrefix(node: Node | null | undefined): string | undefined {
  let left = node
  while (left?.type === 'BinaryExpression' && left.operator === '+') {
    left = left.left
  }
  let prefix: string | null | undefined
  if (left?.type === 'TemplateLiteral' && left.expressions.length > 0) {
    prefix = left.quasis[0]?.value.cooked
  } else if (left !== node) {
    prefix = getStaticString(left)
  }
  return prefix?.startsWith('node:') === true ? prefix : undefined
}

/**
 * With `isDynamic`, `import()`s of a literal or a `node:`-prefixed specifier
 */
function createRule(isDynamic: boolean): Rule.RuleModule {
  return {
    meta: {
      type: 'problem',
      docs: {
        description: `Disallow ${isDynamic ? 'dynamic imports' : 'imports'} of Node's built-in modules in browser code`,
        url: getDocsUrl('own-rules'),
      },
      schema: [
        {
          type: 'object',
          properties: { message: { type: 'string' } },
          additionalProperties: false,
        },
      ],
      messages: { nodeImport: "'{{specifier}}' is a Node built-in module. {{message}}" },
    },
    create(context) {
      const options: unknown = context.options[0]
      const message =
        isRecord(options) && typeof options['message'] === 'string' ? options['message'] : ''
      const check = (node: Node, source: Node | null | undefined) => {
        // Inline `type` specifiers still load the module under `verbatimModuleSyntax`, but other
        // rules report those
        if (isTypeOnlyImport(node)) {
          return
        }
        const specifier = getStaticString(source)
        if (specifier !== undefined && isNodeImport(specifier)) {
          context.report({ node, messageId: 'nodeImport', data: { specifier, message } })
        }
      }
      return isDynamic
        ? {
            // The module name, as other rules report an `import()` there
            ImportExpression: (node) => {
              const prefix = getNodePrefix(node.source)
              if (prefix === undefined) {
                check(node.source, node.source)
              } else {
                context.report({
                  node: node.source,
                  messageId: 'nodeImport',
                  data: { specifier: `${prefix}…`, message },
                })
              }
            },
          }
        : {
            ImportDeclaration: (node) => {
              check(node, node.source)
            },
            ExportNamedDeclaration: (node) => {
              check(node, node.source)
            },
            ExportAllDeclaration: (node) => {
              check(node, node.source)
            },
            TSImportEqualsDeclaration: (node: Node) => {
              const reference: unknown = Reflect.get(node, 'moduleReference')
              const expression: unknown =
                typeof reference === 'object' &&
                reference !== null &&
                Reflect.get(reference, 'type') === 'TSExternalModuleReference'
                  ? Reflect.get(reference, 'expression')
                  : undefined
              if (isNode<Node>(expression)) {
                check(node, expression)
              }
            },
          }
    },
  }
}

export const noNodeImports: Rule.RuleModule = createRule(false)

/**
 * `@gpahal/no-node-imports` doesn't see `import()`s
 */
export const noNodeDynamicImports: Rule.RuleModule = createRule(true)
