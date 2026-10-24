import fs from 'node:fs'
import path from 'node:path'

import { formatSomeNames, joinList } from '@gpahal/internal/lists'
import { resolveListOption, resolveSubOptions } from '@gpahal/internal/node/options'
import type { ListOption } from '@gpahal/internal/node/options'
import { toArray, unique, uniqueBy } from '@gpahal/std/arrays'
import { formatNames } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import { getEnabledAreas } from '@/internal/areas'
import { IGNORES } from '@/internal/configs/ignores'
import {
  checkDefaultProjectTsconfig,
  discoverProjects,
  isAstroTypesFileMissing,
  isDefaultProjectCandidate,
  isStorybookCandidate,
  STORYBOOK_FOLDER,
} from '@/internal/default-project'
import type { DefaultProjectProblem, ProjectDiscovery } from '@/internal/default-project'
import { isInEditorEnv } from '@/internal/editor'
import {
  ASTRO_FILES,
  ASTRO_SCRIPT_FILES,
  CODE_BLOCK_FILES,
  CODE_EXTNS,
  CODE_FILES,
  HTML_FILES,
  JAVASCRIPT_EXTNS,
  PLAYWRIGHT_FILES,
  STORYBOOK_FILES,
  TEST_FILES,
  TYPED_CODE_EXTNS_WITH_DOT,
  TYPED_CODE_FILES,
  UNTYPED_CODE_FILES,
} from '@/internal/files'
import { findPackageJson } from '@/internal/fs'
import { canMatchFile, canMatchOtherFile } from '@/internal/glob-match'
import {
  createGlobMatcher,
  createListMatcher,
  escapeGlob,
  folderGlob,
  GLOBAL_IGNORES_KEYS,
  globsAsFiles,
  globsAsIgnores,
  intersectFiles,
  intersectFileSpecs,
  isLiteralGlob,
  isSameFiles,
  posixRelative,
  splitGlobs,
  unescapeGlob,
  withNegatedGlobs,
  withoutGlobFiles,
  withoutLeadingDotSlash,
} from '@/internal/globs'
import type { FileSpecs, Scope } from '@/internal/globs'
import { usesReactCompiler, warnOfOptionHints, warnOfPlaywrightTestDir } from '@/internal/hints'
import { readProjectManifests } from '@/internal/manifests'
import { GITIGNORE_CONFIG_NAMES } from '@/internal/names'
import type { AreaName } from '@/internal/names'
import { checkTypescriptInstalled } from '@/internal/peers'
import { scanProject } from '@/internal/project-scan'
import type { GitIgnores } from '@/internal/project-scan'
import type { EslintConfigOptions, NextjsOptions } from '@/internal/types'
import type { UntypedKinds } from '@/internal/user-configs'
import { formatErrorMessage, PREFIX, warnOfSetupOnce } from '@/internal/utils'
import type { GpahalWarningCode } from '@/internal/utils'
import {
  checkCodeGlobs,
  checkDefaultProjectGlobs,
  checkRelativeGlobs,
  CODE_FILE_TARGET,
} from '@/internal/validate'
import type { GlobTarget } from '@/internal/validate'
import { createIgnoreCheck, IgnoreLayers } from '@/internal/walk'
import type { IgnoreLayer } from '@/internal/walk'

/**
 * The options with their defaults applied, and what they imply, worked out once
 */
export type ResolvedOptions = {
  options: EslintConfigOptions
  root: string
  isOn: Readonly<Record<AreaName, boolean>>
  isInEditor: boolean
  /**
   * `.astro` files included with `astro`
   */
  codeFiles: Array<string>
  typedCodeFiles: Array<string>
  /**
   * The union of `testFiles` and the enabled `vitest.files` and `playwright.files`
   */
  testFiles: FileSpecs
  /**
   * Each list option that `testFiles` unites, for a linear complement in `withoutGlobFiles`
   */
  testGlobs: Array<ReadonlyArray<string>>
  nonTestFiles: FileSpecs
  /**
   * Outside the files of `playwright`, whose exclusions stay Vitest's
   */
  vitestFiles: FileSpecs
  playwrightFiles: FileSpecs
  storybookFiles: FileSpecs
  /**
   * The code files without type information. Its JavaScript files leave out those of
   * `allowDefaultProject`, which the default project types
   */
  untyped: Scope
  /**
   * `undefined` with `typeAware: false`
   */
  untypedKinds: UntypedKinds | undefined
  /**
   * `undefined` for none or without type information
   */
  allowDefaultProject: Array<string> | undefined
  defaultProjectFileCount: number
  /**
   * `/`-separated paths relative to `root`
   */
  defaultProjectFiles: Array<string>
  /**
   * The TypeScript files the project service will report as not found, sorted. `[]` without type
   * information or with an `allowDefaultProject` array, which skips parsing the tsconfigs
   */
  filesOutsideTsconfigs: Array<string>
  /**
   * Called by the finalizer with the final configs, so files a later global ignore ignores don't count
   */
  warnOfProjectScan: (configs: ReadonlyArray<unknown>) => void
  /**
   * `ignores` that ignore the CommonJS `.js` files and no other, to put before other `ignores`
   */
  commonjs: { files: FileSpecs; ignores: Array<string> }
  browserFiles: FileSpecs
  serverFiles: FileSpecs
  serverIgnores: Array<string>
  /**
   * `undefined` with `typeAware: false` or in a JavaScript-only project
   */
  typeAware: Required<Scope> | undefined
  /**
   * Only JavaScript files, no tsconfig or jsconfig at `root`, no `typeAware.javascript`, and no
   * `needsTypescriptEslint`
   */
  javascriptOnly: boolean
  isAstroTyped: boolean
  /**
   * Under a folder with a `tsconfig.json`. Others would fail to parse with type information
   */
  typedAstroFiles: Array<string>
  gitignores: Array<GitIgnores>
  ignores: Array<string>
  /**
   * Each folder's `tsconfig.json`, or else its `jsconfig.json`, outside the ignores, or `[]` when
   * neither the import resolver, the `node` preset, Astro nor the default `allowDefaultProject`
   * needs them
   */
  tsconfigFiles: Array<string>
  /**
   * Globs that match the files in a package's `src` folder, but not a nested package's, or `[]` when
   * the `imports` area and the `node` preset are off
   */
  packageSourceGlobs: Array<string>
  nextjsRootDirs: Array<string>
  presetFiles: Readonly<Record<'react' | 'nextjs' | 'node' | 'tailwindcss', FileSpecs>>
  reactCompiler: boolean
}

