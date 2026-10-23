/**
 * The `@gpahal/no-unstrippable-syntax` rule. Node throws a `SyntaxError` for enums, namespaces with
 * values, named `module` declarations, parameter properties, import-equals and export assignments,
 * and leaves decorators and `accessor` fields to V8, which can't parse them yet. Ambient
 * declarations, `abstract accessor` fields and type-only namespaces are erased. No fix, since
 * removal changes what the code does
 */

import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import type { TSESLint, TSESTree } from '@typescript-eslint/utils'

import { getDocsUrl } from '@/internal/utils'

/**
 * Erased with their members, decorators and accessors included
 */
function isAmbient(node: TSESTree.Node): boolean {
  let ancestor: TSESTree.Node | undefined = node.parent
  while (ancestor) {
    if (
      (ancestor.type === AST_NODE_TYPES.ClassDeclaration ||
        ancestor.type === AST_NODE_TYPES.TSModuleDeclaration) &&
      ancestor.declare
    ) {
      return true
    }
    ancestor = ancestor.parent
  }
  return false
}

/**
 * Type aliases, interfaces and type-only namespaces. Node runs any other statement, even
 * `namespace N { declare const x: number }`
 */
function isTypeOnlyNamespace(node: TSESTree.TSModuleDeclaration): boolean {
  return (node.body?.body ?? []).every((statement) => {
    const declaration =
      statement.type === AST_NODE_TYPES.ExportNamedDeclaration && statement.source === null
        ? statement.declaration
        : statement
    return declaration?.type === AST_NODE_TYPES.TSModuleDeclaration
      ? isTypeOnlyNamespace(declaration)
      : declaration?.type === AST_NODE_TYPES.TSInterfaceDeclaration ||
          declaration?.type === AST_NODE_TYPES.TSTypeAliasDeclaration
  })
}

/**
 * Such a namespace is reported in its place
 */
function isInRuntimeNamespace(node: TSESTree.TSModuleDeclaration): boolean {
  let ancestor: TSESTree.Node | undefined = node.parent
  while (ancestor) {
    if (ancestor.type === AST_NODE_TYPES.TSModuleDeclaration && !isTypeOnlyNamespace(ancestor)) {
      return true
    }
    ancestor = ancestor.parent
  }
  return false
}

export const noUnstrippableSyntax: TSESLint.RuleModule<
  | 'accessor'
  | 'decorator'
  | 'enum'
  | 'namespace'
  | 'moduleKeyword'
  | 'useNamespace'
  | 'parameterProperty'
  | 'importEquals'
  | 'exportAssignment'
> = {
  meta: {
    type: 'problem',
    docs: {
      description: "Disallow syntax that Node's type stripping can't run",
      url: getDocsUrl('own-rules'),
    },
    messages: {
      decorator:
        "Node's type stripping can't run decorators. Remove the decorator, or compile this file",
      accessor:
        "Node's type stripping can't run `accessor` fields. Remove the `accessor` keyword, or compile this file",
      enum: "Node's type stripping can't run enums. Use an object with `as const` and a union type, or compile this file",
      namespace:
        "Node's type stripping can't run a namespace with values. Use a module, or compile this file",
      parameterProperty:
        "Node's type stripping can't run parameter properties. Declare the field and assign it in the constructor, or compile this file",
      importEquals:
        "Node's type stripping can't run import-equals declarations. Use an ECMAScript import or `require()`, or compile this file",
      exportAssignment:
        "Node's type stripping can't run export assignments. Use an ECMAScript export or `module.exports`, or compile this file",
      moduleKeyword:
        "Node's type stripping can't run a `module` declaration with a name. Use `namespace` where it holds only types or is in a declaration, a `declare module 'name'` string, or compile this file",
      useNamespace: 'Replace `module` with `namespace`',
    },
    hasSuggestions: true,
    schema: [],
  },
  create(context) {
    return {
      TSImportEqualsDeclaration(node) {
        if (node.importKind !== 'type' && !isAmbient(node)) {
          context.report({ node, messageId: 'importEquals' })
        }
      },
      TSExportAssignment(node) {
        if (!isAmbient(node)) {
          context.report({ node, messageId: 'exportAssignment' })
        }
      },
      Decorator(node) {
        if (!isAmbient(node)) {
          context.report({ node, messageId: 'decorator' })
        }
      },
      AccessorProperty(node) {
        if (!isAmbient(node)) {
          context.report({ node, messageId: 'accessor' })
        }
      },
      TSEnumDeclaration(node) {
        if (!node.declare && !isAmbient(node)) {
          context.report({ node, messageId: 'enum' })
        }
      },
      TSModuleDeclaration(node) {
        if (node.kind === 'module' && node.id.type !== AST_NODE_TYPES.Literal) {
          const keyword = context.sourceCode.getTokenBefore(node.id)
          context.report({
            node,
            messageId: 'moduleKeyword',
            // Only where Node erases the namespace, so the code then runs
            suggest:
              keyword && (node.declare || isAmbient(node) || isTypeOnlyNamespace(node))
                ? [
                    {
                      messageId: 'useNamespace',
                      fix: (fixer) => fixer.replaceText(keyword, 'namespace'),
                    },
                  ]
                : [],
          })
        }
        if (
          node.kind === 'namespace' &&
          !node.declare &&
          !isAmbient(node) &&
          !isTypeOnlyNamespace(node) &&
          !isInRuntimeNamespace(node)
        ) {
          context.report({ node, messageId: 'namespace' })
        }
      },
      TSParameterProperty(node) {
        if (!isAmbient(node)) {
          context.report({ node, messageId: 'parameterProperty' })
        }
      },
    }
  },
}
