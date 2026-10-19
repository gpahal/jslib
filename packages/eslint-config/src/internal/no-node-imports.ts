import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

import type { Rule } from 'eslint'
import type { Node } from 'estree'

import { isRecord } from '@gpahal/std/objects'

import { isNode } from '@/internal/ast'
import { findPackageJson, findUp, readJsonFile } from '@/internal/fs'
import { getDocsUrl } from '@/internal/utils'

/**
 * Without `node:`, such as `fs` and `fs/promises`
 */
const NODE_BUILTIN_MODULES: ReadonlySet<string> = new Set(
  builtinModules.filter((name) => !name.startsWith('node:')),
)

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

/**
 * Read once per process: an editor's ESLint server needs a restart to see a dependency change
 */
const DECLARED_PACKAGES = new Map<string, ReadonlySet<string>>()

/**
 * In any dependency field
 */
function getDeclaredPackages(dir: string): ReadonlySet<string> {
  const packageJsonPath = findUp('package.json', dir)
  if (packageJsonPath === undefined) {
    return new Set()
  }
  let packages = DECLARED_PACKAGES.get(packageJsonPath)
  if (packages === undefined) {
    packages = readDeclaredPackages(packageJsonPath)
    DECLARED_PACKAGES.set(packageJsonPath, packages)
  }
  return packages
}

/**
 * `{}` for a file that isn't a regular file, doesn't parse or isn't an object
 */
function readJson(file: string): Record<string, unknown> {
  const json = readJsonFile(file)
  return isRecord(json) ? json : {}
}

function readDeclaredPackages(packageJsonPath: string): ReadonlySet<string> {
  const packageJson = readJson(packageJsonPath)
  return new Set(
    DEPENDENCY_FIELDS.flatMap((field) => {
      const dependencies = packageJson[field]
      return isRecord(dependencies) ? Object.keys(dependencies) : []
    }),
  )
}

/**
 * A bundler resolves `import 'zlib'` to the package named `zlib`, so a renamed port, such as
 * `browserify-zlib`, needs a bundler alias too. An unrelated package named `zlib` exempts nothing
 */
const BROWSER_SHIMS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ['assert', ['assert']],
  ['buffer', ['buffer']],
  ['console', ['console-browserify']],
  ['constants', ['constants-browserify']],
  ['crypto', ['crypto-browserify']],
  ['domain', ['domain-browser']],
  ['events', ['events']],
  ['http', ['stream-http']],
  ['https', ['https-browserify']],
  ['os', ['os-browserify']],
  ['path', ['path', 'path-browserify']],
  ['process', ['process']],
  ['punycode', ['punycode']],
  ['querystring', ['querystring', 'querystring-es3']],
  ['stream', ['stream-browserify', 'readable-stream']],
  ['string_decoder', ['string_decoder']],
  // A deprecated alias of `util`
  ['sys', ['util']],
  ['timers', ['timers-browserify']],
  ['tty', ['tty-browserify']],
  ['url', ['url']],
  ['util', ['util']],
  ['vm', ['vm-browserify']],
  ['zlib', ['browserify-zlib']],
])

/**
 * A bare built-in passes when the nearest `package.json` declares a port from `BROWSER_SHIMS`. A
 * subpath, such as `path/posix`, also needs an installed declared port that has it
 */
function isNodeImport(specifier: string, lookups: FileLookups): boolean {
  if (specifier.startsWith('node:')) {
    return true
  }
  if (!NODE_BUILTIN_MODULES.has(specifier)) {
    return false
  }
  const [moduleName = specifier, ...subpath] = specifier.split('/')
  const declared = lookups.getDeclaredPackages()
  const shims = (BROWSER_SHIMS.get(moduleName) ?? []).filter((shim) => declared.has(shim))
  return (
    shims.length === 0 ||
    (subpath.length > 0 && shims.every((shim) => !lookups.hasSubpath(shim, subpath.join('/'))))
  )
}

type FileLookups = {
  getDeclaredPackages: () => ReadonlySet<string>
  hasSubpath: (name: string, subpath: string) => boolean
}

/**
 * Once per linted file, so `hasSubpath`'s file checks don't go stale in an editor
 */
function createFileLookups(filename: string): FileLookups {
  const dir = path.dirname(filename)
  let declared: ReadonlySet<string> | undefined
  const subpaths = new Map<string, boolean>()
  return {
    getDeclaredPackages: () => {
      declared ??= getDeclaredPackages(dir)
      return declared
    },
    hasSubpath: (name, subpath) => {
      const key = `${name}\0${subpath}`
      let result = subpaths.get(key)
      if (result === undefined) {
        result = hasSubpath(name, subpath, dir)
        subpaths.set(key, result)
      }
      return result
    },
  }
}

