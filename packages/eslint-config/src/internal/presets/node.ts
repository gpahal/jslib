import type { ESLint, Rule } from 'eslint'

import { isNode } from '@/internal/ast'
import { esmTypescriptGlobals } from '@/internal/configs/commonjs'
import {
  CODE_BLOCK_FILES,
  COMMONJS_FILES,
  CONFIG_FILES,
  DECLARATION_FILES,
  REPO_SCRIPT_FILES,
  TYPED_CODE_FILES,
  TYPESCRIPT_FILES,
} from '@/internal/files'
import { findPatchTargets, hasPatchedFixes, patchCreateOnce } from '@/internal/fixes'
import { intersectFiles, intersectFileSpecs, type FileSpecs } from '@/internal/globs'
import { named, withSetup } from '@/internal/naming'
import { interopDefault } from '@/internal/peers'
import type { TypedConfig, TypedRules } from '@/internal/types'
import { withReport } from '@/internal/utils'

/**
 * Code blocks import packages that the project doesn't install
 */
export const NODE_CODE_BLOCK_RULES: TypedRules = {
  'n/no-extraneous-import': 'off',
  'n/no-extraneous-require': 'off',
  'n/no-missing-import': 'off',
  'n/no-missing-require': 'off',
  'n/no-unpublished-import': 'off',
  'n/no-unpublished-require': 'off',
}

/**
 * Astro `<script>` blocks run in the browser
 */
export async function nodeAstroScriptRules(): Promise<TypedRules> {
  const eslintPluginNode = await interopDefault(import('eslint-plugin-n'))
  return Object.fromEntries(
    Object.keys(eslintPluginNode.rules ?? {}).map((rule) => [`n/${rule}`, 'off']),
  )
}

/**
 * Config files and scripts run on the developer's Node, which this package's `engines.node` sets a
 * floor for, not the linted package's. Keep it equal to `engines.node`
 */
const DEV_NODE_VERSION = '>=24.22.0'

const UNSUPPORTED_FEATURES_RULES = [
  'no-unsupported-features/es-builtins',
  'no-unsupported-features/es-syntax',
  'no-unsupported-features/node-builtins',
]

const UNSUPPORTED_FEATURES_PATCHED = Symbol('@gpahal/eslint-config unsupported features in types')

/**
 * As in `Promise<Response>` and `interface A extends Request {}`
 */
const TYPE_NODE_KINDS = new Set([
  'TSClassImplements',
  'TSInterfaceDeclaration',
  'TSInterfaceHeritage',
  'TSTypeAliasDeclaration',
])

function isTypeNodeKind(kind: string): boolean {
  return (
    TYPE_NODE_KINDS.has(kind) ||
    (kind.startsWith('TSType') && kind !== 'TSTypeAssertion') ||
    (kind.startsWith('TS') && kind.endsWith('Type'))
  )
}

/**
 * TypeScript erases types, so no Node version runs them
 */
function isInType(descriptor: Rule.ReportDescriptor): boolean {
  let node: unknown = 'node' in descriptor ? descriptor.node : undefined
  while (isNode(node)) {
    if (isTypeNodeKind(node.type)) {
      return true
    }
    node = node.parent
  }
  return false
}

/**
 * Drops `no-unsupported-features/*` reports in types, such as `Promise<Response>`, which name a
 * global's type without using it. Only for the presets' configs' files
 */
function patchUnsupportedFeatures(plugin: ESLint.Plugin): void {
  const configs = [{ plugins: { n: plugin } }]
  for (const name of UNSUPPORTED_FEATURES_RULES) {
    for (const rule of findPatchTargets(`n/${name}`, configs, '')) {
      patchCreateOnce(rule, UNSUPPORTED_FEATURES_PATCHED, (create) => (context) => {
        if (!hasPatchedFixes(context)) {
          return create(context)
        }
        return create(
          withReport(context, (descriptor) => {
            if (!isInType(descriptor)) {
              context.report(descriptor)
            }
          }),
        )
      })
    }
  }
}

