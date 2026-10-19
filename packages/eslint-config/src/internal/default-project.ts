import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import type TypeScriptModule from 'typescript'

import { memoize } from '@gpahal/std/functions'
import { isRecord } from '@gpahal/std/objects'

import {
  CODE_EXTNS_WITH_DOT,
  NOT_CONFIG_INFIXES,
  TYPED_CODE_EXTNS_WITH_DOT,
} from '@/internal/files'
import { findPackageJson } from '@/internal/fs'
import { isInside } from '@/internal/globs'

type TypeScript = typeof TypeScriptModule

/**
 * `*.config.{ts,mts,cts,js,mjs,cjs}`, also with an infix, as in `vitest.config.e2e.ts`, and dotfile
 * configs, as in `.prettierrc.ts`. The infix is the first group
 */
const CANDIDATE_REGEX = /^(?:[^.].*?\.config|\..*?rc)\.(?:(.+)\.)?[cm]?[jt]s$/

/**
 * An infix of {@link NOT_CONFIG_INFIXES} makes a declaration or test file instead
 */
export function isDefaultProjectCandidate(name: string): boolean {
  const match = CANDIDATE_REGEX.exec(name)
  if (match === null) {
    return false
  }
  const infix = match[1] ?? ''
  return infix.split('.').every((part) => !NOT_CONFIG_INFIXES.includes(part))
}

/**
 * No tsconfig of a Vite or Next.js template includes it, and `storybook init` doesn't add it
 */
export const STORYBOOK_FOLDER = '.storybook'

const STORYBOOK_CANDIDATE_REGEX = /^(?!.*\.d\.[cm]?ts$).+\.(?:[cm]?[jt]s|tsx)$/

export function isStorybookCandidate(name: string): boolean {
  return STORYBOOK_CANDIDATE_REGEX.test(name)
}

/**
 * As TypeScript's `createGetCanonicalFileName` makes it
 */
function canonicalFileName(ts: TypeScript): (file: string) => string {
  return ts.sys.useCaseSensitiveFileNames ? (file) => file : (file) => file.toLowerCase()
}

type FileSystemEntries = {
  files: ReadonlyArray<string>
  directories: ReadonlyArray<string>
}

/**
 * TypeScript's internal `matchFiles`, which `ts.sys.readDirectory` calls
 */
type MatchFiles = (
  path: string,
  extensions: ReadonlyArray<string> | undefined,
  excludes: ReadonlyArray<string> | undefined,
  includes: ReadonlyArray<string> | undefined,
  useCaseSensitiveFileNames: boolean,
  currentDirectory: string,
  depth: number | undefined,
  getFileSystemEntries: (path: string) => FileSystemEntries,
  realpath: (path: string) => string,
) => Array<string>

const NO_ENTRIES: FileSystemEntries = { files: [], directories: [] }

/**
 * As TypeScript sorts a folder's entries
 */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : Number(a > b)
}

/**
 * Following symbolic links, or none when it can't be read
 */
function listFolder(folder: string): FileSystemEntries {
  let entries: Array<fs.Dirent>
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true })
  } catch {
    return NO_ENTRIES
  }
  const files: Array<string> = []
  const directories: Array<string> = []
  for (const entry of entries) {
    let stats: fs.Stats | fs.Dirent | undefined = entry
    if (entry.isSymbolicLink()) {
      try {
        stats = fs.statSync(path.join(folder, entry.name), { throwIfNoEntry: false })
      } catch {
        stats = undefined
      }
    }
    if (stats?.isFile() === true) {
      files.push(entry.name)
    } else if (stats?.isDirectory() === true) {
      directories.push(entry.name)
    }
  }
  return {
    files: files.toSorted(compareCodeUnits),
    directories: directories.toSorted(compareCodeUnits),
  }
}

/**
 * Lists only the folders under `root` and the path toward it, so an `include` such as `/**\/*`
 * doesn't make the config load walk the disk
 */