/**
 * Each positive `scope` glob must be able to match a file of `target`
 */
function getPresetFiles(
  root: string,
  name: string,
  scope: ReadonlyArray<string> | undefined,
  defaults: Array<string>,
  target: GlobTarget = CODE_FILE_TARGET,
): FileSpecs {
  if (scope === undefined) {
    return defaults
  }
  checkCodeGlobs(name, scope, root, target)
  const { positive, negated } = splitGlobs(scope)
  return withNegatedGlobs(intersectFiles(positive, defaults), negated)
}

function resolveGlobs(
  name: string,
  option: ListOption | undefined,
  defaults: ReadonlyArray<string>,
): Array<string> {
  return resolveListOption(option, defaults, {
    prefix: PREFIX,
    name,
    expected: 'an array of globs',
  })
}

/**
 * At least one positive glob, each able to match a code file. `[]` defaults must list globs
 */
function resolveCodeGlobs(
  root: string,
  name: string,
  option: ListOption | undefined,
  defaults: ReadonlyArray<string>,
): Array<string> {
  const globs = resolveGlobs(name, option, defaults)
  checkCodeGlobs(name, globs, root, CODE_FILE_TARGET, defaults.length > 0)
  return globs
}

const COMMONJS_FILE_TARGET: GlobTarget = { extensions: ['js'], description: '`.js` file' }

function resolveCommonjs(
  root: string,
  option: EslintConfigOptions['commonjs'],
): ResolvedOptions['commonjs'] {
  if (option === undefined || option === false) {
    return { files: [], ignores: [] }
  }
  const globs = resolveGlobs('commonjs.files', resolveSubOptions(option)?.files, ['**/*.js'])
  checkCodeGlobs('commonjs.files', globs, root, COMMONJS_FILE_TARGET)
  return {
    files: intersectFiles(globsAsFiles(globs), ['**/*.js']),
    // A later `!` glob un-ignores what an earlier one ignores, so non-`.js` files are un-ignored last
    ignores: [
      ...globsAsIgnores(globs),
      `!**/*.{${CODE_EXTNS.filter((extn) => extn !== 'js').join(',')}}`,
    ],
  }
}

function resolvePresetGlobs(
  root: string,
  isOn: Readonly<Record<AreaName, boolean>>,
  name: 'playwright' | 'storybook',
  option: boolean | { files?: ListOption | undefined } | undefined,
  defaults: ReadonlyArray<string>,
): Array<string> {
  return isOn[name]
    ? resolveCodeGlobs(root, `${name}.files`, resolveSubOptions(option)?.files, defaults)
    : []
}

/**
 * A glob that can match another file, such as `tests/**`, is ANDed with the code globs, or the code
 * rules would crash on `tests/tsconfig.json`
 */
function codeFilesOf(name: string, globs: ReadonlyArray<string>): FileSpecs {
  const { positive, negated } = splitGlobs(globs)
  return withNegatedGlobs(
    positive.flatMap((glob) =>
      canMatchOtherFile([`\`${name}\``], glob, CODE_EXTNS)
        ? intersectFiles([glob], CODE_FILES)
        : glob,
    ),
    negated,
  )
}

/**
 * `vitestFiles` left out when empty or the same as `testFiles`, and `playwrightFiles` when empty
 */
function getTestGlobs(
  testFiles: ReadonlyArray<string>,
  vitestFiles: ReadonlyArray<string>,
  playwrightFiles: ReadonlyArray<string>,
): Array<ReadonlyArray<string>> {
  return [
    testFiles,
    ...(vitestFiles.length > 0 && !isSameFiles([...testFiles], [...vitestFiles])
      ? [vitestFiles]
      : []),
    ...(playwrightFiles.length > 0 ? [playwrightFiles] : []),
  ]
}

function getNonTestFiles([testFiles = [], ...others]: ReadonlyArray<
  ReadonlyArray<string>
>): FileSpecs {
  return others.reduce(
    (files, globs) => intersectFileSpecs(files, nonMatchingFiles(globs)),
    nonMatchingFiles(testFiles),
  )
}

/**
 * `.jsx` files aside, which no config file is
 */
const JAVASCRIPT_FILES = `**/*.{${JAVASCRIPT_EXTNS.join(',')}}`

/**
 * A typed config glob needn't name an extension, as with `*.config.*`, so the untyped JavaScript
 * files are an AND entry that leaves the globs out, and the `ignores` un-ignore the globs, then
 * re-ignore the untyped non-JavaScript files they would un-ignore, such as `.jsx` files
 */
