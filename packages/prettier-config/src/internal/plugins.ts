import { createRequire } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  findInstalledPackage,
  missingPeersError,
  resolveFromNodeModules,
  resolvePath,
  type PackageFolder,
  type Resolve,
  type ResolvedModule,
} from '@gpahal/internal/node/resolve'
import {
  describeNewerThanRange,
  formatInstallHint,
  isAtLeast,
  isInsidersVersion,
  isNewerThanRange,
} from '@gpahal/internal/node/versions'
import {
  formatMessage,
  formatMessageList,
  formatNames,
  getErrorCode,
  getErrorMessage,
  getErrorReason,
} from '@gpahal/std/errors'

import { PREFIX, SORT_IMPORTS_PLUGIN, TAILWIND_PLUGIN } from '@/internal/merge'

/**
 * What the plugin paths depend on, replaced in tests to simulate another install
 */
export type PluginEnvironment = {
  resolve: Resolve
  /**
   * The package `name` installed at or above `parentPath`, read without resolving its entry. Walks
   * the folders as the Tailwind plugin and Prettier do, so unlike `require.resolve`, it ignores
   * `NODE_PATH`, which pnpm sets for package scripts
   */
  findPackage: (name: string, parentPath: string) => PackageFolder | undefined
  /**
   * The real path and version of the package `id` resolved from `parentPath`, or `undefined` when
   * it isn't installed there
   */
  resolveFrom: (id: string, parentPath: string) => ResolvedModule | undefined
}

/**
 * How prettier-plugin-tailwindcss 0.8's `resolveJsFrom` resolves a plugin: an ESM pass, then a CJS
 * pass when that throws. Each takes `exports` with its conditions, or else its main field, then
 * `index`, trying its extensions in order
 */
const RESOLVE_JS_PASSES = [
  { conditions: ['node', 'import'], mainFields: ['module'], extensions: ['.mjs', '.js'] },
  { conditions: ['node', 'require'], mainFields: ['main'], extensions: ['.js', '.cjs'] },
] as const

/**
 * @throws Error when neither pass resolves an installed package: the CJS pass's error, or an
 *   AggregateError of both when their messages differ.
 */
function resolveJsFrom(id: string, parentPath: string): ResolvedModule | undefined {
  const [esmPass, cjsPass] = RESOLVE_JS_PASSES
  try {
    return resolveFromNodeModules(id, parentPath, { prefix: PREFIX, ...esmPass })
  } catch (esmError) {
    try {
      return resolveFromNodeModules(id, parentPath, { prefix: PREFIX, ...cjsPass })
    } catch (cjsError) {
      // The CJS pass's message names only its own conditions and main field, so the ESM pass's
      // error, which can say why the module the plugin prefers doesn't resolve, is kept
      if (getErrorMessage(cjsError) === getErrorMessage(esmError)) {
        throw cjsError
      }
      throw new AggregateError([esmError, cjsError], getErrorMessage(cjsError), {
        cause: cjsError,
      })
    }
  }
}

export const DEFAULT_PLUGIN_ENVIRONMENT: PluginEnvironment = {
  resolve: (specifier) => import.meta.resolve(specifier),
  findPackage: (name, parentPath) => findInstalledPackage(name, parentPath, { prefix: PREFIX }),
  resolveFrom: resolveJsFrom,
}

/**
 * A path resolved from this package, since Prettier resolves a name from the working directory,
 * where this package's dependencies may not be installed
 * (https://github.com/prettier/prettier/issues/17565). Not the imported plugin: Prettier's CLI
 * logs the options with `JSON.stringify`, which calls the import sorter's parser getters, which
 * throw for plugins that aren't installed
 * (https://github.com/IanVS/prettier-plugin-sort-imports/issues/233)
 */
export function resolvePlugin(
  id: string,
  { resolve }: PluginEnvironment = DEFAULT_PLUGIN_ENVIRONMENT,
): string {
  return resolvePath(resolve, id)
}

/**
 * Node names a missing package in quotes, and a missing entry file of an installed one by its path
 */
