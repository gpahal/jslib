import { createRequire } from 'node:module'
import process from 'node:process'

import { formatInstallCommand } from '@gpahal/internal/node/package-manager'
import { uniqueBy } from '@gpahal/std/arrays'
import { formatNames } from '@gpahal/std/errors'

import { browserConfig, untypedConfusingBrowserGlobalsConfig } from '@/internal/configs/browser'
import { ASTRO_FILES, ASTRO_SCRIPT_FILES, TYPED_CODE_EXTNS_WITH_DOT } from '@/internal/files'
import type { Scope } from '@/internal/globs'
import { withSetup } from '@/internal/naming'
import { importPeers, interopDefault, isInstalledIn } from '@/internal/peers'
import type { TypedConfig, TypedRules } from '@/internal/types'
import { formatErrorMessage, warnOfSetupOnce } from '@/internal/utils'

/**
 * The `astro/jsx-a11y/*` rules also need eslint-plugin-jsx-a11y-x or eslint-plugin-jsx-a11y where ESLint runs, which
 * `checkJsxA11y` checks, since eslint-plugin-astro loads it from the working directory
 */
export const ASTRO_PEERS: Array<string> = ['eslint-plugin-astro']

/**
 * So each warns once per process
 */
const warnedJsxA11yDirs = new Set<string>()

/**
 * Its `astro/jsx-a11y/*` rules throw without it, so a missing one warns once per folder and the
 * preset leaves those rules out, rather than failing the whole config
 */
function checkJsxA11y(dir: string): boolean {
  const packages = ['eslint-plugin-jsx-a11y-x', 'eslint-plugin-jsx-a11y']
  if (packages.some((name) => isInstalledIn(name, dir))) {
    return true
  }
  warnOfSetupOnce(
    warnedJsxA11yDirs,
    dir,
    formatErrorMessage(
      [formatNames(['astro'])],
      `${formatNames(packages, { conjunction: 'or' })} isn't installed where ESLint runs, ${formatNames([dir])}, so the \`astro/jsx-a11y/*\` rules are off. Install it as a dev dependency there, as in \`${formatInstallCommand(['eslint-plugin-jsx-a11y-x'], dir)}\``,
    ),
    'GPAHAL_ASTRO_JSX_A11Y_MISSING',
  )
  return false
}

function withoutJsxA11yRules<T>(rules: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(rules).filter(([name]) => !name.startsWith('astro/jsx-a11y/')),
  )
}

/**
 * astro-eslint-parser gives template JSX the error type without `@types/react`, and `Astro.props`
 * in a page with `getStaticPaths` too. A frontmatter may `return Astro.redirect('/new')`, which
 * `unicorn/prefer-module` takes for CommonJS
 */
const ASTRO_TEMPLATE_RULES: TypedRules = {
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  '@typescript-eslint/restrict-template-expressions': 'off',
  'unicorn/prefer-module': 'off',
}

/**
 * `.astro` files get the TypeScript files' rules first, so the Astro parser set here wins. Their
 * virtual `<script>` files have no type information and get the browser code rules
 */
export async function astro({ untyped }: { untyped: Scope }): Promise<Array<TypedConfig>> {
  const eslintPluginAstro = await importPeers('astro', ASTRO_PEERS, async () =>
    interopDefault(import('eslint-plugin-astro')),
  )
  // Imported here, since every config imports this module, and typescript-eslint loads TypeScript
  const { configs: tsEslintConfigs, parser: tsEslintParser } = await import('typescript-eslint')
  const hasJsxA11y = checkJsxA11y(process.cwd())
  return withSetup('astro', [
    // Its own `files` match only TypeScript extensions, so extending it would match nothing
    {
      name: 'gpahal/astro/typescript-core-rules',
      files: ASTRO_FILES,
      rules: tsEslintConfigs.eslintRecommended.rules,
    },
    // Named `gpahal/astro/<upstream name or index>`, once per name. Without a jsx-a11y plugin,
    // the config stays without its rules, so composer calls naming it work anywhere
    ...uniqueBy(
      [
        ...eslintPluginAstro.configs['flat/recommended'],
        ...eslintPluginAstro.configs['flat/jsx-a11y-recommended'].map((config) =>
          config.name === undefined
            ? {
                ...config,
                name: 'jsx-a11y-recommended',
                ...(!hasJsxA11y && config.rules && { rules: withoutJsxA11yRules(config.rules) }),
              }
            : config,
        ),
      ].map((config: TypedConfig, index): TypedConfig => ({
        files: ASTRO_FILES,
        ...config,
        name: `gpahal/astro/${config.name ?? String(index)}`,
      })),
      (config) => config.name,
    ),
    // eslint-plugin-astro resolves the TypeScript parser from `process.cwd()`, which under pnpm
    // can't see this package's dependencies
    {
      name: 'gpahal/astro/parser',
      files: ASTRO_FILES,
      languageOptions: {
        parserOptions: {
          parser: tsEslintParser,
        },
      },
      processor: 'astro/client-side-ts',
      settings: {
        // The Astro parser can't parse TypeScript files that import-x reads. A path, since import-x
        // resolves a package name from ESLint's location, which under pnpm can't see ours
        'import-x/parsers': {
          [createRequire(import.meta.url).resolve('@typescript-eslint/parser')]:
            TYPED_CODE_EXTNS_WITH_DOT,
        },
      },
    },
    {
      name: 'gpahal/astro/rules',
      files: ASTRO_FILES,
      rules: {
        // `set:html` renders a string as HTML unescaped, as `innerHTML` does
        'astro/no-set-html-directive': 'error',
        // An `.astro` file's tsconfig may not set TypeScript up to report it
        'no-unreachable': 'error',
        ...(hasJsxA11y && {
          'astro/jsx-a11y/no-aria-hidden-on-focusable': 'error',
          'astro/jsx-a11y/lang': 'error',
        }),
      },
    },
    {
      name: 'gpahal/astro/templates',
      files: ASTRO_FILES,
      rules: ASTRO_TEMPLATE_RULES,
    },
    {
      name: 'gpahal/astro/script-parser',
      files: ASTRO_SCRIPT_FILES,
      languageOptions: {
        parser: tsEslintParser,
      },
    },
    // Node's globals are off, since `no-undef` is off in TypeScript and `@gpahal/no-node-globals`
    // reports them once
    browserConfig({
      name: 'gpahal/astro/scripts-browser',
      files: ASTRO_SCRIPT_FILES,
      isNodeGlobalsOff: true,
      message: 'Astro `<script>` blocks run in the browser, without Node',
    }),
    untypedConfusingBrowserGlobalsConfig(
      'gpahal/astro/scripts-untyped-confusing-globals',
      { files: ASTRO_SCRIPT_FILES },
      untyped,
    ),
  ])
}