function getUntypedScopes(
  untypedFiles: ReadonlyArray<string>,
  typedConfigGlobs: ReadonlyArray<string>,
  typedAstroFiles: ReadonlyArray<string>,
): { untyped: Scope; typeAwareIgnores: Array<string> } {
  const { untyped, typeAwareIgnores } = getUntypedCodeScopes(untypedFiles, typedConfigGlobs)
  if (typedAstroFiles.length === 0) {
    return { untyped, typeAwareIgnores }
  }
  return {
    untyped: { files: [...untyped.files, ...withNegatedGlobs(ASTRO_FILES, typedAstroFiles)] },
    typeAwareIgnores: [
      ...typeAwareIgnores,
      ...ASTRO_FILES,
      ...typedAstroFiles.map((glob) => `!${glob}`),
    ],
  }
}

function getUntypedKinds({
  root,
  isTypeAware,
  isJavascriptTyped,
  typedConfigGlobs,
  isOn,
  isAstroTyped,
  typeAwareIgnoreGlobs,
}: {
  root: string
  isTypeAware: boolean
  isJavascriptTyped: boolean
  typedConfigGlobs: ReadonlyArray<string>
  isOn: Readonly<Record<AreaName, boolean>>
  isAstroTyped: boolean
  typeAwareIgnoreGlobs: ReadonlyArray<string>
}): UntypedKinds | undefined {
  if (!isTypeAware) {
    return undefined
  }
  return {
    root,
    isJavascriptTyped,
    typedJavascriptGlobs: typedConfigGlobs,
    isAstroUntyped: isOn.astro && !isAstroTyped,
    ignores: typeAwareIgnoreGlobs,
  }
}

/**
 * The `typeAware.ignores` come last, after the `!` globs that un-ignore typed files
 */
function withTypeAwareIgnores(
  scopes: { untyped: Scope; typeAwareIgnores: Array<string> },
  globs: ReadonlyArray<string>,
  codeFiles: ReadonlyArray<string>,
): { untyped: Scope; typeAwareIgnores: Array<string> } {
  if (globs.length === 0) {
    return scopes
  }
  return {
    untyped: {
      ...scopes.untyped,
      files: [...scopes.untyped.files, ...intersectFileSpecs(globsAsFiles(globs), [...codeFiles])],
    },
    typeAwareIgnores: [...scopes.typeAwareIgnores, ...globsAsIgnores(globs)],
  }
}

function getUntypedCodeScopes(
  untypedFiles: ReadonlyArray<string>,
  typedConfigGlobs: ReadonlyArray<string>,
): { untyped: Scope; typeAwareIgnores: Array<string> } {
  if (typedConfigGlobs.length === 0 || !untypedFiles.includes(UNTYPED_CODE_FILES[0] ?? '')) {
    return { untyped: { files: [...untypedFiles] }, typeAwareIgnores: [...untypedFiles] }
  }
  const nonJavascriptFiles = [
    '**/*.jsx',
    ...untypedFiles.filter((glob) => !UNTYPED_CODE_FILES.includes(glob)),
  ]
  return {
    untyped: {
      files: [...withNegatedGlobs([JAVASCRIPT_FILES], typedConfigGlobs), ...nonJavascriptFiles],
    },
    typeAwareIgnores: [
      ...untypedFiles,
      ...typedConfigGlobs.map((glob) => `!${glob}`),
      ...nonJavascriptFiles,
    ],
  }
}

function getFolderDepth(folder: string): number {
  return folder === '' ? 0 : folder.split('/').length
}

/**
 * Shallower packages first, each un-ignoring its own files, so a package nested in another's `src`
 * folder is matched only by its own `src` glob
 */
function getPackageSourceGlobs(root: string, packageFolders: ReadonlyArray<string>): Array<string> {
  return packageFolders
    .map((folder) => posixRelative(root, folder))
    .toSorted((a, b) => getFolderDepth(a) - getFolderDepth(b))
    .flatMap((folder) =>
      folder === '' ? 'src/**' : [`!${escapeGlob(folder)}/**`, `${escapeGlob(folder)}/src/**`],
    )
}

/**
 * An array as it is, or the defaults through a function. `undefined` for none
 */
function resolveAllowDefaultProject(
  root: string,
  options: EslintConfigOptions,
  isTyped: boolean,
  findDefaults: () => Array<string>,
): Array<string> | undefined {
  if (!isTyped) {
    return undefined
  }
  const option = resolveSubOptions(options.typeAware)?.allowDefaultProject
  const globs = resolveGlobs(
    'typeAware.allowDefaultProject',
    option,
    typeof option === 'function' || option === undefined ? findDefaults() : [],
  )
  checkRelativeGlobs('typeAware.allowDefaultProject', globs, root)
  checkDefaultProjectGlobs(globs)
  // typescript-eslint matches the globs against paths without a leading `./`
  const relativeGlobs = globs.map((glob) => withoutLeadingDotSlash(glob))
  return relativeGlobs.length > 0 ? relativeGlobs : undefined
}

function resolveTypeAwareIgnores(
  root: string,
  options: EslintConfigOptions,
  isTyped: boolean,
  isAstro: boolean,
): Array<string> {
  if (!isTyped) {
    return []
  }
  // ESLint matches `./src/**` as `src/**`, which the walk's matchers wouldn't
  const globs = resolveGlobs(
    'typeAware.ignores',
    resolveSubOptions(options.typeAware)?.ignores,
    [],
  ).map((glob) => withoutLeadingDotSlash(glob))
  if (globs.length > 0) {
    checkCodeGlobs(
      'typeAware.ignores',
      globs,
      root,
      isAstro
        ? {
            extensions: [...CODE_EXTNS, 'astro'],
            description: 'JavaScript, TypeScript or `.astro` file',
          }
        : CODE_FILE_TARGET,
    )
  }
  return globs
}

