import path from 'node:path'

import type { Rule, Scope } from 'eslint'
import type * as ESTree from 'estree'

import { isRecord } from '@gpahal/std/objects'

import { BROWSER_ONLY_GLOBALS } from '@/internal/configs/browser'
import { getDocsUrl } from '@/internal/utils'

/**
 * Server components unless they start with `'use client'`. `route` files run on the server too
 */
export const NEXTJS_SERVER_ENTRY_NAMES: ReadonlyArray<string> = [
  'page',
  'layout',
  'template',
  'loading',
  'not-found',
  'default',
  'route',
]

export const NEXTJS_CLIENT_ENTRY_NAMES: ReadonlyArray<string> = ['error', 'global-error']

const CLIENT_HOOKS: ReadonlySet<string> = new Set([
  'useState',
  'useEffect',
  'useLayoutEffect',
  'useReducer',
  'useRef',
  'useContext',
  'useSyncExternalStore',
  'useTransition',
  'useDeferredValue',
  'useImperativeHandle',
  'useInsertionEffect',
  'useOptimistic',
  'useActionState',
  'useFormStatus',
])

const BROWSER_GLOBALS: ReadonlySet<string> = new Set(BROWSER_ONLY_GLOBALS)

/**
 * As in `window!`
 */
const TYPE_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
])

function hasUseClient(program: ESTree.Program): boolean {
  for (const statement of program.body) {
    if (statement.type !== 'ExpressionStatement' || !('directive' in statement)) {
      return false
    }
    if (statement.directive === 'use client') {
      return true
    }
  }
  return false
}

/**
 * Through type assertions and optional chains, or a type's `typeof`, as `type W = typeof window`
 */
function isTypeofOperand(ancestors: Array<ESTree.Node>): boolean {
  let parent = ancestors.pop()
  while (
    parent !== undefined &&
    (TYPE_WRAPPER_TYPES.has(parent.type) || parent.type === 'ChainExpression')
  ) {
    parent = ancestors.pop()
  }
  // `TSTypeQuery` is typescript-eslint's, which ESTree's types leave out
  return (
    (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') ||
    (parent?.type as string | undefined) === 'TSTypeQuery'
  )
}

/**
 * As `useState()` or `React.useState()`
 */
function getClientHookName(node: ESTree.CallExpression): string | undefined {
  const { callee } = node
  const name =
    callee.type === 'Identifier'
      ? callee.name
      : callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier'
        ? callee.property.name
        : undefined
  return name !== undefined && CLIENT_HOOKS.has(name) ? name : undefined
}

/**
 * As typescript-eslint's scope manager tells them apart
 */
function isValueReference(reference: Scope.Reference): boolean {
  return Reflect.get(reference, 'isValueReference') !== false
}

/**
 * In an App Router server entry or route handler without `'use client'`, reports a browser global
 * that Node lacks, except under `typeof`, and a client-only hook call. In an `error` or
 * `global-error` file, reports the missing directive. With `ignoresBrowserGlobals`, for `server`
 * files, globals are left to `@gpahal/no-browser-globals`. No fix: moving the code or the file to
 * the client is the author's call
 */
export const nextjsServerComponent: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow browser globals and client-only hooks in Next.js server components, and require `'use client'` in error boundaries",
      url: getDocsUrl('own-rules'),
    },
    messages: {
      browserGlobal:
        "Unexpected `{{name}}` in a server component, where browser globals are undefined. Add `'use client'` at the top of the file, or move the code into a client component",
      clientHook:
        "Unexpected `{{name}}()` in a server component, which can't call client-only hooks. Add `'use client'` at the top of the file, or move the code into a client component",
      routeBrowserGlobal:
        'Unexpected `{{name}}` in a route handler, which runs on the server, where browser globals are undefined',
      routeHook: "Unexpected `{{name}}()` in a route handler, which isn't a component",
      missingUseClient:
        "Expected `'use client'` at the top of this file: Next.js requires `{{file}}` files, error boundaries, to be client components",
    },
    schema: [
      {
        type: 'object',
        properties: { ignoresBrowserGlobals: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const name = path.basename(context.filename).replace(/\.[^.]+$/u, '')
    const isClientEntry = NEXTJS_CLIENT_ENTRY_NAMES.includes(name)
    if (!isClientEntry && !NEXTJS_SERVER_ENTRY_NAMES.includes(name)) {
      return {}
    }
    const { sourceCode } = context
    if (hasUseClient(sourceCode.ast)) {
      return {}
    }
    if (isClientEntry) {
      return {
        Program(node) {
          context.report({
            node,
            loc: { line: 1, column: 0 },
            messageId: 'missingUseClient',
            data: { file: name },
          })
        },
      }
    }
    const isRoute = name === 'route'
    const options: unknown = context.options[0]
    const ignoresBrowserGlobals = isRecord(options) && options['ignoresBrowserGlobals'] === true
    return {
      CallExpression(node) {
        const hook = getClientHookName(node)
        if (hook !== undefined) {
          context.report({
            node: node.callee,
            messageId: isRoute ? 'routeHook' : 'clientHook',
            data: { name: hook },
          })
        }
      },
      'Program:exit': (node) => {
        if (ignoresBrowserGlobals) {
          return
        }
        const globalScope = sourceCode.getScope(node)
        // A defined global resolves to its variable, and an undefined one stays in `through`
        const references = [
          ...globalScope.variables
            .filter((variable) => BROWSER_GLOBALS.has(variable.name) && variable.defs.length === 0)
            .flatMap((variable) => variable.references),
          ...globalScope.through.filter((reference) =>
            BROWSER_GLOBALS.has(reference.identifier.name),
          ),
        ].toSorted((a, b) => (a.identifier.range?.[0] ?? 0) - (b.identifier.range?.[0] ?? 0))
        for (const reference of references) {
          const { identifier } = reference
          if (
            // A JSX element's name, such as `<Image />`, names a component
            identifier.type !== 'Identifier' ||
            !isValueReference(reference) ||
            isTypeofOperand(sourceCode.getAncestors(identifier))
          ) {
            continue
          }
          context.report({
            node: identifier,
            messageId: isRoute ? 'routeBrowserGlobal' : 'browserGlobal',
            data: { name: identifier.name },
          })
        }
      },
    }
  },
}
