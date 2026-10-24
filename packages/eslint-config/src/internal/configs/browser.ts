import globals from 'globals'

import { clonePlain } from '@gpahal/std/objects'

import { intersectFileSpecs } from '@/internal/globs'
import type { FileSpecs, Scope } from '@/internal/globs'
import type { TypedConfig, TypedRules } from '@/internal/types'

const MESSAGE =
  'Browser code runs without Node. The `browser` option of @gpahal/eslint-config lists these files'

const SERVER_MESSAGE =
  'Server code runs without browser globals. The `server` option of @gpahal/eslint-config lists these files'

/**
 * Including the CommonJS ones, such as `require`
 */
const NODE_ONLY_GLOBALS = Object.keys(globals.node).filter(
  (name) => !Object.hasOwn(globals.browser, name),
)

/**
 * globals lists these as Node's, but Node defines them only with `--experimental-webstorage`
 */
const WEB_STORAGE_GLOBALS = new Set(['localStorage', 'sessionStorage', 'Storage'])

export const BROWSER_ONLY_GLOBALS: ReadonlyArray<string> = Object.keys(globals.browser).filter(
  (name) =>
    WEB_STORAGE_GLOBALS.has(name) ||
    (!Object.hasOwn(globals.node, name) &&
      !Object.hasOwn(globals.nodeBuiltin, name) &&
      !Object.hasOwn(globals.builtin, name)),
)

/**
 * The `window` properties that read like local variables, as `length` or `top`, without those
 * `no-deprecated` or `no-alert` report, and `self`, the usual global in workers. Files without type
 * information also get {@link DEPRECATED_BROWSER_GLOBALS}
 */
const CONFUSING_BROWSER_GLOBALS = [
  'addEventListener',
  'close',
  'closed',
  'defaultStatus',
  'defaultstatus',
  'find',
  'focus',
  'frameElement',
  'frames',
  'history',
  'innerHeight',
  'innerWidth',
  'length',
  'location',
  'locationbar',
  'menubar',
  'moveBy',
  'moveTo',
  'onblur',
  'onerror',
  'onfocus',
  'onload',
  'onresize',
  'open',
  'opener',
  'opera',
  'outerHeight',
  'outerWidth',
  'pageXOffset',
  'pageYOffset',
  'parent',
  'print',
  'removeEventListener',
  'resizeBy',
  'resizeTo',
  'screen',
  'screenLeft',
  'screenTop',
  'screenX',
  'screenY',
  'scroll',
  'scrollbars',
  'scrollBy',
  'scrollTo',
  'scrollX',
  'scrollY',
  'statusbar',
  'stop',
  'toolbar',
  'top',
]

/**
 * Confusing browser globals that `@typescript-eslint/no-deprecated` reports, but only in files with
 * type information
 */
const DEPRECATED_BROWSER_GLOBALS = ['blur', 'event', 'external', 'name', 'onunload', 'status']

function confusingGlobalsRules(names: ReadonlyArray<string>): TypedRules {
  return {
    'no-restricted-globals': [
      'error',
      ...names.map((name) => ({
        name,
        message: `Use \`globalThis.${name}\`, which shows that it's the browser global.`,
      })),
    ],
    // It would fix the `globalThis.<name>` that `no-restricted-globals` asks for back to `<name>`
    'unicorn/no-unnecessary-global-this': 'off',
  }
}

const CONFUSING_BROWSER_GLOBALS_RULES = confusingGlobalsRules(CONFUSING_BROWSER_GLOBALS)

const UNTYPED_CONFUSING_BROWSER_GLOBALS_RULES = confusingGlobalsRules([
  ...CONFUSING_BROWSER_GLOBALS,
  ...DEPRECATED_BROWSER_GLOBALS,
])

/**
 * A setting of yours of `no-restricted-globals` replaces this list
 */
export function confusingBrowserGlobalsRules(): TypedRules {
  return clonePlain(CONFUSING_BROWSER_GLOBALS_RULES)
}

/**
 * For the files of `scope` without type information, where `no-deprecated` doesn't run, the
 * confusing browser globals with those it reports. Comes right after the config of
 * {@link confusingBrowserGlobalsRules}, since its list replaces that one
 */
