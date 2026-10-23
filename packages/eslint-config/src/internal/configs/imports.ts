import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import eslintPluginImportX, { createNodeResolver } from 'eslint-plugin-import-x'

import {
  CODE_BLOCK_FILES,
  CODE_EXTNS_WITH_DOT,
  COMMONJS_FILES,
  CONFIG_FILES,
  DECLARATION_FILES,
  REPO_SCRIPT_FILES,
  TEST_SETUP_FILES,
  TYPED_CODE_EXTNS_WITH_DOT,
  UNTYPED_CODE_FILES,
} from '@/internal/files'
import { intersectFiles, intersectFileSpecs, type FileSpecs, type Scope } from '@/internal/globs'
import { named } from '@/internal/naming'
import type { ImportsCyclesOptions, TypedConfig, TypedRules } from '@/internal/types'

/**
 * `**` alone never makes ESLint lint a file, so these reach only files other configs match.
 * `typescriptParser` parses the TypeScript files import-x reads, such as a dependency's `.d.ts`,
 * where the linted file's parser is ESLint's, as in a JavaScript-only project
 */
export function importsSettings({
  project,
  typescriptParser,
}: {
  project: Array<string>
  typescriptParser?: string | undefined
}): TypedConfig {
  return {
    name: 'gpahal/imports/settings',
    files: ['**/*'],
    settings: {
      ...(typescriptParser !== undefined && {
        'import-x/parsers': { [typescriptParser]: TYPED_CODE_EXTNS_WITH_DOT },
      }),
      'import-x/extensions': CODE_EXTNS_WITH_DOT,
      'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
      // Both skip `NODE_PATH`, which pnpm's bin shims set to the store's hoisted packages, so a
      // package the project doesn't depend on would resolve
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project,
          // The warning is about many projects' cost, which one tsconfig with `references` would
          // avoid, but listing each package's resolves the same `@/*` paths more simply
          noWarnOnMultipleProjects: true,
          nodePath: false,
        }),
        // The TypeScript resolver doesn't try extensionless imports of `.mjs`, `.cjs`, `.mts` and `.cts`
        createNodeResolver({ extensions: CODE_EXTNS_WITH_DOT, nodePath: false }),
      ],
    },
  }
}

/**
 * Build and test files may import another package's files by path, as a shared root config
 */
const DEV_IMPORT_RULES: TypedRules = {
  'import-x/no-relative-packages': 'off',
}