function createParseHost(ts: TypeScript, root: string): TypeScriptModule.ParseConfigFileHost {
  const host = {
    ...ts.sys,
    // A config that doesn't parse includes nothing, as the project service would open no project
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  }
  const matchFiles: unknown = Reflect.get(ts, 'matchFiles')
  if (typeof matchFiles !== 'function') {
    return host
  }
  const resolvedRoot = path.resolve(root)
  let realRoot: string
  try {
    realRoot = fs.realpathSync(resolvedRoot)
  } catch {
    realRoot = resolvedRoot
  }
  // Per host, since overlapping `include`s list the same folders; a longer-lived cache would miss
  // files an editor's user adds
  const getEntries = memoize((folder: string): FileSystemEntries => {
    const absolute = path.resolve(folder)
    if (isInside(absolute, resolvedRoot)) {
      let real: string
      try {
        real = fs.realpathSync(absolute)
      } catch {
        return NO_ENTRIES
      }
      return isInside(real, realRoot) ? listFolder(absolute) : NO_ENTRIES
    }
    if (isInside(resolvedRoot, absolute)) {
      const [toward = ''] = path.relative(absolute, resolvedRoot).split(path.sep)
      return { files: [], directories: [toward] }
    }
    return NO_ENTRIES
  })
  const realpath = memoize(ts.sys.realpath?.bind(ts.sys) ?? ((file: string) => file))
  return {
    ...host,
    readDirectory: (folder, extensions, excludes, includes, depth) =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- TypeScript's internal `matchFiles`
      (matchFiles as MatchFiles)(
        folder,
        extensions,
        excludes,
        includes,
        ts.sys.useCaseSensitiveFileNames,
        process.cwd(),
        depth,
        getEntries,
        realpath,
      ),
  }
}

/**
 * `undefined` when it doesn't parse
 */
function parseTsconfig(
  ts: TypeScript,
  configFile: string,
  host: TypeScriptModule.ParseConfigFileHost,
  extendedConfigs: Map<string, TypeScriptModule.ExtendedConfigCacheEntry>,
): TypeScriptModule.ParsedCommandLine | undefined {
  return ts.getParsedCommandLineOfConfigFile(configFile, undefined, host, extendedConfigs)
}

/**
 * Each config is parsed once. Keyed by {@link canonicalFileName}
 */
type ParsedProjects = {
  key: (file: string) => string
  host: TypeScriptModule.ParseConfigFileHost
  parsed: Map<string, TypeScriptModule.ParsedCommandLine | undefined>
  references: Map<string, Array<string>>
  extendedConfigs: Map<string, TypeScriptModule.ExtendedConfigCacheEntry>
}

function addProjects(ts: TypeScript, configFile: string, projects: ParsedProjects): void {
  const { key, parsed, references } = projects
  if (parsed.has(key(configFile))) {
    return
  }
  const config = parseTsconfig(ts, configFile, projects.host, projects.extendedConfigs)
  parsed.set(key(configFile), config)
  const referenced = (config?.projectReferences ?? []).map((reference) =>
    path.resolve(ts.resolveProjectReferencePath(reference)),
  )
  references.set(
    key(configFile),
    referenced.map((reference) => key(reference)),
  )
  for (const reference of referenced) {
    addProjects(ts, reference, projects)
  }
}

/**
 * The tsconfigs in `folder` or above, nearest first, up to one with `disableSolutionSearching`, and
 * their references unless `disableReferencedProjectLoad`. Breadth-first, so a package's own
 * tsconfig that lists the file ends it right away
 */
function opensAnyOf(
  folder: string,
  targets: ReadonlySet<string>,
  tsconfigsByFolder: ReadonlyMap<string, ReadonlyArray<string>>,
  { key, parsed, references }: ParsedProjects,
): boolean {
  // Up the ancestors, so the work grows with depth, not with the tsconfig count
  const ancestors: Array<string> = []
  for (let current = folder; ; current = path.dirname(current)) {
    ancestors.push(...(tsconfigsByFolder.get(key(current)) ?? []))
    if (path.dirname(current) === current) {
      break
    }
  }
  const stop = ancestors.findIndex(
    (configFile) => parsed.get(configFile)?.options.disableSolutionSearching === true,
  )
  const queue = stop === -1 ? ancestors : ancestors.slice(0, stop + 1)
  const seen = new Set(queue)
  // An index rather than `shift`, which copies the rest of the queue
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- the loop pushes onto the queue it walks
  for (let index = 0; index < queue.length; index++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the index is in range
    const configFile = queue[index]!
    if (targets.has(configFile)) {
      return true
    }
    const referenced = references.get(configFile) ?? []
    if (parsed.get(configFile)?.options.disableReferencedProjectLoad !== true) {
      for (const reference of referenced) {
        if (seen.has(reference)) {
          continue
        }

        seen.add(reference)
        queue.push(reference)
      }
    }
  }
  return false
}

