/**
 * The `@gpahal/no-js-specifier-for-ts` rule. TypeScript's `nodenext` resolution maps `./b.js` to
 * `b.ts`, so `tsc` passes, but Node's type stripping loads the named file and fails with
 * `ERR_MODULE_NOT_FOUND`. Calls that resolve against another folder, such as `require.resolve()`
 * with `paths`, are left alone
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { AST_NODE_TYPES, ASTUtils, TSESLint, type TSESTree } from '@typescript-eslint/utils'

import { getDocsUrl } from '@/internal/utils'

const TS_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['.js', '.ts'],
  ['.mjs', '.mts'],
  ['.cjs', '.cts'],
])

/**
 * A path `fs.statSync` rejects, as with ENAMETOOLONG or EACCES, counts as missing
 */
function exists(file: string, isFolderLoadable = false): boolean {
  let stats: fs.Stats | undefined
  try {
    stats = fs.statSync(file, { throwIfNoEntry: false })
  } catch {
    return false
  }
  return stats?.isFile() === true || (isFolderLoadable && stats?.isDirectory() === true)
}

function isThisFileResolve(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    node.object.type === AST_NODE_TYPES.MetaProperty &&
    node.object.meta.name === 'import' &&
    node.object.property.name === 'meta' &&
    !node.computed &&
    node.property.name === 'resolve'
  )
}

const NODE_MODULE_SPECIFIERS: ReadonlySet<string> = new Set(['module', 'node:module'])

function isThisFile(node: TSESTree.Node | undefined): boolean {
  return (
    node?.type === AST_NODE_TYPES.MemberExpression &&
    node.object.type === AST_NODE_TYPES.MetaProperty &&
    node.object.meta.name === 'import' &&
    node.object.property.name === 'meta' &&
    !node.computed &&
    (node.property.name === 'url' || node.property.name === 'filename')
  )
}

/**
 * `imported` is `undefined` for the whole module
 */
function isImportedFromNodeModule(
  sourceCode: TSESLint.SourceCode,
  node: TSESTree.Node,
  name: string,
  imported: string | undefined,
): boolean {
  const [def, ...rest] = ASTUtils.findVariable(sourceCode.getScope(node), name)?.defs ?? []
  if (def?.type !== TSESLint.Scope.DefinitionType.ImportBinding || rest.length > 0) {
    return false
  }
  const specifier = def.node
  const isBinding =
    imported === undefined
      ? specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier ||
        specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier
      : specifier.type === AST_NODE_TYPES.ImportSpecifier &&
        specifier.imported.type === AST_NODE_TYPES.Identifier &&
        specifier.imported.name === imported
  return (
    isBinding &&
    def.parent.type === AST_NODE_TYPES.ImportDeclaration &&
    NODE_MODULE_SPECIFIERS.has(def.parent.source.value)
  )
}

function isCreateRequireOfThisFile(
  sourceCode: TSESLint.SourceCode,
  node: TSESTree.Expression | null,
): boolean {
  if (node?.type !== AST_NODE_TYPES.CallExpression || !isThisFile(node.arguments[0])) {
    return false
  }
  const { callee } = node
  return callee.type === AST_NODE_TYPES.Identifier
    ? isImportedFromNodeModule(sourceCode, node, callee.name, 'createRequire')
    : callee.type === AST_NODE_TYPES.MemberExpression &&
        !callee.computed &&
        callee.property.name === 'createRequire' &&
        callee.object.type === AST_NODE_TYPES.Identifier &&
        isImportedFromNodeModule(sourceCode, node, callee.object.name, undefined)
}

/**
 * A `declare const require`, which types the global, or a `createRequire` of this file. Any other
 * binding can be another loader, or resolve relative to another file
 */
function isNodeRequire(
  variable: TSESLint.Scope.Variable,
  sourceCode: TSESLint.SourceCode,
): boolean {
  const [def, ...rest] = variable.defs
  return (
    def?.type === TSESLint.Scope.DefinitionType.Variable &&
    rest.length === 0 &&
    def.parent.kind === 'const' &&
    (def.parent.declare || isCreateRequireOfThisFile(sourceCode, def.node.init))
  )
}