export function untypedConfusingBrowserGlobalsConfig(
  name: string,
  scope: Scope,
  untyped: Scope,
): TypedConfig {
  const ignores = [...(scope.ignores ?? []), ...(untyped.ignores ?? [])]
  return {
    name,
    files: intersectFileSpecs(scope.files, untyped.files),
    ...(ignores.length > 0 && { ignores }),
    rules: clonePlain(UNTYPED_CONFUSING_BROWSER_GLOBALS_RULES),
  }
}

/**
 * Node's built-in modules and globals are reported, also through `globalThis`, `window` or `self`,
 * except under `typeof`. Node's globals stay defined unless `isNodeGlobalsOff`, so `no-undef`
 * doesn't report them too. The rules are `@gpahal` aliases of the core `no-restricted-*` rules, so
 * your config of those doesn't replace these
 */
export function browserConfig({
  name,
  files,
  ignores,
  isNodeGlobalsOff = false,
  allowsProcessEnv = false,
  message = MESSAGE,
}: {
  name: string
  files: FileSpecs
  ignores?: Array<string>
  isNodeGlobalsOff?: boolean
  allowsProcessEnv?: boolean
  /**
   * Names the `browser` option by default
   */
  message?: string
}): TypedConfig {
  return {
    name,
    files,
    ...(ignores && ignores.length > 0 && { ignores }),
    languageOptions: {
      globals: {
        ...(isNodeGlobalsOff &&
          Object.fromEntries(NODE_ONLY_GLOBALS.map((global) => [global, 'off']))),
        ...globals.browser,
      },
    },
    rules: {
      // Its `unicorn/no-unnecessary-global-this: off` keeps `globalThis.process` from becoming
      // `process`, which `@gpahal/no-node-globals` reports
      ...confusingBrowserGlobalsRules(),
      '@gpahal/no-node-globals': [
        'error',
        ...NODE_ONLY_GLOBALS.map((global) =>
          allowsProcessEnv && global === 'process'
            ? { name: global, message, allowProperties: ['env'] }
            : { name: global, message },
        ),
      ],
      // `@gpahal/no-node-globals` doesn't see reads from `globalThis`, `window` or `self`
      '@gpahal/no-node-global-properties': [
        'error',
        ...NODE_ONLY_GLOBALS.map((property) =>
          property === 'process'
            ? {
                object: 'globalThis',
                property,
                message,
                allowProperties: allowsProcessEnv ? ['env'] : [],
              }
            : { object: 'globalThis', property, message },
        ),
        ...['dirname', 'filename'].map((property) => ({
          object: 'import.meta',
          property,
          message,
        })),
      ],
      '@gpahal/no-node-imports': ['error', { message }],
      '@gpahal/no-node-dynamic-imports': ['error', { message }],
      // It rewrites a declared browser shim's import, such as `buffer`, to `node:buffer`
      'unicorn/prefer-node-protocol': 'off',
    },
  }
}

/**
 * `ignores` are files that `files` matches but that aren't browser code, such as `server`'s
 */
export function browser({
  files,
  ignores,
  untyped,
}: {
  files: FileSpecs
  ignores?: ReadonlyArray<string> | undefined
  untyped: Scope
}): Array<TypedConfig> {
  return [
    browserConfig({
      name: 'gpahal/browser/rules',
      files: [...files],
      allowsProcessEnv: true,
      ...(ignores && { ignores: [...ignores] }),
    }),
    untypedConfusingBrowserGlobalsConfig(
      'gpahal/browser/untyped-confusing-globals',
      { files: [...files], ...(ignores && { ignores: [...ignores] }) },
      untyped,
    ),
  ]
}

/**
 * Runs in Node even where a preset such as `react` defines browser globals for every code file.
 * Browser globals are defined, with or without such a preset, so `no-undef` doesn't report them too
 */
export function server({ files }: { files: FileSpecs }): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/server/globals',
      files: [...files],
      languageOptions: {
        globals: {
          ...Object.fromEntries(BROWSER_ONLY_GLOBALS.map((global) => [global, 'readonly'])),
          ...globals.nodeBuiltin,
        },
      },
    },
    {
      name: 'gpahal/server/rules',
      files: [...files],
      rules: {
        '@gpahal/no-browser-globals': [
          'error',
          ...BROWSER_ONLY_GLOBALS.map((global) => ({ name: global, message: SERVER_MESSAGE })),
        ],
        '@gpahal/no-browser-global-properties': [
          'error',
          ...BROWSER_ONLY_GLOBALS.map((property) => ({
            object: 'globalThis',
            property,
            message: SERVER_MESSAGE,
          })),
        ],
      },
    },
  ]
}