function isPackageNotFound(error: unknown, id: string): boolean {
  const code = getErrorCode(error)
  return (
    (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') &&
    getErrorMessage(error).includes(`'${id}'`)
  )
}

const missingPeerErrors = new WeakSet<Error>()

/**
 * Run each resolver, so every missing plugin is reported at once rather than one per run.
 *
 * @throws AggregateError when more than one plugin isn't installed, or else the first error.
 */
export function resolvePeerPlugins(
  resolvers: ReadonlyArray<(() => string) | undefined>,
): Array<string | undefined> {
  const errors: Array<unknown> = []
  const paths = resolvers.map((resolve) => {
    try {
      return resolve?.()
    } catch (error) {
      errors.push(error)
      return undefined
    }
  })
  const [first] = errors
  if (errors.length === 0) {
    return paths
  }
  if (
    errors.length === 1 ||
    errors.some((error) => !(error instanceof Error && missingPeerErrors.has(error)))
  ) {
    throw first
  }
  const lead = `${PREFIX}: `
  throw new AggregateError(
    errors,
    formatMessageList(
      PREFIX,
      ['options'],
      errors.map((error) => {
        const message = getErrorMessage(error)
        return {
          subjects: [],
          description: message.startsWith(lead) ? message.slice(lead.length) : message,
        }
      }),
    ),
  )
}

/**
 * The config relies on the plugin's internals, such as how it composes the import sorter, which a
 * new 0.x minor can change
 */
const TAILWIND_RANGE = '>=0.8.0 <0.9.0'

/**
 * For the install command of a missing plugin. `tests/index.test.ts` checks them against
 * `peerDependencies`
 */
export const PEER_RANGES: Readonly<Record<string, string>> = {
  'prettier-plugin-astro': '^1.1',
  [TAILWIND_PLUGIN]: TAILWIND_RANGE,
}

/**
 * The install command uses the package manager of the project at or above `dir`, the working
 * directory by default.
 *
 * @throws Error naming the option and the package to install when it isn't installed, and naming
 *   the plugin when it fails to resolve otherwise.
 */
export function resolvePeerPlugin(
  option: string,
  id: string,
  environment: PluginEnvironment = DEFAULT_PLUGIN_ENVIRONMENT,
  dir?: string,
): string {
  try {
    return resolvePlugin(id, environment)
  } catch (error) {
    if (isPackageNotFound(error, id)) {
      const missing = missingPeersError([id], {
        prefix: PREFIX,
        option,
        cause: error,
        ranges: PEER_RANGES,
        dir,
      })
      missingPeerErrors.add(missing)
      throw missing
    }
    throw new Error(
      formatMessage(
        PREFIX,
        [formatNames([option])],
        `resolving ${formatNames([id])} failed: ${getErrorReason(error)}`,
      ),
      { cause: error },
    )
  }
}

const MIN_SORT_IMPORTS_VERSION = '4.7'

const MIN_TAILWIND_VERSION = '0.8'

function olderThan(name: string, version: unknown, minimum: string): string {
  const needed = `the ${minimum} this config needs`
  return typeof version === 'string'
    ? `\`${name}\` ${version} is older than ${needed}`
    : `\`${name}\`'s version couldn't be read to check that it's at least ${needed}`
}

/**
 * The peer range's lower bound
 */
const MIN_PRETTIER_VERSION = '3.9'

const warned = new Set<string>()

function warnOnce(message: string, code: string): void {
  if (warned.has(message)) {
    return
  }

  warned.add(message)
  process.emitWarning(message, { code })
}

/**
 * Warn once when the Prettier found from `parentPath` is older than 3.9
 */
export function warnOfPrettierVersion(
  environment: PluginEnvironment = DEFAULT_PLUGIN_ENVIRONMENT,
  dir?: string,
  parentPath: string = fileURLToPath(import.meta.url),
): void {
  const prettier = environment.findPackage('prettier', parentPath)
  const version = prettier?.version
  if (typeof version !== 'string' || isAtLeast(version, MIN_PRETTIER_VERSION)) {
    return
  }
  warnOnce(
    formatMessage(
      PREFIX,
      ['`prettier`'],
      `version ${version} is older than the ${MIN_PRETTIER_VERSION} this config needs, so some files may be formatted wrongly without an error. Install a newer version, as in \`${formatInstallHint('prettier', `^${MIN_PRETTIER_VERSION}`, dir ?? process.cwd())}\``,
    ),
    'GPAHAL_PRETTIER_OLD_PRETTIER',
  )
}

/**
 * Warns once when the plugin is newer than {@link TAILWIND_RANGE}. An insiders build is newer than
 * any release, and is taken without a warning.
 *
 * @throws Error as {@link resolvePeerPlugin} does, and TypeError when the plugin is older than
 *   0.8. Its version is read from its `node_modules` folder, so it isn't checked without one.
 */
export function resolveTailwindPlugin(
  environment: PluginEnvironment = DEFAULT_PLUGIN_ENVIRONMENT,
  dir?: string,
): string {
  const tailwindPath = resolvePeerPlugin('tailwindcss', TAILWIND_PLUGIN, environment, dir)
  // From its own file, the walk finds the plugin's own folder
  const tailwind = environment.findPackage(TAILWIND_PLUGIN, tailwindPath)
  if (tailwind === undefined || isInsidersVersion(tailwind.version)) {
    return tailwindPath
  }
  const { version } = tailwind
  if (!isAtLeast(version, MIN_TAILWIND_VERSION)) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`tailwindcss`'],
        `${olderThan(TAILWIND_PLUGIN, version, MIN_TAILWIND_VERSION)}. Install a newer version, as in \`${formatInstallHint(TAILWIND_PLUGIN, `^${MIN_TAILWIND_VERSION}`, dir ?? process.cwd())}\``,
      ),
    )
  }
  if (typeof version === 'string' && isNewerThanRange(version, TAILWIND_RANGE)) {
    warnOnce(
      formatMessage(
        PREFIX,
        ['`tailwindcss`'],
        describeNewerThanRange({
          name: TAILWIND_PLUGIN,
          version,
          range: TAILWIND_RANGE,
          effect: 'classes or imports may stay unsorted',
          dir: dir ?? process.cwd(),
        }),
      ),
      'GPAHAL_PRETTIER_UNTESTED_TAILWIND_PLUGIN',
    )
  }
  return tailwindPath
}