export const noJsSpecifierForTs: TSESLint.RuleModule<'tsSpecifier'> = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description:
        'Disallow a relative `.js`, `.mjs` or `.cjs` specifier that names a TypeScript file, which Node type stripping can’t load',
      url: getDocsUrl('own-rules'),
    },
    messages: {
      tsSpecifier:
        "'{{specifier}}' has no file of its own, but '{{tsSpecifier}}' does: Node's type stripping loads a module by the name its specifier gives, so import the TypeScript file",
    },
    schema: [],
  },
  create(context) {
    const dir = path.dirname(context.filename)
    const fileUrl = pathToFileURL(context.filename)
    // An ES module specifier is a URL, which Node percent-decodes, while a `require()` specifier
    // is a path. `undefined` for a URL that isn't a file path, as with an encoded `/`
    const toFilePath = (specifier: string, isRequire: boolean): string | undefined => {
      if (isRequire) {
        return path.resolve(dir, specifier)
      }
      try {
        return fileURLToPath(new URL(specifier, fileUrl))
      } catch {
        return undefined
      }
    }
    // Per linted file, so an editor's ESLint server sees files added later
    const existing = new Map<string, boolean>()
    const existsCached = (file: string, isFolderLoadable = false): boolean => {
      const key = `${String(isFolderLoadable)}\0${file}`
      let result = existing.get(key)
      if (result === undefined) {
        result = exists(file, isFolderLoadable)
        existing.set(key, result)
      }
      return result
    }
    const check = (source: TSESTree.Node | null | undefined, isRequire = false) => {
      const specifier =
        source == null ? undefined : (ASTUtils.getStringIfConstant(source) ?? undefined)
      if (
        source === null ||
        source === undefined ||
        specifier === undefined ||
        !(specifier.startsWith('./') || specifier.startsWith('../')) ||
        /[?#]/u.test(specifier)
      ) {
        return
      }
      const extension = path.extname(specifier)
      const tsExtension = TS_EXTENSIONS.get(extension)
      if (tsExtension === undefined) {
        return
      }
      const tsSpecifier = `${specifier.slice(0, -extension.length)}${tsExtension}`
      const file = toFilePath(specifier, isRequire)
      const tsFile = toFilePath(tsSpecifier, isRequire)
      if (
        file === undefined ||
        tsFile === undefined ||
        existsCached(file, isRequire) ||
        !existsCached(tsFile)
      ) {
        return
      }
      // The extension as written, before the closing quote or backtick
      const raw = context.sourceCode.getText(source)
      const end = source.range[1] - 1
      const isFixable = raw.slice(0, -1).endsWith(extension)
      context.report({
        node: source,
        messageId: 'tsSpecifier',
        data: { specifier, tsSpecifier },
        ...(isFixable && {
          fix: (fixer) => fixer.replaceTextRange([end - extension.length, end], tsExtension),
        }),
      })
    }
    return {
      ImportDeclaration: (node) => {
        if (node.importKind !== 'type') {
          check(node.source)
        }
      },
      ExportNamedDeclaration: (node) => {
        if (node.exportKind !== 'type') {
          check(node.source)
        }
      },
      ExportAllDeclaration: (node) => {
        if (node.exportKind !== 'type') {
          check(node.source)
        }
      },
      ImportExpression: (node) => {
        check(node.source)
      },
      TSImportEqualsDeclaration: (node) => {
        if (
          node.importKind !== 'type' &&
          node.moduleReference.type === AST_NODE_TYPES.TSExternalModuleReference
        ) {
          check(node.moduleReference.expression, true)
        }
      },
      CallExpression: (node) => {
        const { callee } = node
        if (node.arguments.length !== 1) {
          return
        }
        if (isThisFileResolve(callee)) {
          check(node.arguments[0])
          return
        }
        const isResolve =
          callee.type === AST_NODE_TYPES.MemberExpression &&
          !callee.computed &&
          callee.property.name === 'resolve'
        const requireNode = isResolve ? callee.object : callee
        if (requireNode.type !== AST_NODE_TYPES.Identifier || requireNode.name !== 'require') {
          return
        }
        const variable = ASTUtils.findVariable(context.sourceCode.getScope(node), 'require')
        if (
          variable === null ||
          variable.defs.length === 0 ||
          isNodeRequire(variable, context.sourceCode)
        ) {
          check(node.arguments[0], true)
        }
      },
    }
  },
}
