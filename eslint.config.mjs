import rootPackage from './package.json' with { type: 'json' }
import { defineConfig } from './packages/eslint-config/build/index.js'

export default defineConfig({
  root: import.meta.dirname,
  // Linted by the eslint-config tests, with the presets each fixture is for
  ignores: (defaults) => [...defaults, 'packages/eslint-config/tests/fixtures'],
  node: true,
  turbo: true,
  vitest: true,
  typescript: { library: true },
  // `false` stops the `GPAHAL_FRAMEWORK_OPTION_UNSET` warnings that `packages/recipes`' dev
  // dependencies on Next.js and React raise. It installs them only for the setup recipes' projects
  nextjs: false,
  react: false,
  astro: false,
  antislop: true,
  // Keeps the repository's dependencies few
  e18e: { moduleReplacements: true },
  // internal's modules outside `src/node/` are browser-safe too
  browser: { files: ['packages/std/src/**', 'packages/internal/src/*.ts'] },
  configs: [
    {
      // `@gpahal/internal` is a dev dependency that tsdown bundles
      files: ['packages/*/src/**'],
      rules: {
        'import-x/no-extraneous-dependencies': [
          'error',
          {
            devDependencies: ['**/*.d.ts'],
            peerDependencies: true,
            optionalDependencies: true,
            whitelist: ['@gpahal/internal'],
          },
        ],
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@gpahal/internal/node/testing',
                message: "It's for tests only, and published source would bundle it",
              },
              {
                name: '@gpahal/internal/node/source-maps',
                message: "It's for builds and tests only, and published source would bundle it",
              },
            ],
          },
        ],
      },
    },
    {
      // std and its tests type-check with the ES2024 lib, which lacks ES2025's iterator helpers
      files: ['packages/std/**'],
      rules: {
        'unicorn/prefer-iterator-helpers': 'off',
        'unicorn/prefer-iterator-to-array': 'off',
        'unicorn/prefer-iterator-to-array-at-end': 'off',
      },
    },
    {
      // A package of tsconfig presets has no modules to export or to tree-shake
      files: ['packages/tsconfig/package.json'],
      rules: {
        'package-json/require-exports': 'off',
        'package-json/require-sideEffects': 'off',
      },
    },
    {
      // tsconfig ships only JSON, so has no `engines`, but its tests run on the repository's Node
      files: ['packages/tsconfig/**'],
      settings: { node: { version: rootPackage.engines.node } },
    },
  ],
})