function getTailwindcssTarget(isOn: Readonly<Record<AreaName, boolean>>): GlobTarget {
  const extensions = [...(isOn.astro ? ['astro'] : []), ...(isOn.html ? ['html'] : [])]
  const kinds = ['JavaScript', 'TypeScript', ...extensions.map((extn) => `\`.${extn}\``)]
  return {
    extensions: [...CODE_EXTNS, ...extensions],
    description: `${joinList(kinds, 'or')} file`,
  }
}

function getTypedAstroFiles(root: string, projectFolders: ReadonlyArray<string>): Array<string> {
  const folders = projectFolders.map((folder) => posixRelative(root, folder))
  return folders.includes('')
    ? [...ASTRO_FILES]
    : folders.map((folder) => `${escapeGlob(folder)}/${ASTRO_FILES[0] ?? ''}`)
}

/**
 * Every code file with `typeAware: false` or in a JavaScript-only project, else untyped JavaScript, code blocks, Astro scripts, and
 * `.astro` files when no folder has a `tsconfig.json`
 */
function getUntypedFiles({
  isTyped,
  isJavascriptTyped,
  isAstro,
  isAstroTyped,
}: {
  isTyped: boolean
  isJavascriptTyped: boolean
  isAstro: boolean
  isAstroTyped: boolean
}): Array<string> {
  if (!isTyped) {
    return [
      ...CODE_FILES,
      ...CODE_BLOCK_FILES,
      ...(isAstro ? [...ASTRO_FILES, ...ASTRO_SCRIPT_FILES] : []),
    ]
  }
  return [
    ...(isJavascriptTyped ? [] : UNTYPED_CODE_FILES),
    ...CODE_BLOCK_FILES,
    ...(isAstro ? ASTRO_SCRIPT_FILES : []),
    ...(isAstro && !isAstroTyped ? ASTRO_FILES : []),
  ]
}

function nonMatchingFiles(globs: ReadonlyArray<string>): FileSpecs {
  const { positive, negated } = splitGlobs(globs)
  return [
    ...withNegatedGlobs(TYPED_CODE_FILES, positive),
    ...intersectFiles(TYPED_CODE_FILES, negated),
  ]
}

/**
 * Keeps a warning to once per root and process, as editors reload the config
 */
const warnedTypeRoots = new Set<string>()

function describeDefaultProjectProblem(
  root: string,
  files: ReadonlyArray<string>,
  problem: DefaultProjectProblem,
): string {
  const examples = formatSomeNames(files, 3)
  const tsconfig = formatNames([path.join(root, 'tsconfig.json')])
  const jsconfig = path.join(root, 'jsconfig.json')
  const { reason, fix } = {
    missing: {
      reason: "which doesn't exist",
      fix: fs.existsSync(jsconfig)
        ? `Add those files to the \`include\` of ${formatNames([jsconfig])}`
        : 'Add a tsconfig.json at `root` with `"compilerOptions": { "types": ["node"] }`, or list those files in a tsconfig',
    },
    unparseable: {
      reason: `which fails to parse: ${problem.kind === 'unparseable' ? problem.diagnostic : ''}`,
      fix: 'Fix the error in that tsconfig, or list those files in a tsconfig that parses',
    },
    'no-inputs': {
      reason: 'which typescript-eslint ignores, since it includes no files',
      fix: 'Include a TypeScript file in it, or generate the types it includes, as `astro sync` does in an Astro project',
    },
    'no-node-types': {
      reason: 'whose "types" doesn\'t list "node"',
      fix:
        problem.kind === 'no-node-types' && problem.types.length > 0
          ? `Add "node" to its "types", keeping the entries it has or inherits, since a "types" list replaces an inherited one, as in \`"types": [${[...problem.types, 'node'].map((type) => JSON.stringify(type)).join(', ')}]\`, or list those files in a tsconfig that does`
          : 'Add "node" to its "types", or list those files in a tsconfig that does',
    },
    'node-types-missing': {
      reason: 'whose "types" lists "node", but @types/node isn\'t installed',
      fix: 'Install @types/node as a dev dependency',
    },
  }[problem.kind]
  const install =
    problem.kind !== 'node-types-missing' && findPackageJson('@types/node', root) === undefined
      ? ', and install @types/node'
      : ''
  // `allowDefaultProject` may add files other than config files, such as tests
  const isAllConfigFiles = files.every((file) => {
    const name = path.posix.basename(file)
    return (
      isDefaultProjectCandidate(name) ||
      (path.posix.basename(path.posix.dirname(file)) === STORYBOOK_FOLDER &&
        isStorybookCandidate(name))
    )
  })
  return `${isAllConfigFiles ? 'config files' : 'files'} that no tsconfig includes, such as ${examples}, get type information from the compiler options of ${tsconfig}, ${reason}, so they're checked without Node's types. ${fix}${install}`
}

/**
 * Without a warning, type-checked rules report on those files with no hint of the cause
 */
