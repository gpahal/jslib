// Compiled by the package's `typecheck`, not run by Vitest, whose `include` is `*.test.ts`: the
// options and the composer are typed, and each `@ts-expect-error` marks a mistake the types catch

import type { ESLint, Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import * as z from 'zod/mini'

import {
  defineConfig,
  untyped,
  withoutFormattingRules,
  type Composer,
  type TypedConfig,
} from '@/index'
import type { AreaKeyChecks } from '@/internal/areas'

const root = import.meta.dirname

export const typedConfig = defineConfig({
  root,
  // `typescript.rules` takes the core rules too
  typescript: {
    rules: {
      'no-console': 'off',
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
    },
    rulesTypeAware: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  unicorn: { rules: { 'unicorn/filename-case': ['error', { case: 'camelCase' }] } },
  configs: [{ files: ['**/*.ts'], rules: { 'no-console': ['error', { allow: ['warn'] }] } }],
}).override('gpahal/typescript/rules', { rules: { 'no-var': 'off' } })

export const wrongRuleOptions = defineConfig({
  root,
  // @ts-expect-error `default` takes `array`, `generic` or `array-simple`
  typescript: { rules: { '@typescript-eslint/array-type': ['error', { default: 'list' }] } },
})

export const unknownRuleInRules = defineConfig({
  root,
  // @ts-expect-error no preset turns on a rule of this name
  unicorn: { rules: { 'unicorn/no-nul': 'error' } },
})

export const unknownRuleInConfigs = defineConfig({
  root,
  // @ts-expect-error no preset turns on a rule of this name
  configs: [{ files: ['**/*.ts'], rules: { 'no-consol': 'error' } }],
})

export const unknownRuleInComposer = defineConfig({ root })
  // @ts-expect-error no preset turns on a rule of this name
  .override('gpahal/typescript/rules', { rules: { 'no-vars': 'off' } })

/**
 * A config that registers a plugin of its own takes its rules
 */
const thirdPartyPlugin = { rules: {} } satisfies ESLint.Plugin

export const thirdPartyPluginConfig = defineConfig({
  root,
  configs: [{ plugins: { third: thirdPartyPlugin }, rules: { 'third/rule': 'error' } }],
})

export const unknownOption = defineConfig({
  root,
  // @ts-expect-error no option has this name
  reactt: true,
})

const globs: ReadonlyArray<string> = ['e2e/**/*.ts']

/**
 * Each list option takes a readonly array, which replaces its defaults, or a function of them
 */
export const listOptions = defineConfig({
  root,
  ignores: globs,
  testFiles: (defaults) => [...defaults, ...globs],
  commonjs: { files: (defaults) => [...defaults, 'scripts/*.js'] },
  typeAware: { allowDefaultProject: ['*.config.ts'] as const, ignores: ['generated/**'] as const },
  vitest: { files: globs },
  playwright: { files: (defaults) => [...defaults, 'tests/e2e/**'] },
  storybook: { files: globs },
  browser: { files: ['src/client/**'] as const },
  server: { files: (defaults) => [...defaults, 'src/server/**'] },
})

export const wrongCommonjsOption = defineConfig({
  root,
  // @ts-expect-error `commonjs` takes a boolean or an object with `files`
  commonjs: { files: true },
})

export const wrongListItem = defineConfig({
  root,
  // @ts-expect-error a list option takes strings
  ignores: [1],
})

// @ts-expect-error `root` is required
export const missingTsconfigRootDir = defineConfig({ react: true })

export const browserWithoutFiles = defineConfig({
  root,
  // @ts-expect-error `browser` needs `files`
  browser: {},
})

export const nestedExtendsTypo = defineConfig({
  root,
  configs: [
    {
      files: ['**/*.ts'],
      // @ts-expect-error no preset turns on a rule of this name, however deep the `extends`
      extends: [[{ extends: [{ rules: { 'no-consol': 'error' } }] }]],
    },
  ],
})

export const typescriptRuleInUnicorn = defineConfig({
  root,
  // @ts-expect-error `unicorn.rules` takes only `unicorn/` rules
  unicorn: { rules: { '@typescript-eslint/array-type': 'off' } },
})

/**
 * The package's own rules in the areas whose files they apply to
 */
export const ownRulesInAreas = defineConfig({
  root,
  javascript: { rules: { '@gpahal/no-esm-in-commonjs': 'off' } },
  typescript: { rules: { '@gpahal/no-inline-type-only-export': 'off' } },
  browser: { files: ['src/client/**'], rules: { '@gpahal/no-node-globals': 'off' } },
  server: { files: ['src/server/**'], rules: { '@gpahal/no-browser-globals': 'off' } },
})

export const serverRuleInBrowser = defineConfig({
  root,
  // @ts-expect-error `browser.rules` takes only `@gpahal/no-node-*` rules
  browser: { files: ['src/client/**'], rules: { '@gpahal/no-browser-globals': 'off' } },
})

export const misspelledConfigName = defineConfig({ root })
  // @ts-expect-error no config has this name
  .override('gpahal/typescript/rule', { rules: {} })

/**
 * A plugin's config array, nested as it comes
 */
export const nestedConfigs = defineConfig({
  root,
  configs: [tseslint.configs.recommended, [[{ files: ['**/*.ts'], rules: { 'no-var': 'off' } }]]],
})

/**
 * `untyped` takes a rule newer than the generated types
 */
export const untypedConfig = defineConfig({
  root,
  configs: [untyped({ files: ['**/*.ts'], rules: { 'unicorn/some-new-rule': 'error' } })],
})

/**
 * The runtime checks of an area's option keys are typed by its option type, so the two can't drift
 */
export const reactKeyChecks: AreaKeyChecks<'react'> = {
  scope: z.array(z.string()),
  refresh: z.boolean(),
  // @ts-expect-error `ReactOptions` has no such key
  other: z.boolean(),
}

// @ts-expect-error a check of `ReactOptions['refresh']` is missing
export const missingKeyCheck: AreaKeyChecks<'react'> = { scope: z.array(z.string()) }

export const removedRuleTypo: Composer = defineConfig({ root })
  // @ts-expect-error no preset turns on a rule of this name
  .removeRules('no-consol')

/**
 * A plugin's preset, typed loosely as plugins type them, whose rules include formatting rules
 */
declare const vendorPreset: Array<Linter.Config>

export const withoutFormattingRulesConfigs: Array<TypedConfig> =
  withoutFormattingRules(vendorPreset)

export const withoutFormattingRulesConfig = defineConfig({
  root,
  configs: [
    ...withoutFormattingRules({ rules: { 'max-len': 'error' } }),
    ...withoutFormattingRules([{ rules: { 'no-console': 'error' } }] as const),
  ],
})

export const silencedWarnings = defineConfig({
  root,
  warnings: { GPAHAL_COMMONJS_PACKAGE: false, GPAHAL_NO_TSCONFIG: true },
})

export const unknownWarning = defineConfig({
  root,
  // @ts-expect-error - Not a warning code
  warnings: { GPAHAL_COMMONJS: false },
})
