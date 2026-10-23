import { AsyncLocalStorage } from 'node:async_hooks'
import process from 'node:process'
import { isMainThread, workerData } from 'node:worker_threads'

import type { ESLint, Linter } from 'eslint'

import { describeValue, formatMessage } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import type { TypedConfig } from '@/internal/types'

export const PREFIX = '@gpahal/eslint-config'

/**
 * In the shape of `formatMessage` from `@gpahal/std/errors`
 */
export function formatErrorMessage(subjects: ReadonlyArray<string>, description: string): string {
  return formatMessage(PREFIX, subjects, description)
}

export function fail(subjects: ReadonlyArray<string>, description: string): never {
  throw new TypeError(formatErrorMessage(subjects, description))
}

/**
 * From the `workerData` that ESLint's `lib/eslint/eslint.js` gives its `--concurrency` workers.
 * The `--concurrency` test of editor.test.ts, which checks the warning is given once, fails when it
 * changes
 */
function isESLintWorker(): boolean {
  return (
    !isMainThread &&
    isRecord(workerData) &&
    'eslintOptionsOrURL' in workerData &&
    'filePathIndexArray' in workerData
  )
}

/**
 * One per row of the README's Warnings table
 */
export const WARNING_CODES = [
  'GPAHAL_FRAMEWORK_OPTION_UNSET',
  'GPAHAL_COMMONJS_PACKAGE',
  'GPAHAL_NO_TSCONFIG',
  'GPAHAL_FILES_OUTSIDE_TSCONFIG',
  'GPAHAL_DEFAULT_PROJECT_NODE_TYPES',
  'GPAHAL_LARGE_DEFAULT_PROJECT',
  'GPAHAL_ASTRO_TYPES_MISSING',
  'GPAHAL_ASTRO_JSX_A11Y_MISSING',
  'GPAHAL_PLAYWRIGHT_FILES_UNMATCHED',
  'GPAHAL_GITIGNORE_WILDCARDS',
  'GPAHAL_ROOT_GITIGNORED',
  'GPAHAL_PEER_NEWER_THAN_RANGE',
  'GPAHAL_SONARJS_TYPESCRIPT_COPY',
] as const

export type GpahalWarningCode = (typeof WARNING_CODES)[number]

/**
 * Per `defineConfig` call, so two configs of one process, as in an editor's server, stay apart, and
 * the codes follow the call into the presets' async loading
 */
const silencedWarnings = new AsyncLocalStorage<ReadonlySet<string>>()

/**
 * Also in what `fn` starts that runs later. Anything but a plain object silences nothing
 */
export function withWarnings<T>(warnings: unknown, fn: () => T): T {
  const silenced = isRecord(warnings)
    ? new Set(Object.keys(warnings).filter((code) => warnings[code] === false))
    : new Set<string>()
  return silencedWarnings.run(silenced, fn)
}

/**
 * For a callback that runs later, such as the composer's finalizer
 */
export function bindWarnings<F extends (...args: Array<never>) => unknown>(fn: F): F {
  return AsyncLocalStorage.bind(fn)
}

/**
 * Not from ESLint's `--concurrency` workers, which each load the config again while the main thread
 * warns for them. Other worker threads warn, since ESLint can run in one entirely, as in
 * vite-plugin-checker. Returns whether it emitted the warning
 */
export function warnOfSetup(message: string, code: GpahalWarningCode): boolean {
  if (isESLintWorker() || silencedWarnings.getStore()?.has(code) === true) {
    return false
  }
  process.emitWarning(message, { code })
  return true
}

/**
 * `key` is added only once the warning is emitted, so one config's silenced warning still reaches
 * another config of the process
 */
export function warnOfSetupOnce(
  warned: Set<string>,
  key: string,
  message: string,
  code: GpahalWarningCode,
): void {
  if (!warned.has(key) && warnOfSetup(message, code)) {
    warned.add(key)
  }
}

const README_URL = 'https://github.com/gpahal/jslib/tree/main/packages/eslint-config'

export function getDocsUrl(anchor: string): string {
  return `${README_URL}#${anchor}`
}

/**
 * The context is frozen, so an object with it as prototype gets its own `report`. Configurable,
 * since a proxy of the context, as eslint-json-compat-utils makes, may return another function for
 * it, which a proxy can't do for a non-writable, non-configurable property
 */
export function withReport<Context extends { report: unknown }>(
  context: Context,
  report: Context['report'],
): Context {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `Object.create` returns `any`, and the object is the context with another `report`
  return Object.create(context, { report: { value: report, configurable: true } }) as Context
}

/**
 * For a companion rule run beside a patched rule, with its own `id` and no options
 */
export function withCompanionContext<Context extends { report: unknown }>(
  context: Context,
  ruleId: string,
  report: Context['report'],
): Context {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `Object.create` returns `any`, and the object is the context with another `report`, `options` and `id`
  return Object.create(context, {
    report: { value: report, configurable: true },
    options: { value: [], configurable: true },
    id: { value: ruleId, configurable: true },
  }) as Context
}

/**
 * Plugins type configs loosely, as flat or legacy configs
 */
export function getPluginConfig(
  plugin: Pick<ESLint.Plugin, 'configs'>,
  name: string,
): Linter.Config | Linter.LegacyConfig {
  const config = plugin.configs?.[name]
  if (config === undefined || Array.isArray(config)) {
    fail(
      [`plugin config \`${name}\``],
      `expected a config object, received ${describeValue(config)}`,
    )
  }
  return config
}

/**
 * A config of yours may register the stock plugin in the wrapped one's place
 */
const STOCK_PLUGINS = new WeakMap<ESLint.Plugin, ESLint.Plugin>()

export function registerWrappedPlugin(preset: ESLint.Plugin, stock: ESLint.Plugin): ESLint.Plugin {
  STOCK_PLUGINS.set(preset, stock)
  return preset
}

export function isPresetPlugin(plugin: unknown, preset: ESLint.Plugin): boolean {
  const stock = STOCK_PLUGINS.get(preset)
  return plugin === preset || (stock !== undefined && plugin === stock)
}

/**
 * ESLint would reject the stock plugin as a second plugin of that name. `checkPresetPlugins` throws
 * on any other plugin of that name
 */
export function withPresetPlugin(
  configs: Array<TypedConfig>,
  name: string,
  preset: ESLint.Plugin,
): Array<TypedConfig> {
  const stock = STOCK_PLUGINS.get(preset)
  return configs.map((config) =>
    stock !== undefined && config.plugins?.[name] === stock
      ? { ...config, plugins: { ...config.plugins, [name]: preset } }
      : config,
  )
}
