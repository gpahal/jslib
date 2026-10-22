import path from 'node:path'

import { ESLint, type Linter } from 'eslint'
import ts from 'typescript'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig, type EslintConfigOptions } from '@/index'
import { resolveOptions } from '@/internal/resolve'

export const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures')

export const BUILD_DIR = path.join(import.meta.dirname, '..', 'build')

/**
 * Sorts the same in every locale
 */
export const collator = new Intl.Collator('en')

/**
 * The config file that keeps a temporary project's ESLint lookup inside the project
 */
const CONFIG_FILE = { 'eslint.config.mjs': 'export default []\n' }

/**
 * A temporary project of `files`, with `CONFIG_FILE` unless `files` has a config file in its
 * folder
 */
export async function withProject(
  files: Record<string, string> = {},
): ReturnType<typeof withTmpProject> {
  const hasConfigFile = Object.keys(files).some((file) => /^eslint\.config\.[cm]?[jt]s$/.test(file))
  return withTmpProject('eslint-config', hasConfigFile ? files : { ...CONFIG_FILE, ...files })
}

/**
 * The core areas a test's config can turn off when it checks neither their rules nor their
 * loading. A fresh process loads the config about four times as fast without them
 */
export const CORE_AREAS_OFF = {
  unicorn: false,
  sonarjs: false,
  regexp: false,
  imports: false,
  antislop: false,
  packageJson: false,
  pnpm: false,
  markdown: false,
} as const satisfies Partial<EslintConfigOptions>

/**
 * `CORE_AREAS_OFF` as a spread in a config file's options object
 */
export const CORE_AREAS_OFF_SOURCE = `...${JSON.stringify(CORE_AREAS_OFF)}`

const SEVERITIES: Record<string, Linter.Severity> = { off: 0, warn: 1, error: 2 }
const SEVERITY_LEVELS: Array<Linter.Severity> = [0, 1, 2]

/**
 * A rule entry's severity as a number, such as `2` for `['error', options]`, or `undefined` for no
 * entry
 */
export function severityOf(entry: unknown): Linter.Severity | undefined {
  const severity: unknown = Array.isArray(entry) ? entry[0] : entry
  return typeof severity === 'string'
    ? SEVERITIES[severity]
    : SEVERITY_LEVELS.find((level) => level === severity)
}

/**
 * One path per kind of file the presets configure differently, including the virtual files of
 * code blocks and `<script>` blocks
 */
export const FILES = [
  'typescript/src/x.ts',
  'react/src/x.tsx',
  'react/src/x.jsx',
  'x.js',
  'x.mjs',
  'cjs/x.cjs',
  'typescript/src/x.mts',
  'typescript/src/x.cts',
  'typescript/src/x.d.ts',
  'typescript/src/x.test.ts',
  'typescript/e2e/x.spec.ts',
  'react/src/x.stories.tsx',
  'x.config.ts',
  'scripts/x.ts',
  'browser/src/x.ts',
  'server/src/x.ts',
  'astro/page.astro',
  'astro/page.astro/0_0.ts',
  'markdown/README.md',
  'markdown/README.md/0.tsx',
  'json/data.json',
  'json/tsconfig.json',
  'json/data.json5',
  'json/.vscode/settings.json',
  'yaml/workflow.yml',
  'yaml/pnpm-workspace.yaml',
  'yaml/package.json',
  'toml/wrangler.toml',
  'html/index.html',
]

export type ConfigOptions = Partial<EslintConfigOptions> & {
  /**
   * Added after the configs `defineConfig` returns
   */
  extraConfigs?: Array<Linter.Config>
}

/**
 * ESLint run from `dir`, a fixture's name or an absolute path, with the configs `defineConfig`
 * builds from `options` outside an editor. `root` is `dir` unless `options` sets it
 */
export async function createESLint(
  dir: string,
  options: ConfigOptions = {},
  eslintOptions: ESLint.Options = {},
): Promise<ESLint> {
  const cwd = path.resolve(FIXTURES_DIR, dir)
  const { extraConfigs = [], root = cwd, ...configOptions } = options
  return eslintWith(
    cwd,
    [...(await defineConfig({ root, isInEditor: false, ...configOptions })), ...extraConfigs],
    eslintOptions,
  )
}

const SHARED_ESLINTS = new Map<string, Promise<ESLint>>()

/**
 * The ESLint of `createESLint` for `fixture` and `options`, made once per test file. `options`
 * must be JSON, which keys the instance with `fix`, and the fixture's files must not change while
 * the tests run. With `fix`, it fixes `lintText` input and doesn't write files
 */
export async function sharedESLint(
  fixture: string,
  options: ConfigOptions = {},
  { fix = false }: { fix?: boolean } = {},
): Promise<ESLint> {
  const key = JSON.stringify([fixture, options, fix])
  let eslint = SHARED_ESLINTS.get(key)
  if (eslint === undefined) {
    eslint = createESLint(fixture, options, { fix })
    SHARED_ESLINTS.set(key, eslint)
  }
  return eslint
}

/**
 * The folder each ESLint of `eslintWith` runs from, which `lint` keys its results by
 */
const ESLINT_DIRS = new WeakMap<ESLint, string>()

/**
 * ESLint run from `cwd` with `configs` as they are, such as a composer's after its changes
 */
export function eslintWith(
  cwd: string,
  configs: Array<Linter.Config>,
  options: ESLint.Options = {},
): ESLint {
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: configs, ...options })
  ESLINT_DIRS.set(eslint, cwd)
  return eslint
}

/**
 * ESLint with every preset and option on, run from the fixtures
 */
