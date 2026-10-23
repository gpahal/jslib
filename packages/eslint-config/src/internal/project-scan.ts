import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import type { ConfigObject, includeIgnoreFile as IncludeIgnoreFile } from 'eslint/config'

import { joinList } from '@gpahal/internal/lists'
import { resolveSubOptions } from '@gpahal/internal/node/options'
import { formatNames, getErrorReason } from '@gpahal/std/errors'

import { IGNORED_FOLDER_NAMES, IGNORES } from '@/internal/configs/ignores'
import {
  isDefaultProjectCandidate,
  isStorybookCandidate,
  STORYBOOK_FOLDER,
} from '@/internal/default-project'
import { CODE_EXTNS_WITH_DOT, TYPED_CODE_EXTNS_WITH_DOT } from '@/internal/files'
import { followEntry } from '@/internal/fs'
import {
  findGitCommonDir,
  findGitignoresAbove,
  findGitRoot,
  readGitModules,
  readIgnoreCase,
} from '@/internal/git'
import { createGlobMatcher, isInside, posixRelative, rebaseGlob } from '@/internal/globs'
import { GITIGNORE_CONFIG_NAMES } from '@/internal/names'
import type { EslintConfigOptions } from '@/internal/types'
import { fail, formatErrorMessage, warnOfSetupOnce } from '@/internal/utils'
import { createIgnoreCheck, IgnoreLayers, walkFolders } from '@/internal/walk'
import type { IgnoreLayer } from '@/internal/walk'

/**
 * An ignore file's rules, or the submodule folders, as globs relative to `basePath`
 */
export type GitIgnores = {
  name: (typeof GITIGNORE_CONFIG_NAMES)[number]
  basePath: string
  /**
   * Folders whose `.gitignore` files all have `ignores`, each relative to its own folder
   */
  folders?: Array<string> | undefined
  ignores: Array<string>
}

/**
 * Loaded on first call, since ESLint before 10.11 doesn't export it, and a missing export would
 * fail the import before `defineConfig` checks ESLint's version
 */
function loadIncludeIgnoreFile(): typeof IncludeIgnoreFile {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `require` returns `any`, and ESLint 10.11 or later, which `defineConfig` checks for first, has this export
  const api = createRequire(import.meta.url)('eslint/config') as {
    includeIgnoreFile: typeof IncludeIgnoreFile
  }
  return api.includeIgnoreFile
}

/**
 * minimatch, which ESLint and the walk use, backtracks on a segment of `n` wildcards in time that
 * grows with the name to the power of `n`: on a 250-character name, about 10 ms with 3, 0.5 s with
 * 4 and 26 s with 5. ESLint takes no other matcher for global ignores, so a rule with more is
 * skipped
 */
const MAX_SEGMENT_WILDCARDS = 3

/**
 * A `**` segment is a globstar, which doesn't backtrack the same way
 */
function hasTooManyWildcards(glob: string): boolean {
  return glob.split('/').some((segment) => {
    if (segment === '**' || segment === '!**') {
      return false
    }
    let count = 0
    for (let index = 0; index < segment.length; index++) {
      const char = segment.charAt(index)
      if (char === '\\') {
        index++
      } else if (char === '*') {
        count++
      }
    }
    return count > MAX_SEGMENT_WILDCARDS
  })
}

/**
 * Each file warns once per process, as editors reload the config
 */
const warnedWildcardFiles = new Set<string>()

function warnOfSkippedRules(file: string, root: string, lines: ReadonlyArray<number>): void {
  if (warnedWildcardFiles.has(file)) {
    return
  }
  const relativePath = posixRelative(root, file)
  const isOne = lines.length === 1
  const listed = joinList(lines.map(String), 'and')
  warnOfSetupOnce(
    warnedWildcardFiles,
    file,
    formatErrorMessage(
      ['`gitignore`', formatNames([relativePath])],
      `the ${isOne ? 'rule' : 'rules'} on ${isOne ? 'line' : 'lines'} ${listed} ${isOne ? 'has' : 'have'} more than ${String(MAX_SEGMENT_WILDCARDS)} \`*\` wildcards in one path segment, which can take ESLint seconds per path to match, so ${isOne ? "it's" : "they're"} skipped. Use at most ${String(MAX_SEGMENT_WILDCARDS)}, as in \`*.log\``,
    ),
    'GPAHAL_GITIGNORE_WILDCARDS',
  )
}