export function imports({
  files,
  typedFiles,
  testFiles,
  sourceGlobs,
  commonjsFiles,
  untyped,
  astro = false,
  cycles,
}: {
  files: Array<string>
  typedFiles: Array<string>
  testFiles: FileSpecs
  sourceGlobs: Array<string>
  commonjsFiles: FileSpecs
  untyped: Scope
  /**
   * No resolver finds Astro's virtual modules, such as `astro:content`
   */
  astro?: boolean | undefined
  /**
   * As an object when on
   */
  cycles?: ImportsCyclesOptions | undefined
}): Array<TypedConfig> {
  return [
    ...named('imports', { files }, [eslintPluginImportX.flatConfigs.recommended]),
    {
      name: 'gpahal/imports/rules',
      files,
      rules: {
        'import-x/first': 'error',
        'import-x/newline-after-import': 'error',
        'import-x/no-absolute-path': 'error',
        'import-x/no-mutable-exports': 'error',
        'import-x/no-named-default': 'error',
        'import-x/no-self-import': 'error',
        // `./a.css` and `./a.css?inline` load different modules in bundlers such as Vite
        'import-x/no-duplicates': ['error', { considerQueryString: true }],
        'import-x/no-amd': 'error',
        'import-x/no-webpack-loader-syntax': 'error',
        'import-x/no-anonymous-default-export': 'error',
        ...(astro && { 'import-x/no-unresolved': ['error', { ignore: ['^astro:'] }] }),
        // Build and test files may use dev dependencies. A command-line tool, such as `src/cli.js`,
        // runs for the package's users
        'import-x/no-extraneous-dependencies': [
          'error',
          {
            devDependencies: false,
            peerDependencies: true,
            optionalDependencies: true,
          },
        ],
        // It skips the other package's `exports`. Report-only: the fix's import may resolve elsewhere
        'import-x/no-relative-packages': 'error',
        'import-x/no-useless-path-segments': 'error',
        // They parse every module a JavaScript file imports, taking 12% and 9.5% of lint time, and
        // TypeScript checks the rest, so they're on only in `gpahal/imports/untyped`
        'import-x/namespace': 'off',
        'import-x/named': 'off',
      },
    },
    // Not in code blocks, whose relative imports name no files
    {
      name: 'gpahal/imports/untyped',
      files: intersectFiles(untyped.files, UNTYPED_CODE_FILES),
      ignores: [...(untyped.ignores ?? []), ...CODE_BLOCK_FILES],
      rules: {
        'import-x/namespace': 'error',
        'import-x/named': 'error',
      },
    },
    // ESLint's globs match dot folders, unlike import-x's `devDependencies` globs
    {
      name: 'gpahal/imports/dev-files',
      files: intersectFiles(files, [
        ...REPO_SCRIPT_FILES,
        '**/*.bench.*',
        '**/benchmarks/**',
        '**/*.stories.*',
        ...DECLARATION_FILES,
        '**/test-d/**',
        '**/e2e/**',
        '**/playwright/**',
        '**/cypress/**',
        '**/mocks/**',
        '**/test-utils.*',
        ...TEST_SETUP_FILES,
        '**/vitest.workspace.*',
        '**/.storybook/**',
        '**/.vitepress/**',
      ]),
      rules: {
        'import-x/no-extraneous-dependencies': [
          'error',
          { devDependencies: true, peerDependencies: true, optionalDependencies: true },
        ],
        ...DEV_IMPORT_RULES,
      },
    },
    // Outside a package's `src` folder, where a config file, such as `src/app/app.config.ts`, is
    // often app code. Its own config, since the rule's globs can't leave out a folder
    {
      name: 'gpahal/imports/config-files',
      files: CONFIG_FILES,
      ...(sourceGlobs.length > 0 && { ignores: sourceGlobs }),
      rules: {
        'import-x/no-extraneous-dependencies': [
          'error',
          { devDependencies: true, peerDependencies: true, optionalDependencies: true },
        ],
        ...DEV_IMPORT_RULES,
      },
    },
    // Not in the rule's `devDependencies`, which import-x resolves against ESLint's working
    // directory, unlike `files`
    {
      name: 'gpahal/imports/test-files',
      files: testFiles,
      rules: {
        'import-x/no-extraneous-dependencies': [
          'error',
          { devDependencies: true, peerDependencies: true, optionalDependencies: true },
        ],
        ...DEV_IMPORT_RULES,
      },
    },
    // `@gpahal/no-esm-in-commonjs` reports an ESM import in a script, and `import-x/first` would
    // hoist it. In a `.cts` file, `import = require` can follow code
    {
      name: 'gpahal/imports/commonjs',
      files: [
        ...intersectFiles(files, COMMONJS_FILES),
        ...intersectFileSpecs(files, commonjsFiles),
      ],
      rules: {
        'import-x/first': 'off',
        'import-x/newline-after-import': 'off',
      },
    },
    ...(cycles
      ? [
          {
            name: 'gpahal/imports/cycles',
            files,
            ignores: CODE_BLOCK_FILES,
            rules: {
              'import-x/no-cycle': [
                'error',
                {
                  ignoreExternal: true,
                  ...(cycles.maxDepth !== undefined && { maxDepth: cycles.maxDepth }),
                },
              ],
            },
          } satisfies TypedConfig,
        ]
      : []),
    {
      name: 'gpahal/imports/rules-typescript',
      files: typedFiles,
      rules: {
        'import-x/default': 'off',
        // TypeScript reports duplicate exports: TS2323 and TS2484
        'import-x/export': 'off',
        // False positives on `export =`, where the default import is the only runtime export
        'import-x/no-named-as-default': 'off',
        'import-x/no-named-as-default-member': 'off',
        'import-x/no-unresolved': 'off',
        // The default `import type { A, type B, C }` is rejected by TypeScript. `patchUnsafeFixes`
        // drops merges that leave invalid code
        'import-x/no-duplicates': ['error', { considerQueryString: true, 'prefer-inline': true }],
      },
    },
  ]
}