/**
 * The sorter is installed with `range` when one is installed but too old, since adding a direct
 * dependency without one keeps its existing range
 */
function sortImportsError(
  description: string,
  range: string | undefined,
  dir: string | undefined,
): TypeError {
  return new TypeError(
    formatMessage(
      PREFIX,
      ['`sortImports`'],
      `${description}, as in \`${formatInstallHint(SORT_IMPORTS_PLUGIN, range, dir ?? process.cwd())}\`, or set \`sortImports: false\``,
    ),
  )
}

const require = createRequire(import.meta.url)

/**
 * The import sorter at `sorterPath`, or this package's copy without one.
 *
 * @throws Error naming `sortImports` when the sorter fails to load.
 */
export function loadSorter(sorterPath: string = SORT_IMPORTS_PLUGIN): { options?: unknown } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The plugin exports `options` at runtime, but its declarations expose only `PluginConfig`
    return require(sorterPath) as { options?: unknown }
  } catch (error) {
    throw new Error(
      formatMessage(
        PREFIX,
        ['`sortImports`'],
        `loading the import sorter ${formatNames([sorterPath])} failed: ${getErrorReason(error)}`,
      ),
      { cause: error },
    )
  }
}

export type SortImportsPlugin = {
  /**
   * The `plugins` entry
   */
  entry: string
  /**
   * The path of the sorter Prettier loads for `entry`
   */
  path: string
}

/**
 * The import sorter's `plugins` entry with the Tailwind plugin at `tailwindPath`.
 * prettier-plugin-tailwindcss composes the sorter only when its entry is the sorter's name, a
 * plugin object with that `name`, or the exact path it resolves from its own location, and
 * otherwise leaves imports unsorted without an error, so the entry is that path.
 *
 * @throws TypeError when the Tailwind plugin can't load the sorter from its location, as under
 *   pnpm's `hoist: false` with `autoInstallPeers: false` and `dedupePeerDependents: false`, or
 *   loads one older than 4.7, where imports would stay unsorted.
 * @throws Error naming the sorter when its manifest can't be read or its entry doesn't resolve.
 */
export function resolveSortImportsPlugin(
  tailwindPath: string,
  environment: PluginEnvironment = DEFAULT_PLUGIN_ENVIRONMENT,
  dir?: string,
): SortImportsPlugin {
  const sorter = environment.resolveFrom(SORT_IMPORTS_PLUGIN, tailwindPath)
  if (sorter === undefined) {
    throw sortImportsError(
      `\`${TAILWIND_PLUGIN}\` can't load \`${SORT_IMPORTS_PLUGIN}\` from where it's installed, so imports would stay unsorted. Install it in your project`,
      undefined,
      dir,
    )
  }
  if (!isAtLeast(sorter.version, MIN_SORT_IMPORTS_VERSION)) {
    throw sortImportsError(
      `\`${TAILWIND_PLUGIN}\` loads \`${SORT_IMPORTS_PLUGIN}\` from where it's installed, and ${olderThan(SORT_IMPORTS_PLUGIN, sorter.version, MIN_SORT_IMPORTS_VERSION)}. Install a newer version`,
      `^${MIN_SORT_IMPORTS_VERSION}`,
      dir,
    )
  }
  return { entry: sorter.path, path: sorter.path }
}