/**
 * 1-based, in the order of `includeIgnoreFile`'s globs, which skip blank lines and comments
 */
function getRuleLines(file: string): Array<number> {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .flatMap((line, index) => {
      const trimmed = line.trim()
      return trimmed === '' || trimmed.startsWith('#') ? [] : index + 1
    })
}

function hasOtherCase(char: string): boolean {
  const lower = char.toLowerCase()
  const upper = char.toUpperCase()
  return lower !== upper && lower.length === 1 && upper.length === 1
}

/**
 * Each letter becomes a class of both cases, as `s` becomes `[sS]`, and a bracket expression gets
 * its letters' other case, as `[a-c]` becomes `[a-cA-C]`. One with a POSIX class is left as it is
 */
function ignoreCaseGlob(glob: string): string {
  let result = ''
  for (let index = 0; index < glob.length; index++) {
    const char = glob.charAt(index)
    if (char === '\\') {
      index++
      const escaped = glob.charAt(index)
      result += hasOtherCase(escaped) ? bothCases(escaped) : `\\${escaped}`
    } else if (char === '[') {
      const end = findBracketEnd(glob, index)
      result += end === undefined ? char : ignoreCaseBracket(glob.slice(index, end + 1))
      index = end ?? index
    } else {
      result += hasOtherCase(char) ? bothCases(char) : char
    }
  }
  return result
}

function bothCases(char: string): string {
  return `[${char.toLowerCase()}${char.toUpperCase()}]`
}

/**
 * `undefined` when none does, and the `[` is literal. A `]` first, after any `!` or `^`, is a
 * member
 */
function findBracketEnd(glob: string, start: number): number | undefined {
  let end = start + 1
  if (glob.charAt(end) === '!' || glob.charAt(end) === '^') {
    end++
  }
  if (glob.charAt(end) === ']') {
    end++
  }
  while (end < glob.length && glob.charAt(end) !== ']') {
    end += glob.charAt(end) === '\\' ? 2 : 1
  }
  return end < glob.length ? end : undefined
}

