/**
 * Module resolution for the packages' own dependencies and optional peers. `resolvePath` and
 * `isResolvable` take the caller's `import.meta.resolve`, so a package resolves from itself, as its bundled build does,
 * not from `@gpahal/internal`. {@link resolveFromNodeModules} resolves from a given file instead,
 * such as a user's stylesheet. Contract: package names from the packages' own code, and absolute
 * paths
 */

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { describeValue, formatMessage, formatNames, getErrorReason } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import { readJsonFile } from '@/node/json'
import { formatInstallCommand } from '@/node/package-manager'

/**
 * Resolves a specifier to a URL, as the caller's `import.meta.resolve` does. Pass it as
 * `(specifier) => import.meta.resolve(specifier)`, which keeps it bound to the caller's module
 */
export type Resolve = (specifier: string) => string

/**
 * The absolute path of the module `id`
 *
 * @throws If `id` doesn't resolve.
 */
export function resolvePath(resolve: Resolve, id: string): string {
  return fileURLToPath(resolve(id))
}

export function isResolvable(resolve: Resolve, id: string): boolean {
  try {
    resolve(id)
    return true
  } catch {
    return false
  }
}

export type MissingPeersContext = {
  prefix: string
  /**
   * The option that needs the packages, such as `tailwindcss`
   */
  option: string
  cause?: unknown
  /**
   * Version ranges for the install command. Packages without one keep their bare names
   */
  ranges?: Readonly<Record<string, string>> | undefined
  /**
   * The folder whose package manager the install command uses, `process.cwd()` by default
   */
  dir?: string | undefined
}

/**
 * Characters that need no quoting in sh, zsh, PowerShell or cmd.exe. Not `^`, which zsh with
 * `extended_glob` reads as a glob, and cmd.exe as its escape character
 */
const UNQUOTED_SPECIFIER_REGEX = /^[\w@/.-]+$/u

/**
 * Characters that sh and zsh still expand inside double quotes, and `%`, which cmd.exe does
 */
