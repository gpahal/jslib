import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolve } from 'import-meta-resolve'
import type { Config } from 'stylelint'

import { isArray, toArray } from '@gpahal/std/arrays'
import { formatMessage, formatNames, getErrorReason } from '@gpahal/std/errors'

import { checkIgnoreGlobs, checkProcessors, checkReferenceFiles, PREFIX } from '@/internal/options'
import type { StylelintReferenceFile, StylelintReferenceFiles } from '@/internal/rules'

/**
 * Read only own config keys even when Object.prototype has been polluted
 */
export function ownConfig<T extends object>(config: T): T {
  return { __proto__: null, ...config }
}

/**
 * The preset's file type overrides, whose slash-less globs Stylelint matches at any depth. They stay
 * unresolved, so a config applies them wherever it's extended from
 */
const portableOverrides = new WeakSet<object>()

export function portableOverride<T extends object>(override: T): T {
  portableOverrides.add(override)
  return override
}

export function isPortableOverride(override: object): boolean {
  return portableOverrides.has(override)
}

/**
 * A glob that matches only `path`, with each glob character in a class such as `[(]`. Stylelint
 * turns backslashes into slashes, so backslash escapes don't survive. `!` stays, since fast-glob
 * reads `[!]` as a negated class, and a bare `!` can't start an absolute path or precede a
 * classed `(`
 */
export function toLiteralGlob(path: string): string {
  return path.replaceAll(/[()*+?@[\]{}]/g, '[$&]')
}

/**
 * A root-relative glob with its negation and literal root preserved
 */
function absoluteGlob(glob: string, root: string): string {
  const negative = glob.startsWith('!')
  const pattern = negative ? glob.slice(1) : glob
  const absolute = path.isAbsolute(pattern)
    ? pattern
    : path.posix.join(toLiteralGlob(root.replaceAll('\\', '/')), pattern)
  return `${negative ? '!' : ''}${absolute}`
}

/**
 * `root`, then its real path when that differs. Stylelint matches globs against the path spelling
 * it's given, while `import.meta.dirname` is always the real path
 */
function rootSpellings(root: string): Array<string> {
  let real: string
  try {
    real = fs.realpathSync(root)
  } catch {
    return [root]
  }
  return real === root ? [root] : [root, real]
}

/**
 * {@link absoluteGlob} of `glob` for each of {@link rootSpellings}, so either spelling matches
 */
function matchingGlobs(glob: string, root: string): Array<string> {
  return [...new Set(rootSpellings(root).map((spelling) => absoluteGlob(glob, spelling)))]
}

/**
 * An override's `files` glob resolved from `root`. A positive slash-less glob stays, since
 * Stylelint matches it against the file name. A `\` counts as a `/`, as Stylelint turns it into one
 */
function overrideGlob(glob: string, root: string): Array<string> {
  return !glob.startsWith('!') && !/[/\\]/.test(glob) ? [glob] : matchingGlobs(glob, root)
}

export function overrideGlobs(files: string | ReadonlyArray<string>, root: string): Array<string> {
  return toArray(files).flatMap((glob) => overrideGlob(glob, root))
}

/**
 * The suffixes native Stylelint's `resolveSilent` tries, in order, as `fake-cfg/strict` for
 * `fake-cfg/strict.js`
 */
const PATH_SUFFIXES = ['', '.js', '.json', `${path.sep}index.js`, `${path.sep}index.json`]
const SPECIFIER_SUFFIXES = ['', '.js', '.json', '/index.js', '/index.json']

/**
 * The stats of `filename`, following symlinks, or `undefined` when it can't be read
 */
function statOf(filename: string): fs.Stats | undefined {
  try {
    return fs.statSync(filename, { throwIfNoEntry: false })
  } catch {
    return undefined
  }
}

function isFile(filename: string): boolean {
  return statOf(filename)?.isFile() === true
}

/**
 * A relative or absolute path, as opposed to a package specifier
 */
export function isPathEntry(entry: string): boolean {
  return entry.startsWith('./') || entry.startsWith('../') || path.isAbsolute(entry)
}

/**
 * The file that `specifier` names from `base`, as native Stylelint resolves it, trying each of
 * {@link PATH_SUFFIXES}. A path keeps `base` as given, so globs on it match through a symlinked
 * root. A package's `exports` apply to each suffixed specifier
 *
 * @throws Error of resolving `specifier` as given, such as `ERR_PACKAGE_PATH_NOT_EXPORTED` or
 *   `ERR_MODULE_NOT_FOUND`, when no suffix names a file.
 */
export function resolveModulePath(specifier: string, base: string): string | undefined {
  if (isPathEntry(specifier)) {
    const resolved = path.resolve(base, specifier)
    return PATH_SUFFIXES.map((suffix) => resolved + suffix).find((candidate) => isFile(candidate))
  }
  // The folder's URL, so a resolution error names the folder rather than a file there
  const parent = pathToFileURL(path.join(base, path.sep)).href
  let failure: { error: unknown } | undefined
  for (const [index, suffix] of SPECIFIER_SUFFIXES.entries()) {
    try {
      const url = new URL(resolve(specifier + suffix, parent))
      if (url.protocol === 'file:' && isFile(fileURLToPath(url))) {
        return fileURLToPath(url)
      }
    } catch (error) {
      if (index === 0) failure = { error }
    }
  }
  if (failure !== undefined) throw failure.error
  return undefined
}