function warnOfUntypedFiles({
  root,
  defaultProjectFiles,
  hasNoTsconfig,
}: {
  root: string
  defaultProjectFiles: ReadonlyArray<string>
  hasNoTsconfig: boolean
}): void {
  if (warnedTypeRoots.has(root)) {
    return
  }
  let description: string | undefined
  let code: GpahalWarningCode = 'GPAHAL_NO_TSCONFIG'
  if (hasNoTsconfig) {
    description = `no tsconfig.json was found at or under ${formatNames([root])}, so typescript-eslint's project service can't type TypeScript files and reports each as not found by the project service. Config files such as \`eslint.config.mjs\` get no Node types either, so type-checked rules report on them. Add a tsconfig.json at \`root\` with \`"compilerOptions": { "types": ["node"] }\`, which fixes both, or set \`typeAware: false\``
  } else if (defaultProjectFiles.length > 0) {
    const problem = checkDefaultProjectTsconfig(root)
    if (problem !== undefined) {
      description = describeDefaultProjectProblem(root, defaultProjectFiles, problem)
      code = 'GPAHAL_DEFAULT_PROJECT_NODE_TYPES'
    }
  }
  if (description === undefined) {
    return
  }
  warnOfSetupOnce(warnedTypeRoots, root, formatErrorMessage(['`typeAware`'], description), code)
}

/**
 * The limit `defineConfig` sets for up to 8 files. Each file costs about 40 ms to type, against
 * about 5 ms in a tsconfig, so config files in fixtures can add seconds unnoticed
 */
const LARGE_DEFAULT_PROJECT_FILE_COUNT = 16

const warnedLargeDefaultProjectRoots = new Set<string>()

function warnOfLargeDefaultProject(root: string, files: ReadonlyArray<string>): void {
  if (
    files.length <= LARGE_DEFAULT_PROJECT_FILE_COUNT ||
    warnedLargeDefaultProjectRoots.has(root)
  ) {
    return
  }
  warnOfSetupOnce(
    warnedLargeDefaultProjectRoots,
    root,
    formatErrorMessage(
      ['`typeAware.allowDefaultProject`'],
      `${String(files.length)} files, such as ${formatSomeNames(files, 3)}, get type information from typescript-eslint's default project, which takes about 8 times as long per file as a tsconfig's. Include them in a tsconfig, list the ones to type in \`typeAware.allowDefaultProject\`, or ignore folders such as fixtures with \`ignores\``,
    ),
    'GPAHAL_LARGE_DEFAULT_PROJECT',
  )
}

const MAX_NAMED_FILES_OUTSIDE_TSCONFIGS = 10

const warnedFilesOutsideTsconfigsRoots = new Set<string>()

/**
 * Without a tsconfig, `GPAHAL_NO_TSCONFIG` covers them
 */
function warnOfFilesOutsideTsconfigs(
  root: string,
  files: ReadonlyArray<string>,
  tsconfigFiles: ReadonlyArray<string>,
): void {
  if (
    files.length === 0 ||
    tsconfigFiles.length === 0 ||
    warnedFilesOutsideTsconfigsRoots.has(root)
  ) {
    return
  }
  const names = formatSomeNames(files, MAX_NAMED_FILES_OUTSIDE_TSCONFIGS)
  // From the project, not the run, so a one-file run or an editor gets them too
  const count =
    files.length === 1
      ? '1 TypeScript file in the project'
      : `${String(files.length)} TypeScript files in the project`
  warnOfSetupOnce(
    warnedFilesOutsideTsconfigsRoots,
    root,
    formatErrorMessage(
      ['`typeAware`'],
      `${count}, ${names}, ${files.length === 1 ? 'is' : 'are'} in no tsconfig's project, so typescript-eslint's project service reports ${files.length === 1 ? 'it' : 'each'} as not found when it lints ${files.length === 1 ? 'it' : 'them'}. Add ${files.length === 1 ? 'it' : 'them'} to a tsconfig's \`include\`, or to \`typeAware.allowDefaultProject\``,
    ),
    'GPAHAL_FILES_OUTSIDE_TSCONFIG',
  )
}

const warnedAstroTypesRoots = new Set<string>()

function warnOfMissingAstroTypes(root: string, isOn: Readonly<Record<AreaName, boolean>>): void {
  if (!isOn.astro || warnedAstroTypesRoots.has(root) || !isAstroTypesFileMissing(root)) {
    return
  }
  warnOfSetupOnce(
    warnedAstroTypesRoots,
    root,
    formatErrorMessage(
      ['`astro`'],
      `${formatNames([path.join(root, 'tsconfig.json')])} includes \`.astro/types.d.ts\`, which doesn't exist, so the type-aware rules read Astro's types, such as those of \`astro:content\`, as error types and report them. Run \`astro sync\` before ESLint, as in \`astro sync && eslint .\``,
    ),
    'GPAHAL_ASTRO_TYPES_MISSING',
  )
}

/**
 * `undefined` without `scope` or `rootDir`, as React's files are then the preset's
 */
function getNextjsFiles(
  root: string,
  nextjsOptions: Pick<NextjsOptions, 'scope' | 'rootDir'> | undefined,
): FileSpecs | undefined {
  if (nextjsOptions?.scope !== undefined) {
    return getPresetFiles(root, 'nextjs.scope', nextjsOptions.scope, CODE_FILES)
  }
  if (nextjsOptions?.rootDir === undefined) {
    return undefined
  }
  return getPresetFiles(
    root,
    'nextjs.rootDir',
    toArray(nextjsOptions.rootDir).map((rootDir) => folderGlob(root, path.resolve(root, rootDir))),
    CODE_FILES,
  )
}

const TYPESCRIPT_ESLINT_PREFIX = '@typescript-eslint/'