export async function createAllPresetsESLint(): Promise<ESLint> {
  return createESLint(FIXTURES_DIR, {
    typescript: { library: true },
    browser: { files: ['browser/**'] },
    server: { files: ['server/**'] },
    antislop: true,
    pnpm: true,
    markdown: true,
    react: true,
    nextjs: true,
    astro: true,
    html: true,
    node: { typeStripping: true },
    turbo: true,
    vitest: true,
    playwright: true,
    storybook: true,
    tailwindcss: { entryPoint: 'tailwindcss/src/styles.css' },
  })
}

/**
 * The severity of `rule` for `file` as a number, or `undefined` when no config sets it
 */
export async function ruleSeverity(
  eslint: ESLint,
  file: string,
  rule: string,
): Promise<Linter.Severity | undefined> {
  const config = (await eslint.calculateConfigForFile(file)) as Linter.Config | undefined
  return severityOf(config?.rules?.[rule])
}

/**
 * A message as `rule: message`
 */
function formatMessage(message: Linter.LintMessage): string {
  return `${message.ruleId ?? 'fatal'}: ${message.message}`
}

/**
 * A message as its rule, or as its text when it has none, such as a parsing error
 */
export function ruleIdOf(message: Linter.LintMessage): string {
  return message.ruleId ?? message.message
}

/**
 * The messages for `files`, as `format` writes each, by each file's path relative to the folder
 * ESLint runs from. A file without messages has an empty list
 */
export async function lint(
  eslint: ESLint,
  files: Array<string>,
  format: (message: Linter.LintMessage) => string = formatMessage,
): Promise<Record<string, Array<string>>> {
  const dir = ESLINT_DIRS.get(eslint)
  if (dir === undefined) {
    throw new Error('lint takes an ESLint that createESLint or eslintWith made')
  }
  const results = await eslint.lintFiles(files)
  return Object.fromEntries(
    results.map((result) => [path.relative(dir, result.filePath), result.messages.map(format)]),
  )
}

/**
 * Each message for `code` linted as `filePath`, as `rule: message`
 */
export async function lintText(
  eslint: ESLint,
  filePath: string,
  code: string,
): Promise<Array<string>> {
  const results = await eslint.lintText(code, { filePath })
  return results.flatMap((result) => result.messages.map(formatMessage))
}

/**
 * The rule of each message for `code` linted as `filePath`, or its text when it has none, kept to
 * `rules` when given
 */
export async function lintRuleIds(
  eslint: ESLint,
  filePath: string,
  code: string,
  rules?: ReadonlyArray<string>,
): Promise<Array<string>> {
  const results = await eslint.lintText(code, { filePath })
  const ruleIds = results.flatMap((result) => result.messages.map(ruleIdOf))
  return rules === undefined ? ruleIds : ruleIds.filter((rule) => rules.includes(rule))
}

/**
 * The parsed files other than the checked one, such as TypeScript's libs, which every call of
 * `typeErrors` would parse again
 */
const TYPE_SOURCE_FILES = new Map<string, ts.SourceFile>()

/**
 * The TypeScript errors in `code` type-checked in memory as `filePath` with `options`, as
 * `TS<code>: <message>`. `filePath` needn't exist. Declaration files aren't checked, which takes
 * most of the time and finds nothing in the code under test
 */
export function typeErrors(
  filePath: string,
  code: string,
  compilerOptions: ts.CompilerOptions,
): Array<string> {
  const options = { ...compilerOptions, skipLibCheck: true }
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.readFile = (name) => (path.resolve(name) === filePath ? code : readFile(name))
  host.fileExists = (name) => path.resolve(name) === filePath || fileExists(name)
  host.getSourceFile = (name, languageVersion, ...rest) => {
    if (path.resolve(name) === filePath) {
      return getSourceFile(name, languageVersion, ...rest)
    }
    const key = `${JSON.stringify(languageVersion)}:${path.resolve(name)}`
    let sourceFile = TYPE_SOURCE_FILES.get(key)
    if (sourceFile === undefined) {
      sourceFile = getSourceFile(name, languageVersion, ...rest)
      if (sourceFile !== undefined) {
        TYPE_SOURCE_FILES.set(key, sourceFile)
      }
    }
    return sourceFile
  }
  const program = ts.createProgram({ rootNames: [filePath], options, host })
  return ts
    .getPreEmitDiagnostics(program)
    .map(
      (diagnostic) =>
        `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    )
}

/**
 * Warnings as `[message, code]`
 */
export type Warnings = Array<[message: string, code: string | undefined]>

/**
 * The warnings that `fn` emits, kept from the output. `fn` gets the list as it grows, to check it
 * before `fn` ends, and the list is complete once a promise that `fn` returns settles
 */
export function captureWarnings(fn: (warnings: Warnings) => Promise<unknown>): Promise<Warnings>
export function captureWarnings(fn: (warnings: Warnings) => unknown): Warnings
export function captureWarnings(fn: (warnings: Warnings) => unknown): Warnings | Promise<Warnings> {
  const warnings: Warnings = []
  const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation((warning, options) => {
    warnings.push([String(warning), typeof options === 'object' ? options.code : undefined])
  })
  let result: unknown
  try {
    result = fn(warnings)
  } catch (error) {
    emitWarning.mockRestore()
    throw error
  }
  if (result instanceof Promise) {
    return result.then(() => warnings).finally(() => emitWarning.mockRestore())
  }
  emitWarning.mockRestore()
  return warnings
}

/**
 * The warnings that resolving `options` for `root` emits, with the project scan's
 */
export function warningsOf(
  root: string,
  options: Omit<EslintConfigOptions, 'root'> = {},
): Warnings {
  return captureWarnings(() => {
    // As the composer's finalizer does, with `configs` as the methods leave them
    resolveOptions({ root, ...options }).warnOfProjectScan(options.configs ?? [])
  })
}