function modulePath<T>(value: T, root: string, subject: string): T | string {
  if (typeof value !== 'string' || path.isAbsolute(value)) {
    return value
  }
  const fail = (description: string, cause?: unknown): never => {
    throw new TypeError(
      formatMessage(PREFIX, [formatNames([subject])], description),
      cause === undefined ? undefined : { cause },
    )
  }
  let resolved: string | undefined
  try {
    resolved = resolveModulePath(value, root)
  } catch (error) {
    return fail(`can't resolve ${formatNames([value])}: ${getErrorReason(error)}`, error)
  }
  return resolved ?? fail(`can't find ${formatNames([value])}`)
}

/**
 * Fresh config paths, so Stylelint can load them from any config folder
 */
export function normalizeConfigPaths(config: Config, root: string, subject = ''): Config {
  config = ownConfig(config)
  const at = (key: string): string => (subject === '' ? key : `${subject}.${key}`)
  if (config.ignoreFiles !== undefined) {
    checkIgnoreGlobs(config.ignoreFiles, at('ignoreFiles'))
  }
  if (config.referenceFiles !== undefined) {
    checkReferenceFiles(config.referenceFiles, at('referenceFiles'))
  }
  if (config.processors !== undefined) {
    checkProcessors(config.processors, at('processors'))
  }
  return {
    ...config,
    ...(config.customSyntax !== undefined && {
      customSyntax: modulePath(config.customSyntax, root, at('customSyntax')),
    }),
    ...(config.plugins !== undefined && {
      plugins: toArray(config.plugins).map((plugin, index) =>
        modulePath(plugin, root, at(`plugins[${index}]`)),
      ),
    }),
    ...(config.processors !== undefined && {
      processors: config.processors.map((processor, index) =>
        modulePath(processor, root, at(`processors[${index}]`)),
      ),
    }),
    ...(config.ignoreFiles !== undefined && {
      ignoreFiles: [
        ...new Set(
          toArray(config.ignoreFiles)
            .flatMap((glob) => matchingGlobs(glob, root))
            .toReversed(),
        ),
      ].toReversed(),
    }),
    ...(config.referenceFiles !== undefined && {
      referenceFiles: toArray(config.referenceFiles).map((entry, index) =>
        typeof entry === 'string'
          ? absoluteGlob(entry, root)
          : {
              ...entry,
              files:
                typeof entry.files === 'string'
                  ? absoluteGlob(entry.files, root)
                  : entry.files.map((glob) => absoluteGlob(glob, root)),
              ...(entry.customSyntax !== undefined && {
                customSyntax: modulePath(
                  entry.customSyntax,
                  root,
                  at(`referenceFiles[${index}].customSyntax`),
                ),
              }),
              ...(entry.loader !== undefined && {
                loader: modulePath(entry.loader, root, at(`referenceFiles[${index}].loader`)),
              }),
            },
      ),
    }),
    ...(config.overrides !== undefined && {
      overrides: config.overrides.map((override, index) =>
        normalizeOverride(override, root, at(`overrides[${index}]`)),
      ),
    }),
  }
}

/**
 * Check that each `referenceFiles` entry of paths without glob syntax names a path that exists,
 * since Stylelint otherwise fails with a stack trace on every run. An entry with a glob passes to
 * Stylelint unchecked, since matching it would walk the file system on every config load
 *
 * @throws TypeError when none of an entry's paths exists.
 */
export function checkReferencePathsExist(
  referenceFiles: StylelintReferenceFiles,
  root: string,
  name: string,
): void {
  const isList = isArray(referenceFiles)
  for (const [index, entry] of toArray<string | StylelintReferenceFile>(referenceFiles).entries()) {
    const entryName = isList ? `${name}[${index}]` : name
    const patterns = typeof entry === 'string' ? [entry] : toArray(entry.files)
    if (
      patterns.length === 0 ||
      patterns.some(
        (pattern) => isGlob(pattern) || statOf(path.resolve(root, pattern)) !== undefined,
      )
    ) {
      continue
    }
    const [single] = patterns
    const subject =
      typeof entry === 'string'
        ? entryName
        : typeof entry.files === 'string'
          ? `${entryName}.files`
          : `${entryName}.files[0]`
    throw new TypeError(
      single === undefined || patterns.length > 1
        ? formatMessage(
            PREFIX,
            [formatNames([`${entryName}.files`])],
            `none of ${formatNames(patterns)} exists. Create one of the files, or remove the entry`,
          )
        : formatMessage(
            PREFIX,
            [formatNames([subject])],
            `${formatNames([single])} doesn't exist. Create the file, or remove the entry`,
          ),
    )
  }
}

/**
 * Whether `pattern` has glob syntax as fast-glob, Stylelint's `referenceFiles` matcher, finds it
 */
function isGlob(pattern: string): boolean {
  return /[*?[\]{}]|^!|[!+@]\(/.test(pattern) || (pattern.includes('(') && pattern.includes('|'))
}

type Override = NonNullable<Config['overrides']>[number]

/**
 * {@link normalizeConfigPaths} of an override, with its `files` resolved from `root` unless it's
 * one of {@link portableOverrides}
 */
export function normalizeOverride(override: Override, root: string, subject: string): Override {
  const normalized = normalizeConfigPaths(override, root, subject)
  if (isPortableOverride(override)) {
    return { ...normalized, files: override.files }
  }
  const files = overrideGlobs(override.files, root)
  return {
    ...normalized,
    // A string stays a string when `root` has one spelling
    files: files.length === 1 && typeof override.files === 'string' ? (files[0] ?? files) : files,
  }
}