/**
 * `root/tsconfig.json` is missing, fails to parse or includes no files (typescript-eslint then
 * silently uses its defaults), its `types` lists neither `node` nor `*` (TypeScript 6 then leaves
 * Node's types out), or `@types/node` isn't installed
 */
export type DefaultProjectProblem =
  | { kind: 'missing' }
  | { kind: 'unparseable'; diagnostic: string }
  | { kind: 'no-inputs' }
  | { kind: 'no-node-types'; types: Array<string> }
  | { kind: 'node-types-missing' }

/**
 * "No inputs were found in config file"
 */
const NO_INPUTS_CODE = 18_003

/**
 * The project service reads the tsconfig once per process, so a later edit doesn't matter
 */
const defaultProjectProblems = new Map<string, DefaultProjectProblem | undefined>()

/**
 * A tsconfig with errors counts as unparsed, as typescript-eslint ignores it
 */
export function checkDefaultProjectTsconfig(root: string): DefaultProjectProblem | undefined {
  const key = path.resolve(root)
  if (defaultProjectProblems.has(key)) {
    return defaultProjectProblems.get(key)
  }
  const problem = findDefaultProjectProblem(path.join(key, 'tsconfig.json'))
  defaultProjectProblems.set(key, problem)
  return problem
}

function findDefaultProjectProblem(configFile: string): DefaultProjectProblem | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `require` returns `any`, and this is the `typescript` module
  const ts = createRequire(import.meta.url)('typescript') as TypeScript
  if (!ts.sys.fileExists(configFile)) {
    return { kind: 'missing' }
  }
  let unrecoverable: TypeScriptModule.Diagnostic | undefined
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, undefined, {
    ...createParseHost(ts, path.dirname(configFile)),
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      unrecoverable = diagnostic
    },
  })
  const error = unrecoverable ?? parsed?.errors[0]
  if (error?.code === NO_INPUTS_CODE) {
    return { kind: 'no-inputs' }
  }
  if (error !== undefined) {
    return {
      kind: 'unparseable',
      // Without its final period, since the warning's sentence goes on
      diagnostic: ts.flattenDiagnosticMessageText(error.messageText, ' ').replace(/\.$/, ''),
    }
  }
  // `*` loads every @types package, `node` among them
  const types = parsed?.options.types ?? []
  if (!types.includes('node') && !types.includes('*')) {
    return { kind: 'no-node-types', types }
  }
  // `typeRoots` can hold `node` without a package, which this can't follow, so it's trusted
  return parsed?.options.typeRoots === undefined &&
    findPackageJson('@types/node', path.dirname(configFile)) === undefined
    ? { kind: 'node-types-missing' }
    : undefined
}

/**
 * typescript-eslint keeps the first project service per process, so finding them again on a reload
 * can't change what it uses. The walk isn't kept, so `.gitignore` edits still apply
 */
const discoveries = new Map<string, Array<string>>()

/**
 * Keyed by the tsconfigs' modification times and sizes too, since the warning should see an edited
 * tsconfig. An extended tsconfig isn't checked
 */
const outsideDiscoveries = new Map<string, Array<string>>()

const foundFiles = new Map<string, Set<string>>()

/**
 * Rather than a glob of yours listing it
 */
export function isFoundDefaultProjectFile(root: string, file: string): boolean {
  return foundFiles.get(path.resolve(root))?.has(file) ?? false
}

function addFoundFiles(root: string, files: ReadonlyArray<string>): void {
  const key = path.resolve(root)
  foundFiles.set(key, new Set([...(foundFiles.get(key) ?? []), ...files]))
}

/**
 * Sorted paths relative to the root with `/` separators
 */
export type ProjectDiscovery = {
  /**
   * The config files that no project the project service opens for them lists
   */
  defaultProjectFiles: Array<string>
  /**
   * Source TypeScript files the project service reports as not found
   */
  filesOutsideTsconfigs: Array<string>
}

export function findDefaultProjectFiles(
  root: string,
  tsconfigFiles: ReadonlyArray<string>,
  candidates: ReadonlyArray<string>,
): Array<string> {
  return discoverProjects(root, tsconfigFiles, candidates, []).defaultProjectFiles
}

/**
 * The project service fails on a file that no project includes, and on one in
 * `allowDefaultProject` that a project includes.
 *
 * A project also includes what its files import. Imports are followed only for `sourceFiles` that
 * no project lists, so a tsconfig that lists only an entry file, as Angular's does, costs a read
 * of that project's files. A candidate that a project includes only through an import stays, and
 * fails with a message that names the fix. Without a file to check, TypeScript isn't loaded
 */