function namesTypescriptEslint(items: ReadonlyArray<unknown>): boolean {
  return items.some((item) => {
    if (Array.isArray(item)) {
      return namesTypescriptEslint(item)
    }
    if (!isRecord(item)) {
      return false
    }
    const { rules, plugins, extends: extended } = item
    return (
      (isRecord(rules) &&
        Object.keys(rules).some((rule) => rule.startsWith(TYPESCRIPT_ESLINT_PREFIX))) ||
      (isRecord(plugins) && Object.hasOwn(plugins, TYPESCRIPT_ESLINT_PREFIX.slice(0, -1))) ||
      (Array.isArray(extended) && namesTypescriptEslint(extended))
    )
  })
}

function needsTypescriptEslint(
  options: EslintConfigOptions,
  isOn: Readonly<Record<AreaName, boolean>>,
): boolean {
  const typescriptOptions = resolveSubOptions(options.typescript)
  return (
    isOn.astro ||
    resolveSubOptions(options.typeAware)?.allowDefaultProject !== undefined ||
    Object.keys(typescriptOptions?.rulesTypeAware ?? {}).length > 0 ||
    Object.keys(typescriptOptions?.rules ?? {}).some((rule) =>
      rule.startsWith(TYPESCRIPT_ESLINT_PREFIX),
    ) ||
    namesTypescriptEslint(options.configs ?? [])
  )
}

/**
 * An array, even an empty one, skips parsing the tsconfigs. The default leaves out JavaScript files
 * in a JavaScript project, and always the files of `typeAware.ignores`
 */
function findAllowDefaultProject({
  options,
  root,
  isTyped,
  isDefaultProjectListed,
  listedDefaultProject,
  isJavascriptProject,
  tsconfigFiles,
  configFiles,
  sourceFiles,
  isIgnored,
}: {
  options: EslintConfigOptions
  root: string
  isTyped: boolean
  isDefaultProjectListed: boolean
  listedDefaultProject: Array<string> | undefined
  isJavascriptProject: boolean
  tsconfigFiles: ReadonlyArray<string>
  configFiles: ReadonlyArray<string>
  sourceFiles: ReadonlyArray<string>
  isIgnored: (file: string) => boolean
}): { discovery: ProjectDiscovery | undefined; allowDefaultProject: Array<string> | undefined } {
  if (isDefaultProjectListed) {
    return { discovery: undefined, allowDefaultProject: listedDefaultProject }
  }
  const discovery = isTyped
    ? discoverProjects(root, tsconfigFiles, configFiles, sourceFiles)
    : undefined
  // Escaped, since typescript-eslint and ESLint read them as globs, where `[slug]` isn't literal
  const allowDefaultProject = resolveAllowDefaultProject(root, options, isTyped, () =>
    (discovery?.defaultProjectFiles ?? [])
      .filter(
        (file) =>
          (!isJavascriptProject || !JAVASCRIPT_EXTNS.includes(path.extname(file).slice(1))) &&
          !isIgnored(file),
      )
      .map((file) => escapeGlob(file)),
  )
  return { discovery, allowDefaultProject }
}

function withoutDefaultProjectFiles(
  files: ReadonlyArray<string>,
  allowDefaultProject: ReadonlyArray<string> | undefined,
): Array<string> {
  if (allowDefaultProject === undefined || files.length === 0) {
    return [...files]
  }
  const isInDefaultProject = createGlobMatcher(allowDefaultProject)
  return files.filter((file) => !isInDefaultProject(file))
}

/**
 * The literal paths of `allowDefaultProject`, and the files its globs match: `matchedFiles` for an
 * array, or `walkedFiles` matched afterwards for a function, since the walk ran before it added
 * globs
 */
function getDefaultProjectFiles({
  allowDefaultProject = [],
  isFunction,
  matchedFiles,
  walkedFiles,
}: {
  allowDefaultProject: ReadonlyArray<string> | undefined
  isFunction: boolean
  matchedFiles: ReadonlyArray<string>
  walkedFiles: ReadonlyArray<string>
}): Array<string> {
  const globs = isFunction ? allowDefaultProject.filter((glob) => !isLiteralGlob(glob)) : []
  const matchesGlobs = globs.length === 0 ? () => false : createGlobMatcher(globs)
  return unique([
    ...allowDefaultProject.filter((glob) => isLiteralGlob(glob)).map((glob) => unescapeGlob(glob)),
    ...matchedFiles,
    ...walkedFiles.filter((file) => matchesGlobs(file)),
  ])
}

function findUserIgnores(root: string, items: ReadonlyArray<unknown>): Array<IgnoreLayer> {
  return items.flatMap((item): Array<IgnoreLayer> => {
    if (Array.isArray(item)) {
      return findUserIgnores(root, item)
    }
    if (
      !isRecord(item) ||
      !Array.isArray(item['ignores']) ||
      Object.keys(item).some((key) => !GLOBAL_IGNORES_KEYS.has(key))
    ) {
      return []
    }
    const { basePath } = item
    return [
      {
        basePath: path.resolve(root, typeof basePath === 'string' ? basePath : '.'),
        ignores: item['ignores'].filter((glob) => typeof glob === 'string'),
      },
    ]
  })
}

const GITIGNORE_NAMES: ReadonlySet<unknown> = new Set(GITIGNORE_CONFIG_NAMES)

/**
 * ESLint skips the files of an ignored folder
 */
