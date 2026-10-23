import { createHash } from 'node:crypto'
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

/**
 * The rules a test reads, by name or by a test of the name
 */
type RuleSelection = ReadonlySet<string> | ((ruleId: string) => boolean)

function isSelected(rules: RuleSelection, ruleId: string): boolean {
  return typeof rules === 'function' ? rules(ruleId) : rules.has(ruleId)
}

/**
 * `configs` with only the entries of `rules` in their `rules`. The severity and options of a rule
 * don't depend on the others' entries, and resolving a file's config merges and validates each
 * entry, which takes several times as long with every rule
 */
export function withRulesOnly(
  configs: ReadonlyArray<Linter.Config>,
  rules: RuleSelection,
): Array<Linter.Config> {
  return configs.map((config) =>
    config.rules === undefined
      ? config
      : {
          ...config,
          rules: Object.fromEntries(
            Object.entries(config.rules).filter(([ruleId]) => isSelected(rules, ruleId)),
          ),
        },
  )
}

/**
 * ESLint run from `cwd` with `configs` as `eslintWith` takes them, with only `rules` in the configs
 * and running. For a test that reads only those rules' reports and entries: a twin that
 * `DUPLICATE_REPORTS` drops where its kept rule reports needs that rule selected too
 */
export function focusedESLintWith(
  cwd: string,
  configs: ReadonlyArray<Linter.Config>,
  rules: RuleSelection,
  options: ESLint.Options = {},
): ESLint {
  return eslintWith(cwd, withRulesOnly(configs, rules), {
    ruleFilter: ({ ruleId }) => isSelected(rules, ruleId),
    ...options,
  })
}

/**
 * ESLint as `createESLint` makes it, focused on `rules` as `focusedESLintWith` is
 */
export async function createFocusedESLint(
  dir: string,
  rules: RuleSelection,
  options: ConfigOptions = {},
  eslintOptions: ESLint.Options = {},
): Promise<ESLint> {
  const cwd = path.resolve(FIXTURES_DIR, dir)
  const { extraConfigs = [], root = cwd, ...configOptions } = options
  const configs = await defineConfig({ root, isInEditor: false, ...configOptions })
  return focusedESLintWith(cwd, [...configs, ...extraConfigs], rules, eslintOptions)
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
 * Every preset and option on, for the fixtures
 */
export const ALL_PRESETS_OPTIONS: Partial<EslintConfigOptions> = {
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
}

/**
 * ESLint with `ALL_PRESETS_OPTIONS`, run from the fixtures, with `overrides` replacing those
 * options
 */
export async function createAllPresetsESLint(overrides: ConfigOptions = {}): Promise<ESLint> {
  return createESLint(FIXTURES_DIR, { ...ALL_PRESETS_OPTIONS, ...overrides })
}

/**
 * Each file of `FILES`' config with every preset on, resolved once per worker for the tests that
 * read it
 */
const allPresetsConfigs: { promise?: Promise<Map<string, Linter.Config | undefined>> } = {}

export async function getAllPresetsConfigs(): Promise<Map<string, Linter.Config | undefined>> {
  allPresetsConfigs.promise ??= (async () => {
    const eslint = await createAllPresetsESLint()
    const configs = new Map<string, Linter.Config | undefined>()
    for (const file of FILES) {
      configs.set(
        file,
        (await eslint.calculateConfigForFile(path.join(FIXTURES_DIR, file))) as
          Linter.Config | undefined,
      )
    }
    return configs
  })()
  return allPresetsConfigs.promise
}

/**
 * Lists longer than this are snapshotted as a count and a hash: the browser globals from the
 * `globals` package, over a thousand, would otherwise make up most of the snapshot
 */
const MAX_LISTED_ITEMS = 100

/**
 * `<N items, sha256 …>` for a list over {@link MAX_LISTED_ITEMS}, else `list`
 */
function abbreviated(list: Array<unknown>): unknown {
  return list.length > MAX_LISTED_ITEMS
    ? `<${String(list.length)} items, sha256 ${createHash('sha256')
        .update(JSON.stringify(list, plain))
        .digest('hex')
        .slice(0, 12)}>`
    : list
}

/**
 * Regexes and functions, which JSON can't show, as text, and paths under the fixtures folder
 * starting with `<fixtures>`, so the snapshot doesn't depend on where the repository is
 */
function plain(_key: string, value: unknown): unknown {
  return typeof value === 'function' || value instanceof RegExp
    ? String(value)
    : typeof value === 'string'
      ? value.replaceAll(FIXTURES_DIR, '<fixtures>')
      : value
}

/**
 * Each rule that is on, with its severity and options on one line
 */
export function inventoryOf(config: Linter.Config | undefined): Map<string, string> {
  const entries = Object.entries(config?.rules ?? {}).flatMap(([rule, entry]) => {
    const severity = severityOf(entry)
    if (severity === undefined || severity === 0) {
      return []
    }
    const options: Array<unknown> = Array.isArray(entry) ? entry.slice(1) : []
    // Some rules take each list item as an option of its own
    const shown = options.length > MAX_LISTED_ITEMS ? [abbreviated(options)] : options
    const formatted = JSON.stringify([severity, ...shown], (key, value: unknown) =>
      key !== '' && Array.isArray(value) ? abbreviated(value) : plain(key, value),
    )
    return [[rule, formatted] as const]
  })
  return new Map(entries.toSorted(([a], [b]) => collator.compare(a, b)))
}

export function listOf(inventory: Map<string, string>): Array<string> {
  return Array.from(inventory, ([rule, entry]) => `${rule}: ${entry}`)
}

/**
 * The rules of `inventory` that differ from `reference`: `+ rule: entry` for one only `inventory`
 * has on, `- rule` for one only `reference` has on, and `~ rule: entry` for one with another entry
 */
export function diffOf(
  reference: Map<string, string>,
  inventory: Map<string, string>,
): Array<string> {
  const lines: Array<string> = []
  const rules = new Set([...reference.keys(), ...inventory.keys()])
  for (const rule of rules) {
    const before = reference.get(rule)
    const after = inventory.get(rule)
    if (after === undefined) {
      lines.push(`- ${rule}`)
    } else if (before === undefined) {
      lines.push(`+ ${rule}: ${after}`)
    } else if (before !== after) {
      lines.push(`~ ${rule}: ${after}`)
    }
  }
  return lines.toSorted((a, b) => collator.compare(a.slice(2), b.slice(2)))
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
 * The diagnostics of type-checking `dir`'s TypeScript files with its `tsconfig.json`, so a fix that
 * leaves invalid TypeScript fails, as in `TS1234 src/file.ts: message`
 */
export function typeCheck(dir: string): Array<string> {
  const read = ts.readConfigFile(path.join(dir, 'tsconfig.json'), (file) => ts.sys.readFile(file))
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  }
  const config: unknown = read.config
  const { options, fileNames, errors } = ts.parseJsonConfigFileContent(config, ts.sys, dir)
  if (errors.length > 0) {
    throw new Error(
      errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'),
    )
  }
  const program = ts.createProgram({
    rootNames: fileNames.filter((file) => /\.[cm]?tsx?$/u.test(file)),
    // TypeScript's own libs can't hold an error that a fix made, and checking them takes most of
    // the time
    options: { ...options, noEmit: true, skipDefaultLibCheck: true },
  })
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(
    (diagnostic) =>
      `TS${String(diagnostic.code)} ${diagnostic.file === undefined ? '' : path.relative(dir, diagnostic.file.fileName)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
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