export function discoverProjects(
  root: string,
  tsconfigFiles: ReadonlyArray<string>,
  candidates: ReadonlyArray<string>,
  sourceFiles: ReadonlyArray<string>,
): ProjectDiscovery {
  const typescriptFiles = sourceFiles
    .filter((file) => TYPED_CODE_EXTNS_WITH_DOT.includes(path.extname(file)))
    .map((file) => path.resolve(root, file))
  if (candidates.length === 0 && typescriptFiles.length === 0) {
    return { defaultProjectFiles: [], filesOutsideTsconfigs: [] }
  }
  const memoKey = JSON.stringify([root, tsconfigFiles, candidates, typescriptFiles])
  const outsideKey = JSON.stringify([
    memoKey,
    typescriptFiles.length === 0 ? [] : tsconfigFiles.map((file) => stampOf(file)),
  ])
  const toRelative = (files: ReadonlyArray<string>, unlisted: ReadonlySet<string>) =>
    files
      .filter((file) => unlisted.has(file))
      .map((file) => path.relative(root, file).split(path.sep).join('/'))
      .toSorted((a, b) => (a < b ? -1 : Number(a > b)))
  let defaultProjectFiles = discoveries.get(memoKey)
  let filesOutsideTsconfigs = outsideDiscoveries.get(outsideKey)
  if (defaultProjectFiles === undefined) {
    const unlisted = findUnlistedFiles(root, tsconfigFiles, candidates, typescriptFiles)
    defaultProjectFiles = toRelative(candidates, unlisted)
    filesOutsideTsconfigs = toRelative(typescriptFiles, unlisted)
    discoveries.set(memoKey, defaultProjectFiles)
  } else if (filesOutsideTsconfigs === undefined) {
    const unlisted = findUnlistedFiles(root, tsconfigFiles, [], typescriptFiles)
    filesOutsideTsconfigs = toRelative(typescriptFiles, unlisted)
  }
  outsideDiscoveries.set(outsideKey, filesOutsideTsconfigs)
  addFoundFiles(root, defaultProjectFiles)
  return {
    defaultProjectFiles: [...defaultProjectFiles],
    filesOutsideTsconfigs: [...filesOutsideTsconfigs],
  }
}

/**
 * Cheaper than the text, which the parse reads again only when the stamp changes
 */