function ignoreCaseBracket(bracket: string): string {
  const negation = /^\[[!^]/.test(bracket) ? bracket.charAt(1) : ''
  const body = bracket.slice(1 + negation.length, -1)
  const swapped = body.replaceAll(/./gsu, (member) =>
    member === member.toLowerCase() ? member.toUpperCase() : member.toLowerCase(),
  )
  return swapped === body || swapped.length !== body.length || body.includes('[:')
    ? bracket
    : `[${negation}${body}${swapped}]`
}

type IgnoreFileReading = {
  root: string
  ignoreCase: boolean
}

/**
 * As `includeIgnoreFile` reads it, without rules that have too many wildcards. Throws an error that
 * names the file when it can't be read, rather than lint the files it ignores
 */
function readIgnoreFile(
  file: string,
  { root, ignoreCase }: IgnoreFileReading,
  gitignoreResolution = false,
): ConfigObject {
  let config: ConfigObject
  try {
    config = loadIncludeIgnoreFile()(file, { gitignoreResolution })
  } catch (error) {
    const relativePath = posixRelative(root, file)
    throw new Error(
      formatErrorMessage(
        ['`gitignore`', formatNames([relativePath])],
        `can't read the file: ${getErrorReason(error)}. Make it readable, or set \`gitignore: false\``,
      ),
      { cause: error },
    )
  }
  let ignores = config.ignores ?? []
  if (ignores.some((glob) => hasTooManyWildcards(glob))) {
    const lines = getRuleLines(file)
    warnOfSkippedRules(
      file,
      root,
      ignores.flatMap((glob, index) => (hasTooManyWildcards(glob) ? (lines[index] ?? 0) : [])),
    )
    ignores = ignores.filter((glob) => !hasTooManyWildcards(glob))
  }
  return { ...config, ignores: ignoreCase ? ignores.map((glob) => ignoreCaseGlob(glob)) : ignores }
}

function readGitignore(file: string, reading: IgnoreFileReading): GitIgnores {
  const config = readIgnoreFile(file, reading, true)
  return {
    name: 'gpahal/ignores/gitignore',
    basePath: config.basePath ?? path.dirname(file),
    ignores: config.ignores ?? [],
  }
}

const ROOT_PROBE_NAME = 'gpahal-eslint-config-probe.js'

const warnedIgnoredRoots = new Set<string>()

/**
 * As a home folder's `.gitignore` of `*` does. Says whether ESLint, which gets the rules rebased
 * onto `root`, ignores the files too
 */
function warnOfIgnoredRoot(
  root: string,
  gitRoot: string,
  sources: ReadonlyArray<{ file: string; layer: GitIgnores | undefined }>,
): void {
  if (root === gitRoot || warnedIgnoredRoots.has(root) || !isInside(root, gitRoot)) {
    return
  }
  const ancestors = sources.filter(
    (source): source is { file: string; layer: GitIgnores } =>
      source.layer !== undefined &&
      source.layer.basePath !== root &&
      isInside(root, source.layer.basePath),
  )
  if (ancestors.length === 0) {
    return
  }
  const folders: Array<string> = []
  for (let folder = root; folder !== gitRoot; folder = path.dirname(folder)) {
    folders.unshift(folder)
  }
  const isIgnored = createIgnoreCheck(new IgnoreLayers(ancestors.map(({ layer }) => layer)))
  const ignored = folders.find((folder) => isIgnored(folder, true))
  if (ignored === undefined) {
    return
  }
  const source =
    ancestors.findLast(({ layer }) =>
      createIgnoreCheck(new IgnoreLayers([layer]))(ignored, true),
    ) ?? ancestors[0]
  const relativePath = posixRelative(root, source?.file ?? '')
  let line: number | undefined
  if (source !== undefined) {
    const lines = getRuleLines(source.file)
    const index = source.layer.ignores.findLastIndex(
      (glob) =>
        !glob.startsWith('!') &&
        createIgnoreCheck(new IgnoreLayers([{ basePath: source.layer.basePath, ignores: [glob] }]))(
          ignored,
          true,
        ),
    )
    line = lines.length === source.layer.ignores.length ? lines[index] : undefined
  }
  // Rebased onto `root`, a rule such as `sub/` matches only folders under it, so ESLint may still
  // lint the project
  const rebased = createIgnoreCheck(
    new IgnoreLayers(
      ancestors.map(({ layer }) => ({
        basePath: root,
        ignores: layer.ignores.flatMap((glob) => rebaseGlob(glob, layer.basePath, root)),
      })),
    ),
  )
  const isIgnoredByESLint = rebased(path.join(root, ROOT_PROBE_NAME), false)
  warnOfSetupOnce(
    warnedIgnoredRoots,
    root,
    formatErrorMessage(
      ['`gitignore`', formatNames([relativePath])],
      `${line === undefined ? 'a rule' : `the rule on line ${String(line)}`} ignores ${formatNames([
        posixRelative(source?.layer.basePath ?? gitRoot, ignored),
      ])}, ${ignored === root ? 'the folder of `root`' : 'a folder above `root`'}, so git ignores every file in the project, ${isIgnoredByESLint ? 'and ESLint does too' : 'though ESLint still lints them'}. Un-ignore the folder in that file, as with a \`!\` rule, or set \`gitignore: false\``,
    ),
    'GPAHAL_ROOT_GITIGNORED',
  )
}

/**
 * What one walk under `root` finds. A tsconfig file is each folder's `tsconfig.json`, or else its
 * `jsconfig.json`. Each list is `[]` when not looked for
 */
export type ProjectScan = {
  gitignores: Array<GitIgnores>
  tsconfigFiles: Array<string>
  configFiles: Array<string>
  packageFolders: Array<string>
  /**
   * A `jsconfig.json` doesn't count, since typescript-eslint's `project: true` ignores it
   */
  astroProjectFolders: Array<string>
  /**
   * `/`-separated paths relative to `root`. `[]` without `matchedGlobs`
   */
  matchedFiles: Array<string>
  /**
   * Outside config files, dot folders, `defaultProjectGlobs` and `isUntyped`. `false` unless looked for
   */
  hasTypescriptFiles: boolean
  /**
   * Outside dot folders, in walk order. `[]` without `collectsSourceFiles`
   */
  sourceFiles: Array<string>
  /**
   * With their dots, config files included. `undefined` when no walk ran
   */
  codeExtensions: ReadonlySet<string> | undefined
}

const ALWAYS_SKIPPED_NAMES: ReadonlyArray<string> = ['node_modules', '.git']

/**
 * A shortcut: the default-ignored names whose `**\/<name>` glob has no later `!` glob. The walk
 * checks every folder against `ignores` anyway
 */
function getSkippedNames(ignores: ReadonlyArray<string>): ReadonlySet<string> {
  const skipped = new Set(ALWAYS_SKIPPED_NAMES)
  for (const name of IGNORED_FOLDER_NAMES) {
    const index = ignores.lastIndexOf(`**/${name}`)
    if (index !== -1 && ignores.slice(index + 1).every((glob) => !glob.startsWith('!'))) {
      skipped.add(name)
    }
  }
  return skipped
}

/**
 * In TypeScript's lookup order. A `jsconfig.json` is a tsconfig with `allowJs` on
 */
const PROJECT_FILE_NAMES: ReadonlyArray<string> = ['tsconfig.json', 'jsconfig.json']

/**
 * TypeScript reads a `tsconfig.json` through a symbolic link
 */
function isFileEntry(entry: fs.Dirent, file: string): boolean {
  return followEntry(entry, file)?.isFile() === true
}

function findMatchedFiles(
  dir: string,
  folder: string,
  entries: ReadonlyArray<fs.Dirent>,
  isIgnored: (file: string, isFolder: boolean) => boolean,
  matchesGlobs: (relativePath: string) => boolean,
): Array<string> {
  const relativeFolder = posixRelative(dir, folder)
  return entries.flatMap((entry) => {
    const relativePath = relativeFolder === '' ? entry.name : `${relativeFolder}/${entry.name}`
    const file = path.join(folder, entry.name)
    return matchesGlobs(relativePath) && isFileEntry(entry, file) && !isIgnored(file, false)
      ? relativePath
      : []
  })
}

/**
 * A `.storybook` folder's own files count, as config files do
 */
function classifyFolder(
  dir: string,
  folder: string,
): { isStorybookFolder: boolean; isInDotFolder: boolean } {
  const folderNames = path.relative(dir, folder).split(path.sep)
  const isStorybookFolder = folderNames.at(-1) === STORYBOOK_FOLDER
  const isInDotFolder = folderNames.some(
    (name, index) =>
      name.startsWith('.') && !(isStorybookFolder && index === folderNames.length - 1),
  )
  return { isStorybookFolder, isInDotFolder }
}

/**
 * Each extension's ignore checks stop at its first file
 */
function addCodeExtensions(
  folder: string,
  entries: ReadonlyArray<fs.Dirent>,
  isIgnored: (file: string, isFolder: boolean) => boolean,
  extensions: Set<string>,
): void {
  for (const entry of entries) {
    const extension = path.extname(entry.name)
    const file = path.join(folder, entry.name)
    if (
      CODE_EXTNS_WITH_DOT.includes(extension) &&
      !extensions.has(extension) &&
      isFileEntry(entry, file) &&
      !isIgnored(file, false)
    ) {
      extensions.add(extension)
    }
  }
}

/**
 * One walk for the `.gitignore`, tsconfig, config and package files, and the `matchedGlobs` files.
 * Like git, it doesn't enter a folder that the rules found so far ignore, but a tsconfig file isn't
 * checked against them. It skips dot folders, except for `.gitignore` and matched files, which
 * ESLint lints, and `.storybook`, whose code files are config files
 */
function walkProject({
  dir,
  gitignores,
  ignoreCase = false,
  before,
  after,
  skippedNames,
  findsTsconfigFiles,
  matchedGlobs,
  defaultProjectGlobs,
  isUntyped,
  collectsSourceFiles,
}: {
  dir: string
  gitignores: Array<GitIgnores> | undefined
  ignoreCase?: boolean | undefined
  before: ReadonlyArray<IgnoreLayer>
  after: ReadonlyArray<IgnoreLayer>
  skippedNames: ReadonlySet<string>
  findsTsconfigFiles: boolean
  matchedGlobs: ReadonlyArray<string>
  defaultProjectGlobs: ReadonlyArray<string>
  isUntyped: (file: string) => boolean
  collectsSourceFiles: boolean
}): Omit<ProjectScan, 'gitignores'> {
  const matchesGlobs = matchedGlobs.length === 0 ? undefined : createGlobMatcher(matchedGlobs)
  const isInDefaultProject =
    defaultProjectGlobs.length === 0 ? () => false : createGlobMatcher(defaultProjectGlobs)
  const matchedFiles: Array<string> = []
  const tsconfigFiles: Array<string> = []
  const configFiles: Array<string> = []
  const packageFolders: Array<string> = []
  const astroProjectFolders: Array<string> = []
  let hasTypescriptFiles = false
  const sourceFiles: Array<string> = []
  const codeExtensions = new Set<string>()
  const isDefaultIgnored = createIgnoreCheck(
    new IgnoreLayers([{ basePath: dir, ignores: IGNORES }]),
  )
  // The walk may enter a folder that only the defaults ignore, so the folders up to the file are
  // checked too. The filesystem root stops a `dir` with a trailing slash
  const isDefaultIgnoredFrom = (file: string) => {
    let current = file
    while (current !== dir) {
      if (isDefaultIgnored(current, current !== file)) {
        return true
      }
      const parent = path.dirname(current)
      if (parent === current) {
        break
      }
      current = parent
    }
    return false
  }
  // In groups, so the `.gitignore` files found go between `before` and `after`
  const layers = new IgnoreLayers()
  for (const [group, groupLayers] of [before, gitignores ?? [], after].entries()) {
    for (const layer of groupLayers) {
      layers.add(layer, group)
    }
  }
  walkFolders({
    root: dir,
    skippedNames,
    entersDotFolders: gitignores !== undefined || matchesGlobs !== undefined,
    enteredDotFolders: findsTsconfigFiles ? new Set([STORYBOOK_FOLDER]) : undefined,
    layers,
    visit: (folder, entries, isIgnored) => {
      // First, since a folder's own `.gitignore` applies to its `tsconfig.json`
      if (
        gitignores !== undefined &&
        folder !== dir &&
        entries.some((entry) => entry.name === '.gitignore' && entry.isFile())
      ) {
        const gitignore = readGitignore(path.join(folder, '.gitignore'), {
          root: dir,
          ignoreCase,
        })
        gitignores.push(gitignore)
        layers.add(gitignore, 1)
      }
      if (matchesGlobs !== undefined) {
        matchedFiles.push(...findMatchedFiles(dir, folder, entries, isIgnored, matchesGlobs))
      }
      const { isStorybookFolder, isInDotFolder } = classifyFolder(dir, folder)
      if (isInDotFolder) {
        return
      }
      addCodeExtensions(folder, entries, isIgnored, codeExtensions)
      if (!findsTsconfigFiles) {
        return
      }
      const file = PROJECT_FILE_NAMES.map((name) => path.join(folder, name)).find((candidate) =>
        entries.some(
          (entry) => entry.name === path.basename(candidate) && isFileEntry(entry, candidate),
        ),
      )
      // The project service still opens a tsconfig that ESLint ignores
      if (file !== undefined) {
        tsconfigFiles.push(file)
      }
      if (
        file !== undefined &&
        path.basename(file) === 'tsconfig.json' &&
        !isDefaultIgnoredFrom(file)
      ) {
        astroProjectFolders.push(folder)
      }
      if (entries.some((entry) => entry.name === 'package.json' && entry.isFile())) {
        packageFolders.push(folder)
      }
      // ESLint doesn't lint an ignored file, and an ignored generated file, such as Vite's
      // `vite.config.ts.timestamp-1.mjs`, may come and go
      for (const entry of entries) {
        const file = path.join(folder, entry.name)
        const isCandidate = isStorybookFolder
          ? isStorybookCandidate(entry.name)
          : isDefaultProjectCandidate(entry.name)
        const extension = path.extname(entry.name)
        const isTypescript = TYPED_CODE_EXTNS_WITH_DOT.includes(extension)
        // Without `sourceFiles`, the ignore check is needed only until `hasTypescriptFiles`
        const isWanted =
          isCandidate ||
          (CODE_EXTNS_WITH_DOT.includes(extension) &&
            (collectsSourceFiles || (isTypescript && !hasTypescriptFiles)))
        if (!isWanted || !isFileEntry(entry, file) || isIgnored(file, false)) {
          continue
        }
        if (isCandidate) {
          configFiles.push(file)
          continue
        }
        const relativePath = posixRelative(dir, file)
        if (collectsSourceFiles) {
          sourceFiles.push(relativePath)
        }
        if (
          !hasTypescriptFiles &&
          isTypescript &&
          !isInDefaultProject(relativePath) &&
          !isUntyped(relativePath)
        ) {
          hasTypescriptFiles = true
        }
      }
    },
  })
  return {
    tsconfigFiles,
    configFiles,
    packageFolders,
    astroProjectFolders,
    matchedFiles,
    hasTypescriptFiles,
    sourceFiles,
    codeExtensions,
  }
}

/**
 * Merges sibling `.gitignore` files with the same rules, since ESLint tests every file against
 * every global ignore glob. A merged entry takes its first file's place, which keeps git's
 * precedence, since siblings' rules apply to separate folders
 */
function mergeSiblings(gitignores: ReadonlyArray<GitIgnores>, root: string): Array<GitIgnores> {
  const merged: Array<GitIgnores> = []
  const groups = new Map<string, GitIgnores & { folders: Array<string> }>()
  for (const gitignore of gitignores) {
    const parent = path.dirname(gitignore.basePath)
    if (!isInside(parent, root)) {
      merged.push(gitignore)
      continue
    }
    const key = JSON.stringify([parent, gitignore.ignores])
    const name = path.basename(gitignore.basePath)
    const group = groups.get(key)
    if (group === undefined) {
      const created = { ...gitignore, basePath: parent, folders: [name] }
      groups.set(key, created)
      merged.push(created)
    } else {
      group.folders.push(name)
    }
  }
  return merged.map(({ folders, ...gitignore }) =>
    folders?.length === 1
      ? { ...gitignore, basePath: path.join(gitignore.basePath, folders[0] ?? '') }
      : { ...gitignore, folders },
  )
}

/**
 * The git ignore rules, lowest precedence first, each relative to its own folder: `info/exclude`,
 * the `.gitignore` files git reads for `root`, `files`, then the submodule folders. One empty config
 * for each `GITIGNORE_CONFIG_NAMES` entry without rules. With `core.ignorecase`, rules match in any
 * case. The same walk finds the rest of `ProjectScan`
 */
export function scanProject({
  root,
  gitignore: option,
  ignores: globs,
  findsTsconfigFiles,
  matchedGlobs = [],
  defaultProjectGlobs = [],
  isUntyped = () => false,
  collectsSourceFiles = true,
}: {
  root: string
  gitignore: EslintConfigOptions['gitignore']
  ignores: ReadonlyArray<string>
  findsTsconfigFiles: boolean
  matchedGlobs?: ReadonlyArray<string> | undefined
  defaultProjectGlobs?: ReadonlyArray<string> | undefined
  isUntyped?: ((file: string) => boolean) | undefined
  collectsSourceFiles?: boolean | undefined
}): ProjectScan {
  const ignoresLayer: IgnoreLayer = { basePath: root, ignores: globs }
  if (option === false) {
    return {
      gitignores: [],
      ...(findsTsconfigFiles || matchedGlobs.length > 0
        ? walkProject({
            dir: root,
            gitignores: undefined,
            before: [],
            after: [ignoresLayer],
            skippedNames: getSkippedNames(globs),
            findsTsconfigFiles,
            matchedGlobs,
            defaultProjectGlobs,
            isUntyped,
            collectsSourceFiles,
          })
        : {
            tsconfigFiles: [],
            configFiles: [],
            packageFolders: [],
            astroProjectFolders: [],
            matchedFiles: [],
            hasTypescriptFiles: false,
            sourceFiles: [],
            codeExtensions: undefined,
          }),
    }
  }
  const extraFiles = (resolveSubOptions(option)?.files ?? []).map((file) => {
    const resolved = path.resolve(root, file)
    if (fs.statSync(resolved, { throwIfNoEntry: false })?.isFile() !== true) {
      fail(['`gitignore.files`'], `path \`${file}\` isn't a file`)
    }
    return resolved
  })
  const gitRoot = findGitRoot(root)
  const gitCommonDir = gitRoot === undefined ? undefined : findGitCommonDir(gitRoot)
  const ignoreCase = gitCommonDir !== undefined && readIgnoreCase(gitCommonDir)
  const excludePath =
    gitCommonDir === undefined ? undefined : path.join(gitCommonDir, 'info', 'exclude')
  // Relative to the repository's root, not its own folder
  const excludes: Array<GitIgnores> =
    gitRoot !== undefined && excludePath !== undefined && fs.existsSync(excludePath)
      ? [
          {
            name: 'gpahal/ignores/git-info-exclude',
            basePath: gitRoot,
            ignores: readIgnoreFile(excludePath, { root, ignoreCase }).ignores ?? [],
          },
        ]
      : []
  // Last, so no `!pattern` un-ignores them
  const modules: Array<GitIgnores> =
    gitRoot === undefined
      ? []
      : [
          {
            name: 'gpahal/ignores/git-modules',
            basePath: gitRoot,
            ignores: readGitModules(gitRoot),
          },
        ]
  const gitignoreFiles = findGitignoresAbove(root, gitRoot)
  const gitignores = gitignoreFiles.map((file) => readGitignore(file, { root, ignoreCase }))
  if (gitRoot !== undefined) {
    warnOfIgnoredRoot(root, gitRoot, [
      ...(excludePath === undefined || excludes.length === 0
        ? []
        : excludes.map((layer) => ({ file: excludePath, layer }))),
      ...gitignoreFiles.map((file, index) => ({ file, layer: gitignores[index] })),
    ])
  }
  // Git doesn't read them, so `core.ignorecase` doesn't apply
  const extras = extraFiles.map((file) => readGitignore(file, { root, ignoreCase: false }))
  const walked = walkProject({
    dir: root,
    gitignores,
    ignoreCase,
    before: excludes,
    after: [...extras, ...modules, ignoresLayer],
    skippedNames: getSkippedNames(globs),
    findsTsconfigFiles,
    matchedGlobs,
    defaultProjectGlobs,
    isUntyped,
    collectsSourceFiles,
  })
  const layers = [...excludes, ...mergeSiblings(gitignores, root), ...extras, ...modules].filter(
    ({ ignores: layerGlobs }) => layerGlobs.length > 0,
  )
  return {
    // Each name is always there, so composer methods can name it in any checkout
    gitignores: GITIGNORE_CONFIG_NAMES.flatMap((name) => {
      const named = layers.filter((layer) => layer.name === name)
      return named.length > 0 ? named : { name, basePath: root, ignores: [] }
    }),
    ...walked,
  }
}
