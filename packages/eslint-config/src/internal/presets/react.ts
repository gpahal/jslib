import type EslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

import { isRecord } from '@gpahal/std/objects'

import {
  confusingBrowserGlobalsRules,
  untypedConfusingBrowserGlobalsConfig,
} from '@/internal/configs/browser'
import { COMMONJS_FILES, CONFIG_FILES, JSX_FILES } from '@/internal/files'
import {
  intersectFiles,
  intersectFileSpecs,
  isSameFiles,
  type FileSpecs,
  type Scope,
} from '@/internal/globs'
import { named, withSetup } from '@/internal/naming'
import { importPeers, interopDefault } from '@/internal/peers'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * Without eslint-plugin-react-refresh, which `refresh: false` doesn't need
 */
export const REACT_PEERS: Array<string> = [
  '@eslint-react/eslint-plugin',
  'eslint-plugin-react-hooks',
  'eslint-plugin-jsx-a11y-x',
]

export const REACT_REFRESH_PEER = 'eslint-plugin-react-refresh'

/**
 * Rules that only matter with the React Compiler: memoization it keeps, code it can't compile, and
 * its options and gating. The other rules check the Rules of React, which hold either way
 */
const REACT_COMPILER_RULES = [
  'react-hooks/config',
  'react-hooks/gating',
  'react-hooks/incompatible-library',
  'react-hooks/preserve-manual-memoization',
  'react-hooks/unsupported-syntax',
]

/**
 * Data fetching and `config`, which eslint-plugin-react-refresh's `next` config leaves out
 */
const PAGES_ROUTER_EXPORT_NAMES = [
  'getStaticProps',
  'getServerSideProps',
  'getStaticPaths',
  'config',
]

/**
 * Data loading, actions, metadata and middleware, which its framework mode reads
 */
const REACT_ROUTER_EXPORT_NAMES = [
  'loader',
  'clientLoader',
  'action',
  'clientAction',
  'meta',
  'links',
  'headers',
  'handle',
  'shouldRevalidate',
  'middleware',
  'clientMiddleware',
]

/**
 * The App Router's from eslint-plugin-react-refresh's `next` config, so they follow Next.js's
 * releases, and the Pages Router's
 */
function getNextjsExportNames(plugin: typeof EslintPluginReactRefresh): Array<string> {
  // The plugin's types name the rule without its plugin prefix
  const rules: Readonly<Record<string, unknown>> = plugin.configs.next.rules
  const entry = rules['react-refresh/only-export-components']
  const options: unknown = Array.isArray(entry) ? entry[1] : undefined
  const names: unknown = isRecord(options) ? options['allowExportNames'] : undefined
  const configNames = Array.isArray(names)
    ? names.filter((name): name is string => typeof name === 'string')
    : []
  return [...new Set([...configNames, ...PAGES_ROUTER_EXPORT_NAMES])]
}