function createUserIgnoresCheck(
  root: string,
  configs: ReadonlyArray<unknown>,
): (file: string) => boolean {
  const layers = findUserIgnores(root, configs)
  if (layers.length === 0) {
    return () => false
  }
  const isIgnored = createIgnoreCheck(new IgnoreLayers(layers))
  return (file) => {
    const segments = file.split('/')
    return segments.some((_, index) =>
      isIgnored(path.join(root, ...segments.slice(0, index + 1)), index < segments.length - 1),
    )
  }
}

/**
 * The folders under `root` are walked at most once
 */
export function resolveOptions(options: EslintConfigOptions): ResolvedOptions {
  // Normalized, so the walk's `path.join` paths can equal it
  const root = path.resolve(options.root)
  const isOn = getEnabledAreas(options)
  const isTypeAware = options.typeAware !== false
  const typeAwareIgnoreGlobs = resolveTypeAwareIgnores(root, options, isTypeAware, isOn.astro)
  const isTypeAwareIgnored = createListMatcher(typeAwareIgnoreGlobs)
  const ignores = resolveGlobs('ignores', options.ignores, IGNORES)
  checkRelativeGlobs('ignores', ignores, root)
  const testFiles = resolveCodeGlobs(root, 'testFiles', options.testFiles, TEST_FILES)
  const playwrightFiles = resolvePresetGlobs(
    root,
    isOn,
    'playwright',
    options.playwright,
    PLAYWRIGHT_FILES,
  )
  // Playwright's tests, which `testFiles` matches, aren't Vitest's
  const vitestFiles = resolveCodeGlobs(
    root,
    'vitest.files',
    resolveSubOptions(options.vitest)?.files,
    testFiles,
  )
  const vitestFileSpecs = withoutGlobFiles(
    codeFilesOf('vitest.files', vitestFiles),
    playwrightFiles,
  )
  const testGlobs = getTestGlobs(testFiles, isOn.vitest ? vitestFiles : [], playwrightFiles)
  const storybookFiles = resolvePresetGlobs(
    root,
    isOn,
    'storybook',
    options.storybook,
    STORYBOOK_FILES,
  )
  const commonjs = resolveCommonjs(root, options.commonjs)
  const browser = resolveSubOptions(options.browser)
  const browserFiles =
    browser === undefined ? [] : resolveCodeGlobs(root, 'browser.files', browser.files, [])
  const server = resolveSubOptions(options.server)
  const serverFiles =
    server === undefined ? [] : resolveCodeGlobs(root, 'server.files', server.files, [])
  const allowDefaultProjectOption = resolveSubOptions(options.typeAware)?.allowDefaultProject
  const isDefaultProjectListed = Array.isArray(allowDefaultProjectOption)
  // An array resolves before the walk, which counts the files its globs match
  const listedDefaultProject = isDefaultProjectListed
    ? resolveAllowDefaultProject(root, options, isTypeAware, () => [])
    : undefined
  const findsTsconfigFiles =
    (isTypeAware && (!isDefaultProjectListed || isOn.astro)) || isOn.imports
  const {
    gitignores,
    tsconfigFiles,
    configFiles,
    packageFolders,
    astroProjectFolders,
    matchedFiles,
    hasTypescriptFiles,
    sourceFiles,
    codeExtensions,
  } = scanProject({
    root,
    gitignore: options.gitignore,
    ignores,
    findsTsconfigFiles: findsTsconfigFiles || isOn.node,
    matchedGlobs: listedDefaultProject?.filter((glob) => !isLiteralGlob(glob)) ?? [],
    defaultProjectGlobs: listedDefaultProject,
    isUntyped: isTypeAwareIgnored,
    collectsSourceFiles: isTypeAware && !isDefaultProjectListed,
  })
  const isJavascriptTyped = resolveSubOptions(options.typeAware)?.javascript === true
  const javascriptOnly =
    !isJavascriptTyped &&
    codeExtensions !== undefined &&
    TYPED_CODE_EXTNS_WITH_DOT.every((extension) => !codeExtensions.has(extension)) &&
    ['tsconfig.json', 'jsconfig.json'].every((name) => !fs.existsSync(path.join(root, name))) &&
    !needsTypescriptEslint(options, isOn)
  // Before anything loads TypeScript
  checkTypescriptInstalled(!javascriptOnly)
  // A JavaScript-only project's files would get no type information anyway
  const isTyped = options.typeAware !== false && !javascriptOnly
  // A JavaScript project's config files are untyped too: a default project without a tsconfig
  // would lack Node's types, so `import.meta.dirname` would be an error type
  const isJavascriptProject =
    !isJavascriptTyped &&
    !hasTypescriptFiles &&
    tsconfigFiles.every(
      (file) => path.dirname(file) !== root || path.basename(file) !== 'tsconfig.json',
    )
  const { discovery, allowDefaultProject } = findAllowDefaultProject({
    options,
    root,
    isTyped,
    isDefaultProjectListed,
    listedDefaultProject,
    isJavascriptProject,
    tsconfigFiles,
    configFiles,
    sourceFiles,
    isIgnored: isTypeAwareIgnored,
  })
  const defaultProjectFiles = getDefaultProjectFiles({
    allowDefaultProject,
    isFunction: !isDefaultProjectListed,
    matchedFiles,
    walkedFiles: [...configFiles.map((file) => posixRelative(root, file)), ...sourceFiles],
  }).filter((file) => !isTypeAwareIgnored(file))
  const defaultProjectFileCount = defaultProjectFiles.length
  // Your configs' global ignores apply in `warnOfProjectScan`, which sees the composer's too
  const filesOutsideTsconfigs = withoutDefaultProjectFiles(
    discovery?.filesOutsideTsconfigs ?? [],
    allowDefaultProject,
  ).filter((file) => !isTypeAwareIgnored(file))
  const warnOfProjectScan = (configs: ReadonlyArray<unknown>) => {
    if (!isTyped) {
      return
    }
    const isIgnored = createUserIgnoresCheck(
      root,
      configs.filter((config) => !isRecord(config) || !GITIGNORE_NAMES.has(config['name'])),
    )
    const keptDefaultProjectFiles = defaultProjectFiles.filter((file) => !isIgnored(file))
    warnOfUntypedFiles({
      root,
      defaultProjectFiles: keptDefaultProjectFiles,
      hasNoTsconfig: findsTsconfigFiles && tsconfigFiles.length === 0 && hasTypescriptFiles,
    })
    warnOfLargeDefaultProject(root, keptDefaultProjectFiles)
    warnOfFilesOutsideTsconfigs(
      root,
      filesOutsideTsconfigs.filter((file) => !isIgnored(file)),
      tsconfigFiles,
    )
  }
  if (isTyped) {
    warnOfMissingAstroTypes(root, isOn)
  }
  const manifests = readProjectManifests(root)
  warnOfOptionHints(options, root, isOn, manifests, codeExtensions)
  warnOfPlaywrightTestDir(root, playwrightFiles)
  // Globs that can match a JavaScript file, such as `*.config.*` but not `vitest.config.ts`
  const typedConfigGlobs =
    isJavascriptTyped || allowDefaultProject === undefined
      ? []
      : allowDefaultProject.filter((glob) =>
          canMatchFile(['`typeAware.allowDefaultProject`'], glob, JAVASCRIPT_EXTNS),
        )
  const typedAstroFiles = isTyped && isOn.astro ? getTypedAstroFiles(root, astroProjectFolders) : []
  const isAstroTyped = typedAstroFiles.length > 0
  const untypedFiles = getUntypedFiles({
    isTyped,
    isJavascriptTyped,
    isAstro: isOn.astro,
    isAstroTyped,
  })
  const codeFiles = [...CODE_FILES, ...(isOn.astro ? ASTRO_FILES : [])]
  const { untyped, typeAwareIgnores } = withTypeAwareIgnores(
    getUntypedScopes(
      untypedFiles,
      typedConfigGlobs,
      isSameFiles(typedAstroFiles, ASTRO_FILES) ? [] : typedAstroFiles,
    ),
    typeAwareIgnoreGlobs,
    codeFiles,
  )
  const nextjsFiles = getNextjsFiles(root, resolveSubOptions(options.nextjs))
  const reactScope = resolveSubOptions(options.react)?.scope
  // With both scopes, React also covers the app, since the Next.js rules assume React's
  const reactFiles =
    nextjsFiles !== undefined && reactScope === undefined
      ? nextjsFiles
      : [
          ...getPresetFiles(root, 'react.scope', reactScope, CODE_FILES),
          ...(reactScope === undefined ? [] : (nextjsFiles ?? [])),
        ]
  return {
    options,
    root,
    isOn,
    isInEditor: options.isInEditor ?? isInEditorEnv(),
    codeFiles,
    typedCodeFiles: [...TYPED_CODE_FILES, ...(isOn.astro ? ASTRO_FILES : [])],
    testFiles: uniqueBy(
      [
        ...codeFilesOf('testFiles', testFiles),
        ...(isOn.vitest ? codeFilesOf('vitest.files', vitestFiles) : []),
        ...codeFilesOf('playwright.files', playwrightFiles),
      ],
      (file) => JSON.stringify(file),
    ),
    testGlobs,
    nonTestFiles: getNonTestFiles(testGlobs),
    vitestFiles: vitestFileSpecs,
    playwrightFiles: codeFilesOf('playwright.files', playwrightFiles),
    storybookFiles: codeFilesOf('storybook.files', storybookFiles),
    untyped,
    untypedKinds: getUntypedKinds({
      root,
      isTypeAware,
      isJavascriptTyped,
      typedConfigGlobs,
      isOn,
      isAstroTyped,
      typeAwareIgnoreGlobs,
    }),
    allowDefaultProject,
    defaultProjectFileCount,
    defaultProjectFiles,
    filesOutsideTsconfigs,
    warnOfProjectScan,
    commonjs,
    browserFiles: globsAsFiles(browserFiles),
    serverFiles: globsAsFiles(serverFiles),
    serverIgnores: globsAsIgnores(serverFiles),
    typeAware: isTyped ? { files: codeFiles, ignores: typeAwareIgnores } : undefined,
    javascriptOnly,
    isAstroTyped,
    typedAstroFiles,
    gitignores,
    ignores,
    tsconfigFiles,
    packageSourceGlobs:
      isOn.imports || isOn.node ? getPackageSourceGlobs(root, packageFolders) : [],
    nextjsRootDirs: toArray(resolveSubOptions(options.nextjs)?.rootDir ?? '.').map((rootDir) =>
      path.resolve(root, rootDir),
    ),
    reactCompiler: resolveSubOptions(options.react)?.compiler ?? usesReactCompiler(manifests),
    presetFiles: {
      react: reactFiles,
      nextjs: nextjsFiles ?? reactFiles,
      node: getPresetFiles(root, 'node.scope', resolveSubOptions(options.node)?.scope, CODE_FILES),
      tailwindcss: getPresetFiles(
        root,
        'tailwindcss.scope',
        resolveSubOptions(options.tailwindcss)?.scope,
        [...codeFiles, ...(isOn.html ? HTML_FILES : [])],
        getTailwindcssTarget(isOn),
      ),
    },
  }
}
