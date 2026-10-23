// Compiled by `typecheck` with `exactOptionalPropertyTypes`: every optional option also takes
// `undefined`, as code that forwards an optional value of its own passes it

import { defineConfig, withoutFormattingRules } from '@gpahal/eslint-config'

export const withUndefinedOptions = defineConfig({
  root: import.meta.dirname,
  isInEditor: undefined,
  gitignore: { files: undefined },
  ignores: undefined,
  testFiles: undefined,
  commonjs: { files: undefined },
  typeAware: { javascript: undefined, allowDefaultProject: undefined, ignores: undefined },
  javascript: { rules: { 'no-console': undefined } },
  typescript: {
    rules: undefined,
    rulesTypeAware: undefined,
    library: undefined,
    exhaustiveSwitch: undefined,
    strictBooleanExpressions: undefined,
  },
  imports: { rules: undefined, removeUnused: undefined, cycles: { maxDepth: undefined } },
  unicorn: { rules: { 'unicorn/no-null': undefined } },
  regexp: { rules: undefined },
  sonarjs: { rules: undefined },
  commentLayout: { rules: undefined },
  e18e: {
    rules: undefined,
    modernization: undefined,
    moduleReplacements: undefined,
    performanceImprovements: undefined,
  },
  antislop: {
    rules: undefined,
    slop: { cwd: undefined },
    sonarjs: undefined,
    cognitiveComplexity: undefined,
  },
  eslintComments: { rules: undefined },
  jsdoc: { rules: undefined },
  json: { rules: undefined },
  yaml: { rules: undefined },
  pnpm: { rules: undefined },
  packageJson: { rules: undefined },
  markdown: { rules: undefined, math: undefined },
  react: { rules: undefined, scope: undefined, refresh: undefined, compiler: undefined },
  nextjs: { rules: undefined, scope: undefined, rootDir: undefined },
  astro: { rules: undefined },
  html: { rules: undefined },
  tailwindcss: {
    rules: undefined,
    scope: undefined,
    entryPoint: 'src/styles.css',
    settings: { detectComponentClasses: undefined },
  },
  node: { rules: undefined, scope: undefined, typeStripping: undefined },
  turbo: { rules: undefined },
  vitest: { rules: undefined, files: undefined },
  playwright: { rules: undefined, files: undefined },
  storybook: { rules: undefined, files: undefined },
  browser: undefined,
  server: undefined,
  allowFormattingRules: undefined,
  configs: [{ rules: undefined }],
  warnings: { GPAHAL_COMMONJS_PACKAGE: undefined },
})

export const withUndefinedWarnings = defineConfig({
  root: import.meta.dirname,
  warnings: undefined,
})

export const withUndefinedCodeFilesRules = defineConfig({
  root: import.meta.dirname,
  browser: { files: ['src/client/**'], rules: undefined },
  server: { files: ['src/server/**'], rules: undefined },
})

const globs: ReadonlyArray<string> = ['e2e/**/*.ts']

export const withListOptions = defineConfig({
  root: import.meta.dirname,
  ignores: [],
  testFiles: globs,
  typeAware: { allowDefaultProject: (defaults) => defaults, ignores: (defaults) => defaults },
  vitest: { files: globs },
})

export const withoutFormattingRulesUndefined = withoutFormattingRules({
  files: ['**/*.jsx'],
  rules: undefined,
})