function stampOf(file: string): string | null {
  const stats = fs.statSync(file, { throwIfNoEntry: false })
  return stats === undefined ? null : `${String(stats.mtimeMs)}:${String(stats.size)}`
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Transitively, outside `node_modules`, as its program would include them
 */
function findImportedFiles(
  ts: TypeScript,
  config: TypeScriptModule.ParsedCommandLine,
  wanted: ReadonlySet<string>,
  key: (file: string) => string,
): Set<string> {
  const cache = ts.createModuleResolutionCache(process.cwd(), key, config.options)
  const queue = config.fileNames.map((file) => path.resolve(file))
  const seen = new Set(queue.map((file) => key(file)))
  const found = seen.intersection(wanted)
  const enqueue = (file: string) => {
    const resolved = path.resolve(file)
    const fileKey = key(resolved)
    if (seen.has(fileKey)) {
      return
    }
    seen.add(fileKey)
    if (wanted.has(fileKey)) {
      found.add(fileKey)
    }
    if (CODE_EXTNS_WITH_DOT.includes(path.extname(resolved))) {
      queue.push(resolved)
    }
  }
  for (let index = 0; index < queue.length && found.size < wanted.size; index++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the index is in range
    const file = queue[index]!
    const text = readText(file)
    if (text === null) {
      continue
    }
    const info = ts.preProcessFile(text, true, true)
    for (const reference of info.referencedFiles) {
      enqueue(path.resolve(path.dirname(file), reference.fileName))
    }
    for (const imported of info.importedFiles) {
      const resolved = ts.resolveModuleName(
        imported.fileName,
        file,
        config.options,
        ts.sys,
        cache,
      ).resolvedModule
      if (resolved !== undefined && resolved.isExternalLibraryImport !== true) {
        enqueue(resolved.resolvedFileName)
      }
    }
  }
  return found
}

function findUnlistedFiles(
  root: string,
  tsconfigFiles: ReadonlyArray<string>,
  candidates: ReadonlyArray<string>,
  sourceFiles: ReadonlyArray<string>,
): Set<string> {
  // Synchronously, so the options resolve before the configs build
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `require` returns `any`, and this is the `typescript` module
  const ts = createRequire(import.meta.url)('typescript') as TypeScript
  const key = canonicalFileName(ts)
  const projects: ParsedProjects = {
    key,
    host: createParseHost(ts, root),
    parsed: new Map(),
    references: new Map(),
    extendedConfigs: new Map(),
  }
  const { parsed } = projects
  const tsconfigsByFolder = new Map<string, Array<string>>()
  for (const tsconfigFile of tsconfigFiles) {
    const file = path.resolve(tsconfigFile)
    addProjects(ts, file, projects)
    const folder = key(path.dirname(file))
    tsconfigsByFolder.set(folder, [...(tsconfigsByFolder.get(folder) ?? []), key(file)])
  }
  const files = [...candidates, ...sourceFiles]
  // Each project's files are read once, so the work grows with the files, not projects times files
  const fileKeys = new Set(files.map((file) => key(path.resolve(file))))
  const listingProjects = new Map<string, Array<string>>()
  const addListing = (fileKey: string, configFile: string) => {
    const listing = listingProjects.get(fileKey)
    if (listing === undefined) {
      listingProjects.set(fileKey, [configFile])
    } else {
      listing.push(configFile)
    }
  }
  for (const [configFile, config] of parsed) {
    const fileNames = config?.fileNames ?? []
    for (const fileName of fileNames) {
      const fileKey = key(path.resolve(fileName))
      if (fileKeys.has(fileKey)) {
        addListing(fileKey, configFile)
      }
    }
  }
  const opens = memoize((memoKey: string) => {
    const [folder = '', ...targets] = memoKey.split('\0')
    return opensAnyOf(folder, new Set(targets), tsconfigsByFolder, projects)
  })
  const isUnlisted = (file: string) => {
    const resolved = path.resolve(file)
    const listing = listingProjects.get(key(resolved))
    return listing === undefined || !opens([path.dirname(resolved), ...listing].join('\0'))
  }
  const pending = sourceFiles.filter((file) => isUnlisted(file))
  if (pending.length > 0) {
    const pendingKeys = new Set(pending.map((file) => key(path.resolve(file))))
    for (const [configFile, config] of parsed) {
      if (
        config !== undefined &&
        pending.some((file) => opens([path.dirname(path.resolve(file)), configFile].join('\0')))
      ) {
        for (const fileKey of findImportedFiles(ts, config, pendingKeys, key)) {
          addListing(fileKey, configFile)
        }
      }
    }
  }
  const pendingSet = new Set(pending)
  return new Set([
    ...candidates.filter((file) => isUnlisted(file)),
    ...sourceFiles.filter((file) => pendingSet.has(file) && isUnlisted(file)),
  ])
}

const ASTRO_TYPES_FILE = '.astro/types.d.ts'

/**
 * With `${configDir}` replaced, through `extends`. TypeScript keeps them only on its internal
 * `configFileSpecs`, so without it `raw`'s, which skip `extends`
 */
function getIncludeSpecs(
  parsed: TypeScriptModule.ParsedCommandLine,
  folder: string,
): Array<string> {
  const configFile: unknown = parsed.options['configFile']
  const specs: unknown = isRecord(configFile) ? configFile['configFileSpecs'] : undefined
  const raw: unknown = parsed.raw
  const lists = isRecord(specs)
    ? [specs['validatedFilesSpec'], specs['validatedIncludeSpecs']]
    : isRecord(raw)
      ? [raw['files'], raw['include']]
      : []
  return lists.flatMap((list) =>
    Array.isArray(list)
      ? list
          .filter((entry) => typeof entry === 'string')
          .map((entry) => path.resolve(folder, entry))
      : [],
  )
}

/**
 * Missing in a fresh clone before `astro sync`, so the type-aware rules report Astro's modules and
 * `astro:*` imports as error types
 */
export function isAstroTypesFileMissing(root: string): boolean {
  const typesFile = path.join(root, ASTRO_TYPES_FILE)
  if (fs.existsSync(typesFile)) {
    return false
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `require` returns `any`, and this is the `typescript` module
  const ts = createRequire(import.meta.url)('typescript') as TypeScript
  const configFile = path.join(root, 'tsconfig.json')
  if (!ts.sys.fileExists(configFile)) {
    return false
  }
  // The host lists no folder, which skips the walk for `fileNames`
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, undefined, {
    ...ts.sys,
    readDirectory: () => [],
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  })
  return parsed !== undefined && getIncludeSpecs(parsed, root).includes(typesFile)
}