/**
 * Its own key's, or else the longest matching pattern key's, as Node picks it. `undefined` when no
 * key matches, as for string or condition-only `exports`, which export only `.`
 */
function getExportTarget(exports: unknown, subpath: string): unknown {
  if (!isRecord(exports)) {
    return undefined
  }
  const target = `./${subpath}`
  if (Object.hasOwn(exports, target)) {
    return exports[target]
  }
  let best: { key: string; prefix: string } | undefined
  for (const key of Object.keys(exports)) {
    const [before = '', after, ...rest] = key.split('*')
    if (
      after !== undefined &&
      rest.length === 0 &&
      target.length >= before.length + after.length &&
      target.startsWith(before) &&
      target.endsWith(after) &&
      (best === undefined ||
        before.length > best.prefix.length ||
        (before.length === best.prefix.length && key.length > best.key.length))
    ) {
      best = { key, prefix: before }
    }
  }
  return best === undefined ? undefined : exports[best.key]
}

const BROWSER_CONDITIONS: ReadonlySet<string> = new Set([
  'browser',
  'import',
  'module',
  'require',
  'default',
])

/**
 * As Node's `resolvePackageTarget` with the browser conditions. `undefined` when no condition
 * matches, which lets an enclosing condition object go on to its next key
 */
function isExportedTarget(target: unknown): boolean | undefined {
  if (typeof target === 'string') {
    return true
  }
  if (target === null) {
    return false
  }
  if (Array.isArray(target)) {
    let fallback: false | undefined
    for (const value of target) {
      const isExported = isExportedTarget(value)
      if (isExported === true) {
        return true
      }
      fallback ??= isExported
    }
    return fallback
  }
  if (!isRecord(target)) {
    return undefined
  }
  for (const [key, value] of Object.entries(target)) {
    const isExported = BROWSER_CONDITIONS.has(key) ? isExportedTarget(value) : undefined
    if (isExported !== undefined) {
      return isExported
    }
  }
  return undefined
}

/**
 * Read once per process
 */
const SHIM_PACKAGE_JSONS = new Map<string, { file: string; json: Record<string, unknown> } | null>()

function getShimPackageJson(
  name: string,
  dir: string,
): { file: string; json: Record<string, unknown> } | undefined {
  const key = `${dir}\0${name}`
  let entry = SHIM_PACKAGE_JSONS.get(key)
  if (entry === undefined) {
    const file = findPackageJson(name, dir)
    entry = file === undefined ? null : { file, json: readJson(file) }
    SHIM_PACKAGE_JSONS.set(key, entry)
  }
  return entry ?? undefined
}

/**
 * In its `exports` with the browser conditions, or as a file or folder without `exports`
 */
function hasSubpath(name: string, subpath: string, dir: string): boolean {
  const packageJson = getShimPackageJson(name, dir)
  if (packageJson === undefined) {
    return false
  }
  const { file, json } = packageJson
  const { exports } = json
  if (exports != null) {
    return isExportedTarget(getExportTarget(exports, subpath)) === true
  }
  const packageDir = path.dirname(file)
  return [subpath, `${subpath}.js`, path.join(subpath, 'index.js')].some((candidate) =>
    fs.existsSync(path.join(packageDir, candidate)),
  )
}

function getStaticString(node: Node | null | undefined): string | undefined {
  if (node?.type === 'Literal') {
    return typeof node.value === 'string' ? node.value : undefined
  }
  return node?.type === 'TemplateLiteral' && node.expressions.length === 0
    ? (node.quasis[0]?.value.cooked ?? undefined)
    : undefined
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
 * Inline `type` specifiers still load the module under `verbatimModuleSyntax`, but other rules
 * report those
 */
function isTypeOnly(node: Node): boolean {
  if (Reflect.get(node, 'importKind') === 'type' || Reflect.get(node, 'exportKind') === 'type') {
    return true
  }
  const specifiers: unknown = Reflect.get(node, 'specifiers')
  return (
    Array.isArray(specifiers) &&
    specifiers.length > 0 &&
    specifiers.every(
      (specifier: unknown) =>
        typeof specifier === 'object' &&
        specifier !== null &&
        (Reflect.get(specifier, 'importKind') === 'type' ||
          Reflect.get(specifier, 'exportKind') === 'type'),
    )
  )
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
      const lookups = createFileLookups(context.filename)
      const check = (node: Node, source: Node | null | undefined) => {
        if (isTypeOnly(node)) {
          return
        }
        const specifier = getStaticString(source)
        if (specifier !== undefined && isNodeImport(specifier, lookups)) {
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