const DOUBLE_QUOTE_EXPANDED_REGEX = /["$`\\!%]/u

/**
 * A package and optional range as one shell argument in an install command: bare when safe, else
 * in double quotes, which work the same in sh, zsh, PowerShell and cmd.exe. One with a character
 * that double quotes would expand, which no real range has, is single-quoted for POSIX shells
 */
export function formatPeerSpecifier(name: string, range?: string): string {
  const specifier = range === undefined ? name : `${name}@${range}`
  if (UNQUOTED_SPECIFIER_REGEX.test(specifier)) {
    return specifier
  }
  return DOUBLE_QUOTE_EXPANDED_REGEX.test(specifier)
    ? `'${specifier.replaceAll("'", String.raw`'\''`)}'`
    : `"${specifier}"`
}

/**
 * The error for optional peer dependencies of an option that aren't installed: "@scope/config:
 * `react`: needs `a` and `b`, which aren't installed. Install them as dev dependencies, as in
 * `pnpm add -D a b`", or `npm install -D a b` in an npm project. Contract: at least one package
 */
export function missingPeersError(
  packages: ReadonlyArray<string>,
  { prefix, option, cause, ranges, dir = process.cwd() }: MissingPeersContext,
): Error {
  const isOne = packages.length === 1
  const message = formatMessage(
    prefix,
    [formatNames([option])],
    `needs ${formatNames(packages, { conjunction: 'and' })}, which ${isOne ? "isn't" : "aren't"} installed. Install ${isOne ? 'it as a dev dependency' : 'them as dev dependencies'}, as in \`${formatInstallCommand(
      packages.map((name) => formatPeerSpecifier(name, ranges?.[name])),
      dir,
    )}\``,
  )
  return cause === undefined ? new Error(message) : new Error(message, { cause })
}

export type PackageFolder = {
  /**
   * The package's folder in the `node_modules` folder it was found in, which may be a symlink
   */
  dir: string
  /**
   * The manifest's `version`, unchecked, or `undefined` when the manifest isn't an object
   */
  version: unknown
}

export type ResolvedModule = {
  /**
   * The real absolute path of the package's entry, or of a subpath it exports
   */
  path: string
  /**
   * The manifest's `version`, unchecked, or `undefined` when the manifest isn't an object
   */
  version: unknown
}

export type FindInstalledPackageContext = {
  prefix: string
}

/**
 * Giving any of `conditions`, `mainFields` or `extensions` resolves as bundlers such as
 * enhanced-resolve do, rather than as `require.resolve` does
 */
export type ResolveFromNodeModulesContext = FindInstalledPackageContext & {
  /**
   * The conditions that select `exports` targets, beside `default`, such as `['node', 'import']`.
   * Default is `['node', 'require', 'module-sync']`, the ones `require.resolve` matches
   */
  conditions?: ReadonlyArray<string> | undefined
  /**
   * The fields that name the entry of a package without `exports`, in order, such as
   * `['module', 'main']`. Default is `['main']`
   */
  mainFields?: ReadonlyArray<string> | undefined
  /**
   * The extensions tried, in order, for a path or `exports` target without one and for a folder's
   * `index`. Default is `['.js', '.mjs', '.cjs', '.json']`
   */
  extensions?: ReadonlyArray<string> | undefined
}

/**
 * The package `name` installed in a `node_modules` folder at or above the folder of `parentPath`,
 * or `undefined` when there is none or `name` isn't a valid npm package name. It walks the folders
 * as {@link resolveFromNodeModules} does, but doesn't resolve the entry, so it finds a package
 * whose entry is missing too.
 *
 * @throws Error naming the manifest when it can't be read, with the read error as the `cause`.
 */
export function findInstalledPackage(
  name: string,
  parentPath: string,
  { prefix }: FindInstalledPackageContext,
): PackageFolder | undefined {
  const found = getPackageName(name) === name ? findManifest(name, parentPath, prefix) : undefined
  return found === undefined
    ? undefined
    : { dir: found.packageDir, version: getVersion(found.manifest) }
}

/**
 * The file that `specifier`, a package name with an optional subpath such as
 * `tailwindcss/theme.css`, names in the nearest `node_modules` folder at or above the folder of
 * `parentPath`, or `undefined` when there is none or `specifier` doesn't start with a valid npm
 * package name. It walks the folders as Node's resolvers do, skipping folders named
 * `node_modules`, but never falls back to `NODE_PATH`, which pnpm sets for package scripts, or the
 * global folders.
 *
 * The path is the real one that `require.resolve` gives from the `node_modules` folder holding the
 * package, so the project's self-reference doesn't apply. With `context.conditions`,
 * `context.mainFields` or `context.extensions`, it resolves in the package's folder as
 * enhanced-resolve does: through `exports` with the conditions, or else the first main field that
 * names a file, then `index`, trying the extensions for a path or `exports` target without one, and
 * a folder's own `package.json` main fields, then its `index`.
 *
 * @throws Error naming the manifest when it can't be read, or naming `specifier` when it doesn't
 *   resolve in the package found, such as a subpath it doesn't export or lacks, which Node would
 *   look for in the folders above. The underlying error, if any, is the `cause`.
 */
export function resolveFromNodeModules(
  specifier: string,
  parentPath: string,
  { prefix, conditions, mainFields, extensions }: ResolveFromNodeModulesContext,
): ResolvedModule | undefined {
  const name = getPackageName(specifier)
  if (name === undefined) {
    return undefined
  }
  const found = findManifest(name, parentPath, prefix)
  if (found === undefined) {
    return undefined
  }
  const { dir, packageDir, manifest } = found
  const fail = (reason: string, cause?: unknown): never => {
    throw new Error(
      formatMessage(
        prefix,
        [formatNames([specifier])],
        `resolving it from ${formatNames([dir])} failed: ${reason}`,
      ),
      cause === undefined ? undefined : { cause },
    )
  }
  let resolution: Resolution
  let realPackageDir: string
  try {
    // Node gives real paths, so a symlinked package, as pnpm installs them, compares by its own
    realPackageDir = fs.realpathSync(packageDir)
    const useNode = conditions === undefined && mainFields === undefined && extensions === undefined
    // From a file in the `node_modules` folder holding the package, or its scope folder, Node
    // looks in that folder, and finds no `package.json` whose self-reference would apply first.
    // For a package named like a builtin, such as `events`, it gives the builtin's id instead
    const nodePath = useNode
      ? createRequire(path.join(path.dirname(packageDir), 'noop.js')).resolve(specifier)
      : undefined
    if (nodePath !== undefined && path.isAbsolute(nodePath)) {
      // Real-pathed, since under `--preserve-symlinks` `require.resolve` keeps the symlinks
      resolution = { path: fs.realpathSync(nodePath) }
    } else {
      resolution = resolveInPackage(
        { name, dir: packageDir, manifest },
        `.${specifier.slice(name.length)}`,
        {
          conditions: [...(conditions ?? ['node', 'require', 'module-sync']), 'default'],
          mainFields: mainFields ?? ['main'],
          extensions: extensions ?? DEFAULT_EXTENSIONS,
          tryExportsExtensions: !useNode,
        },
      )
      if ('path' in resolution) {
        resolution = { path: fs.realpathSync(resolution.path) }
      }
    }
  } catch (error) {
    return fail(getErrorReason(error), error)
  }
  // Outside the `try`, which would wrap this error in another
  if ('reason' in resolution) {
    return fail(resolution.reason, resolution.cause)
  }
  const resolved = resolution.path
  // A package without `exports` that lacks the subpath lets Node go on to the `node_modules`
  // folders above and `NODE_PATH`, which would find another copy, of another version
  const relative = path.relative(realPackageDir, resolved)
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? fail(
        `it resolves to ${formatNames([resolved])}, outside the package's folder ${formatNames([realPackageDir])}`,
      )
    : { path: resolved, version: getVersion(manifest) }
}

/**
 * The manifest of `name` in the nearest `node_modules` folder at or above `parentPath`'s folder,
 * with the folder it was found from
 */
function findManifest(
  name: string,
  parentPath: string,
  prefix: string,
): { dir: string; packageDir: string; manifest: unknown } | undefined {
  const found = findNodeModulesManifest(name, path.dirname(parentPath))
  if (found === undefined) {
    return undefined
  }
  const { dir, file } = found
  try {
    return { dir, packageDir: path.dirname(file), manifest: readJsonFile(file) }
  } catch (error) {
    throw new Error(
      formatMessage(
        prefix,
        [formatNames([file])],
        `reading ${formatNames([name])}'s manifest failed: ${getErrorReason(error)}`,
      ),
      { cause: error },
    )
  }
}

/**
 * The `package.json` path of `name` in the nearest `node_modules` folder at or above `dir`, with
 * the folder it was found from, as Node's resolvers walk the folders. It skips a `node_modules`
 * folder's own `node_modules`, as Node does, and never falls back to `NODE_PATH` or global folders.
 * `dir` is used as given, so pass it resolved
 */
export function findNodeModulesManifest(
  name: string,
  dir: string,
): { dir: string; file: string } | undefined {
  for (let current = dir; ;) {
    const file = path.join(current, 'node_modules', name, 'package.json')
    if (path.basename(current) !== 'node_modules' && fs.existsSync(file)) {
      return { dir: current, file }
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

function getVersion(manifest: unknown): unknown {
  return isRecord(manifest) ? manifest['version'] : undefined
}

type PackageInfo = {
  name: string
  dir: string
  manifest: unknown
}

type Resolution = { path: string } | { reason: string; cause?: unknown }

const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json']

type ResolveOptions = {
  /**
   * Includes `default`
   */
  conditions: ReadonlyArray<string>
  mainFields: ReadonlyArray<string>
  extensions: ReadonlyArray<string>
  /**
   * Whether an `exports` target that names no file is tried with the extensions and as a folder,
   * as enhanced-resolve does, unlike Node
   */
  tryExportsExtensions: boolean
}

/**
 * The file that `subpath`, `.` or `./<path>`, names in the package, as enhanced-resolve resolves it
 */
function resolveInPackage(
  { name, dir, manifest }: PackageInfo,
  subpath: string,
  options: ResolveOptions,
): Resolution {
  const { conditions, mainFields } = options
  const exports = isRecord(manifest) ? manifest['exports'] : undefined
  if (exports !== undefined && exports !== null) {
    const keys = isRecord(exports) ? Object.keys(exports) : []
    const subpathKeys = keys.filter((key) => key.startsWith('.'))
    if (subpathKeys.length > 0 && subpathKeys.length < keys.length) {
      return {
        reason: `${formatNames([name])} has an invalid \`exports\`: its keys mix subpaths, which start with \`.\`, and conditions`,
      }
    }
    const target = resolveExports(exports, subpath, conditions)
    if (target === undefined || target === null) {
      return {
        reason: `${formatNames([name])} doesn't export ${formatNames([subpath])} for the conditions ${formatNames(conditions, { conjunction: 'and' })}`,
      }
    }
    if ('invalidTarget' in target) {
      const { invalidTarget } = target
      const described =
        typeof invalidTarget === 'string'
          ? formatNames([invalidTarget])
          : describeValue(invalidTarget)
      return {
        reason: `${formatNames([name])}'s \`exports\` has an invalid target ${described}`,
      }
    }
    return 'invalidSubpath' in target
      ? { reason: `the subpath ${formatNames([subpath])} has an invalid segment` }
      : resolveExportsTarget(path.join(dir, target.target), options)
  }
  if (subpath !== '.') {
    return (
      resolveFile(path.join(dir, subpath), options) ?? {
        reason: `${formatNames([name])} has no file ${formatNames([subpath])}`,
      }
    )
  }
  const entry = findInFolder(dir, manifest, options)
  return entry === undefined
    ? {
        reason: `${formatNames([name])} has no entry file for the main fields ${formatNames(mainFields, { conjunction: 'and' })}`,
      }
    : { path: entry }
}

function resolveExportsTarget(file: string, options: ResolveOptions): Resolution {
  const { tryExportsExtensions } = options
  if (tryExportsExtensions) {
    const resolved = resolveFile(file, options)
    if (resolved !== undefined) {
      return resolved
    }
  } else if (isFile(file)) {
    return { path: file }
  }
  return {
    reason: fs.existsSync(file)
      ? `it resolves to ${formatNames([file])}, which isn't a file${tryExportsExtensions ? ' and has no entry file' : ''}`
      : `it resolves to ${formatNames([file])}, which doesn't exist`,
  }
}

export type ResolveFileOptions = {
  /**
   * The fields that name a folder's entry, in order, such as `['style']`
   */
  mainFields: ReadonlyArray<string>
  /**
   * The extensions tried for a path without one and for `index`, such as `['.css']`
   */
  extensions: ReadonlyArray<string>
}

/**
 * The file that the absolute path `file` names, as enhanced-resolve resolves a relative request,
 * which ignores `exports`: the file, with one of the extensions, or else the folder's entry.
 * `undefined` when none is a file, or the reason when the folder's `package.json` can't be read
 */
export function resolveFile(
  file: string,
  options: ResolveFileOptions,
): { path: string } | { reason: string; cause: unknown } | undefined {
  const found = withExtensions(file, options.extensions).find((candidate) => isFile(candidate))
  if (found !== undefined) {
    return { path: found }
  }
  const manifestPath = path.join(file, 'package.json')
  let manifest: unknown
  if (isFile(manifestPath)) {
    try {
      manifest = readJsonFile(manifestPath)
    } catch (error) {
      return {
        reason: `reading ${formatNames([manifestPath])} failed: ${getErrorReason(error)}`,
        cause: error,
      }
    }
  }
  const entry = findInFolder(file, manifest, options)
  return entry === undefined ? undefined : { path: entry }
}

/**
 * The first main field that names a file, tried with the extensions and as a folder with an
 * `index`, then `index`. Unlike in enhanced-resolve, a main field's folder isn't read for its own
 * `package.json`, as in Node
 */
function findInFolder(
  dir: string,
  manifest: unknown,
  { mainFields, extensions }: ResolveFileOptions,
): string | undefined {
  const mains = mainFields.flatMap((field) => {
    const value = isRecord(manifest) ? manifest[field] : undefined
    return typeof value === 'string' ? path.join(dir, value) : []
  })
  return [
    ...mains.flatMap((main) => [
      ...withExtensions(main, extensions),
      ...indexesOf(main, extensions),
    ]),
    ...indexesOf(dir, extensions),
  ].find((candidate) => isFile(candidate))
}

function withExtensions(file: string, extensions: ReadonlyArray<string>): Array<string> {
  return [file, ...extensions.map((extension) => `${file}${extension}`)]
}

function indexesOf(dir: string, extensions: ReadonlyArray<string>): Array<string> {
  return extensions.map((extension) => path.join(dir, `index${extension}`))
}

function isFile(file: string): boolean {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false
}

/**
 * What an `exports` target resolves to, as Node's `PACKAGE_TARGET_RESOLVE` has it: a valid target;
 * an invalid one, which an array skips; a subpath whose `*` match has an invalid segment, which
 * stops the resolution; `null` when a `null` target blocks the subpath; or `undefined` when no
 * condition matches
 */
type TargetResolution =
  { target: string } | { invalidTarget: unknown } | { invalidSubpath: true } | null | undefined

/**
 * The target of `exports` for `subpath`, relative to the package's folder, as Node's
 * `PACKAGE_EXPORTS_RESOLVE` finds it with `conditions`: an exact key, or else the `*` pattern key
 * that sorts first by Node's `PATTERN_KEY_COMPARE`, the longest prefix, then the longest key.
 * `null` or `undefined` when the subpath isn't exported, as for a `null` target or one that no
 * condition matches
 */
function resolveExports(
  exports: unknown,
  subpath: string,
  conditions: ReadonlyArray<string>,
): TargetResolution {
  const isSubpathMap = isRecord(exports) && Object.keys(exports).some((key) => key.startsWith('.'))
  const map: Record<string, unknown> = isSubpathMap ? exports : { '.': exports }
  if (Object.hasOwn(map, subpath) && !subpath.includes('*')) {
    return resolveTarget(map[subpath], undefined, conditions)
  }
  let best: { key: string; prefixLength: number; match: string } | undefined
  for (const key of Object.keys(map)) {
    const star = key.indexOf('*')
    if (star === -1 || key.includes('*', star + 1)) {
      continue
    }
    const keyPrefix = key.slice(0, star)
    const keySuffix = key.slice(star + 1)
    if (
      subpath.length >= key.length &&
      subpath.startsWith(keyPrefix) &&
      subpath.endsWith(keySuffix) &&
      (best === undefined ||
        star > best.prefixLength ||
        (star === best.prefixLength && key.length > best.key.length))
    ) {
      best = {
        key,
        prefixLength: star,
        match: subpath.slice(keyPrefix.length, subpath.length - keySuffix.length),
      }
    }
  }
  return best === undefined ? undefined : resolveTarget(map[best.key], best.match, conditions)
}

/**
 * Node's `PACKAGE_TARGET_RESOLVE`: a target string, with `*` replaced by `match`, the first valid
 * target of an array, or the target of the first condition in `conditions` of an object. A `null`
 * target ends the resolution of an object, so a later condition doesn't apply, but an array goes
 * on to its next item, as it does past an invalid target. An invalid subpath stops it, as in Node
 */
function resolveTarget(
  target: unknown,
  match: string | undefined,
  conditions: ReadonlyArray<string>,
): TargetResolution {
  if (typeof target === 'string') {
    return resolveTargetString(target, match)
  }
  if (target === null) {
    return null
  }
  if (Array.isArray(target)) {
    if (target.length === 0) {
      return null
    }
    let last: TargetResolution
    for (const item of target) {
      const resolved = resolveTarget(item, match, conditions)
      if (
        resolved !== undefined &&
        resolved !== null &&
        ('target' in resolved || 'invalidSubpath' in resolved)
      ) {
        return resolved
      }
      last = resolved === undefined ? last : resolved
    }
    return last
  }
  if (!isRecord(target)) {
    return { invalidTarget: target }
  }
  for (const [condition, value] of Object.entries(target)) {
    const resolved = conditions.includes(condition)
      ? resolveTarget(value, match, conditions)
      : undefined
    if (resolved !== undefined) {
      return resolved
    }
  }
  return undefined
}

/**
 * A target string with `*` replaced by `match`. As in Node, the target is invalid when it doesn't
 * start with `./` or has a `.`, `..` or `node_modules` segment, and the subpath is when `match`
 * has one, which checking the replaced target alone would blame on the target
 */
function resolveTargetString(
  target: string,
  match: string | undefined,
): { target: string } | { invalidTarget: string } | { invalidSubpath: true } {
  if (!target.startsWith('./') || hasInvalidSegment(target.slice(2))) {
    return { invalidTarget: target }
  }
  if (match !== undefined && hasInvalidSegment(match)) {
    return { invalidSubpath: true }
  }
  const resolved = match === undefined ? target : target.replaceAll('*', () => match)
  // A target such as `./.*.` with an empty match forms `..` from parts that each pass
  return hasInvalidSegment(resolved.slice(2)) ? { invalidTarget: target } : { target: resolved }
}

function hasInvalidSegment(text: string): boolean {
  return text
    .split(/[/\\]/)
    .some((segment) => ['.', '..', 'node_modules'].includes(segment.toLowerCase()))
}

/**
 * The package a bare specifier names, or `undefined` when that isn't a valid npm package name.
 * Without the check, `..` would join onto `node_modules` and find the project's own `package.json`.
 * As in npm, an unscoped name can't start with `.` or `_`, but the parts of a scoped name can
 */
function getPackageName(specifier: string): string | undefined {
  const [first = '', second = ''] = specifier.split('/', 2)
  if (first.startsWith('@')) {
    return isValidScopedPart(first.slice(1)) && isValidScopedPart(second)
      ? `${first}/${second}`
      : undefined
  }
  return isValidScopedPart(first) && !first.startsWith('.') && !first.startsWith('_')
    ? first
    : undefined
}

function isValidScopedPart(part: string): boolean {
  return part !== '' && part !== '.' && part !== '..' && !part.includes('\\')
}