/**
 * Not `flat/recommended`, which picks a config for every file from the working directory's
 * `package.json` `type`
 */
export async function node({
  files,
  commonjs,
  sourceGlobs,
  typeStripping,
}: {
  files: FileSpecs
  commonjs: { files: FileSpecs; ignores: Array<string> }
  /**
   * Whose files keep the package's Node version
   */
  sourceGlobs: Array<string>
  typeStripping: boolean
}): Promise<Array<TypedConfig>> {
  const eslintPluginNode = await interopDefault(import('eslint-plugin-n'))
  patchUnsupportedFeatures(eslintPluginNode)
  return withSetup('node', [
    ...named('node', { files, ignores: [...commonjs.ignores, ...COMMONJS_FILES] }, [
      { ...eslintPluginNode.configs['flat/recommended-module'], name: 'flat/recommended-module' },
    ]),
    ...named(
      'node',
      {
        files: [
          ...intersectFiles(files, COMMONJS_FILES),
          ...intersectFileSpecs(files, commonjs.files),
        ],
      },
      [{ ...eslintPluginNode.configs['flat/recommended-script'], name: 'flat/recommended-script' }],
    ),
    {
      ...esmTypescriptGlobals('gpahal/node/esm-typescript-globals'),
      files: intersectFiles(files, ['**/*.{ts,mts,tsx}']),
    },
    {
      name: 'gpahal/node/typescript',
      files: intersectFiles(files, TYPED_CODE_FILES),
      rules: {
        // It checks a shebang against `bin`, which names the built file, so it reports a
        // `src/cli.ts` shebang, and `--fix` deletes it
        'n/hashbang': 'off',
      },
    },
    // Scripts run with `node scripts/x.js` or as `./scripts/x.js`, so a shebang is neither needed
    // nor wrong
    {
      name: 'gpahal/node/scripts',
      files: intersectFiles(files, REPO_SCRIPT_FILES),
      rules: {
        'n/hashbang': 'off',
      },
    },
    // Config files and scripts in a source folder, such as Angular's `src/app/app.config.ts`, often
    // run in the app
    {
      name: 'gpahal/node/dev-version',
      files: intersectFiles(files, [...CONFIG_FILES, ...REPO_SCRIPT_FILES]),
      ...(sourceGlobs.length > 0 && { ignores: sourceGlobs }),
      settings: {
        n: { version: DEV_NODE_VERSION },
      },
    },
    // TypeScript compiles `.cts` imports to `require()`, so they're parsed as modules
    {
      name: 'gpahal/node/cts',
      files: intersectFiles(files, ['**/*.cts']),
      languageOptions: {
        sourceType: 'module',
      },
    },
    {
      name: 'gpahal/node/rules',
      files,
      rules: {
        // It reports extensionless and `@/*` imports that TypeScript's `bundler` resolution allows
        'n/no-missing-import': 'off',
        // It reports `@/*` imports as unpublished packages, and type-only imports of dev
        // dependencies. `import-x/no-extraneous-dependencies` checks declarations
        'n/no-unpublished-import': 'off',
        // `__dirname + '/a'` uses the wrong separator on Windows
        'n/no-path-concat': 'error',
      },
    },
    // Not in `.tsx` or declaration files, which type stripping doesn't run, or in code blocks,
    // whose imports name no files
    ...(typeStripping
      ? [
          {
            name: 'gpahal/node/type-stripping',
            files: intersectFiles(files, TYPESCRIPT_FILES),
            ignores: [...CODE_BLOCK_FILES, ...DECLARATION_FILES],
            rules: {
              '@gpahal/no-js-specifier-for-ts': 'error',
              '@gpahal/no-unstrippable-syntax': 'error',
            },
          } satisfies TypedConfig,
        ]
      : []),
  ])
}