export async function react({
  files,
  commonjsIgnores,
  serverIgnores = [],
  refresh = true,
  nextjsFiles,
  typeAware,
  untyped,
  compiler = false,
}: {
  files: FileSpecs
  /**
   * CommonJS `.js` files run in Node
   */
  commonjsIgnores: Array<string>
  serverIgnores?: Array<string> | undefined
  refresh?: boolean | undefined
  /**
   * Where Next.js's page exports are allowed
   */
  nextjsFiles?: FileSpecs | undefined
  typeAware: Required<Scope> | undefined
  untyped: Scope
  compiler?: boolean | undefined
}): Promise<Array<TypedConfig>> {
  const [eslintPluginReact, eslintPluginReactHooks, eslintPluginJsxA11y, eslintPluginReactRefresh] =
    await importPeers(
      nextjsFiles === undefined ? 'react' : 'nextjs',
      [...REACT_PEERS, ...(refresh ? [REACT_REFRESH_PEER] : [])],
      async () =>
        Promise.all([
          interopDefault(import('@eslint-react/eslint-plugin')),
          interopDefault(import('eslint-plugin-react-hooks')),
          interopDefault(import('eslint-plugin-jsx-a11y-x')),
          refresh ? interopDefault(import('eslint-plugin-react-refresh')) : undefined,
        ]),
    )
  const confusingGlobalsIgnores = [
    ...commonjsIgnores,
    ...CONFIG_FILES,
    ...COMMONJS_FILES,
    ...serverIgnores,
  ]
  return withSetup('react', [
    // Config and CommonJS files run in Node
    {
      name: 'gpahal/react/globals',
      files,
      ignores: [...commonjsIgnores, ...CONFIG_FILES, ...COMMONJS_FILES],
      languageOptions: {
        globals: globals.browser,
      },
    },
    // `@gpahal/no-browser-globals` reports them in `server` files
    {
      name: 'gpahal/react/confusing-globals',
      files,
      ignores: confusingGlobalsIgnores,
      rules: confusingBrowserGlobalsRules(),
    },
    untypedConfusingBrowserGlobalsConfig(
      'gpahal/react/untyped-confusing-globals',
      { files, ignores: confusingGlobalsIgnores },
      untyped,
    ),
    ...named('react', { files }, [eslintPluginReact.configs.recommended]),
    ...(typeAware
      ? [
          ...named('react', { files, ignores: typeAware.ignores }, [
            eslintPluginReact.configs['recommended-type-checked'],
          ]),
          {
            name: 'gpahal/react/type-aware',
            files,
            ignores: typeAware.ignores,
            rules: {
              '@eslint-react/no-unused-props': 'error',
            },
          } satisfies TypedConfig,
        ]
      : []),
    ...named('react', { files }, [
      // `void-use-memo` reports a `useMemo` callback that returns nothing
      {
        ...eslintPluginReactHooks.configs.flat['recommended-latest'],
        name: 'react-hooks/recommended-latest',
      },
      eslintPluginJsxA11y.configs.recommended,
    ]),
    {
      name: 'gpahal/react/rules',
      files,
      rules: {
        // From @eslint-react's strict config: `target="_blank"` without `rel="noreferrer"`, a
        // `<button>` without a `type`, which submits its form, and an `<iframe>` without `sandbox`
        '@eslint-react/dom-no-unsafe-target-blank': 'error',
        '@eslint-react/dom-no-missing-button-type': 'error',
        '@eslint-react/dom-no-missing-iframe-sandbox': 'error',
        // A value made on each render re-renders every consumer
        '@eslint-react/no-unstable-context-value': 'error',
        '@eslint-react/no-unstable-default-props': 'error',
        // TypeScript doesn't check duplicate keys in `.jsx` files either
        '@eslint-react/no-duplicate-key': 'error',
        'jsx-a11y-x/alt-text': [
          'error',
          {
            elements: ['img', 'object', 'area', 'input[type="image"]'],
            img: ['Image'],
          },
        ],
        // @eslint-react copies some React Hooks rules, such as `rules-of-hooks`, so each problem
        // would be reported twice. Its `disable-conflict-eslint-plugin-react-hooks` config would
        // also turn off ones its recommended configs leave off, such as `refs`
        ...Object.fromEntries(
          Object.keys(eslintPluginReactHooks.configs.flat['recommended-latest'].rules)
            .map((name) => name.replace(/^react-hooks\//, '@eslint-react/'))
            .filter((name) => Object.hasOwn(eslintPluginReact.configs.all.rules ?? {}, name))
            .map((name) => [name, 'off']),
        ),
        ...(!compiler && Object.fromEntries(REACT_COMPILER_RULES.map((name) => [name, 'off']))),
      },
    },
    ...(eslintPluginReactRefresh
      ? reactRefreshConfigs(eslintPluginReactRefresh, intersectFiles(files, JSX_FILES), nextjsFiles)
      : []),
  ])
}

/**
 * Constants are allowed, since bundlers such as Vite hot-reload a module that exports them, and so
 * are React Router's route exports. Next.js's page exports only in `nextjsFiles`
 */
function reactRefreshConfigs(
  plugin: typeof EslintPluginReactRefresh,
  files: FileSpecs,
  nextjsFiles: FileSpecs | undefined,
): Array<TypedConfig> {
  const config = (name: string, configFiles: FileSpecs, allowExportNames: Array<string>) =>
    ({
      name,
      files: configFiles,
      plugins: { 'react-refresh': plugin },
      rules: {
        'react-refresh/only-export-components': [
          'error',
          { allowConstantExport: true, allowExportNames },
        ],
      },
    }) satisfies TypedConfig
  const routerNames = [...REACT_ROUTER_EXPORT_NAMES]
  if (nextjsFiles === undefined) {
    return [config('gpahal/react/refresh', files, routerNames)]
  }
  const nextjsNames = [...new Set([...routerNames, ...getNextjsExportNames(plugin)])]
  const jsxNextjsFiles = intersectFiles(nextjsFiles, JSX_FILES)
  return isSameFiles(jsxNextjsFiles, files)
    ? [config('gpahal/react/refresh', files, nextjsNames)]
    : [
        config('gpahal/react/refresh', files, routerNames),
        config('gpahal/react/refresh-nextjs', intersectFileSpecs(files, nextjsFiles), nextjsNames),
      ]
}

/**
 * Code blocks often call a hook outside a component, and no bundler hot-reloads them
 */
export function reactCodeBlockRules(refresh: boolean): TypedRules {
  return {
    'react-hooks/rules-of-hooks': 'off',
    ...(refresh && { 'react-refresh/only-export-components': 'off' }),
  }
}

/**
 * Type-checked rules would crash in `untyped`'s files, so this comes after your configs
 */
export async function reactDisableTypeChecked(untyped: Scope): Promise<Array<TypedConfig>> {
  const eslintPluginReact = await importPeers('react', ['@eslint-react/eslint-plugin'], async () =>
    interopDefault(import('@eslint-react/eslint-plugin')),
  )
  return withSetup('disable-type-checked/react', [
    ...named('disable-type-checked/react', untyped, [
      eslintPluginReact.configs['disable-type-checked'],
    ]),
  ])
}
