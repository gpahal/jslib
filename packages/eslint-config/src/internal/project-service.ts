import fs from 'node:fs'
import path from 'node:path'

import { meta, parseForESLint, type ParserOptions } from '@typescript-eslint/parser'
import type TypeScriptModule from 'typescript'
import { parser as tsEslintParser } from 'typescript-eslint'

import { formatNames } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import { DEFAULT_PROJECT_FILE_MATCH_COUNT } from '@/internal/configs/javascript'
import { isFoundDefaultProjectFile, loadTypeScript } from '@/internal/default-project'
import { createGlobMatcher, escapeGlob, isInside, posixRelative } from '@/internal/globs'
import { checkRootSpelling } from '@/internal/root-spelling'
import type { TypedConfig } from '@/internal/types'
import { fail, formatErrorMessage } from '@/internal/utils'

/**
 * `shared` apply to every file, the others to `allowDefaultProject`'s files, which typescript-eslint
 * matches against paths relative to each file's own `tsconfigRootDir`
 */
type ServiceOptions = {
  root: string
  shared: string
  allowDefaultProject: Array<string>
  isDefaultProjectFile: (relativePath: string) => boolean
  maximumDefaultProjectFileMatchCount: unknown
  defaultProject: string
}

/**
 * typescript-eslint creates one project service per process, from the first file's options, and
 * applies it to every later config
 */
const state: { reservation?: ServiceOptions } = {}

/**
 * Since each file's parse checks the service options
 */
const services = new Map<string, ServiceOptions>()

const compilerOptions = new Map<string, string>()

const typePackages = new Map<string, string>()

function parseTsconfig(file: string): TypeScriptModule.ParsedCommandLine | undefined {
  if (!fs.existsSync(file)) return undefined
  const ts = loadTypeScript()
  const parsed = ts.getParsedCommandLineOfConfigFile(file, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  })
  return parsed === undefined || parsed.errors.length > 0 ? undefined : parsed
}

/**
 * Or of its nearest existing folder, for text linted under a path that isn't on disk
 */
function realPath(file: string): string {
  const missing: Array<string> = []
  let current = file
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...missing.toReversed())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return file
      missing.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * `root` as a prefix of `file` when `file` reaches it through another path, such as a symbolic
 * link. typescript-eslint matches `allowDefaultProject` against the path relative to
 * `tsconfigRootDir`, so the two need the same prefix
 *
 * @throws TypeError when no prefix of `file` maps to root, as through a link below root.
 */
function rootFor(root: string, file: string): string {
  if (isInside(file, root)) {
    // The parser runs before the root-spelling rule, and the project service fails on a file that a
    // link inside root moves out of its project
    checkRootSpelling(root, file)
    return root
  }
  const realRoot = realPath(root)
  const realFile = realPath(file)
  if (!isInside(realFile, realRoot)) return root
  const relative = path.relative(realRoot, realFile)
  const prefix = file.slice(0, -relative.length - 1)
  const isMapped =
    relative !== '' && file.endsWith(`${path.sep}${relative}`) && realPath(prefix) === realRoot
  if (!isMapped) {
    fail(
      ['project service', formatNames([file])],
      `reaches ${formatNames([root])} through a symbolic link below it, which typescript-eslint's project service can't match to \`allowDefaultProject\`. Run ESLint from ${formatNames([realRoot])}`,
    )
  }
  return prefix
}

/**
 * Recursively
 */
function canonicalPaths(value: unknown): unknown {
  if (typeof value === 'string') {
    return path.isAbsolute(value) ? realPath(value) : value
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalPaths(entry))
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value)
          .toSorted(([a], [b]) => (a < b ? -1 : Number(a > b)))
          .map(([key, entry]) => [key, canonicalPaths(entry)]),
      )
    : value
}

/**
 * `null` without the file. A tsconfig that doesn't parse is its own real path
 */
function compilerOptionsOf(file: string): string {
  const cached = compilerOptions.get(file)
  if (cached !== undefined) return cached
  let result: unknown = null
  if (fs.existsSync(file)) {
    const parsed = parseTsconfig(file)
    if (parsed === undefined) {
      result = realPath(file)
    } else {
      const { configFilePath: _configFilePath, ...options } = parsed.options
      result = canonicalPaths(options)
    }
  }
  const json = JSON.stringify(result)
  compilerOptions.set(file, json)
  return json
}

/**
 * TypeScript resolves them from the tsconfig's folder, so equal compiler options in two folders can
 * load different ones, and the shared service would load the first config's for both
 */
function typePackagesOf(file: string): string {
  const cached = typePackages.get(file)
  if (cached !== undefined) return cached
  const ts = loadTypeScript()
  const options = parseTsconfig(file)?.options ?? { configFilePath: file }
  const names = ts.getAutomaticTypeDirectiveNames(options, ts.sys)
  const containingFile = path.join(path.dirname(file), '__inferred type names__.ts')
  const resolved = names
    .toSorted((a, b) => (a < b ? -1 : Number(a > b)))
    .map((name) => {
      const declarationFile = ts.resolveTypeReferenceDirective(
        name,
        containingFile,
        options,
        ts.sys,
      ).resolvedTypeReferenceDirective?.resolvedFileName
      return [name, declarationFile === undefined ? null : realPath(declarationFile)]
    })
  const json = JSON.stringify(resolved)
  typePackages.set(file, json)
  return json
}

function serviceOptions(
  projectService: unknown,
  root: string,
  jsDocParsingMode: unknown,
): ServiceOptions {
  const {
    allowDefaultProject,
    defaultProject,
    maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: maximumCount,
    ...rest
  } = isRecord(projectService) ? projectService : {}
  const globs = Array.isArray(allowDefaultProject)
    ? [...new Set(allowDefaultProject.map(String))].toSorted((a, b) => (a < b ? -1 : Number(a > b)))
    : []
  const isMatch = createGlobMatcher(globs)
  return {
    root,
    shared: JSON.stringify([canonicalPaths(rest), jsDocParsingMode]),
    allowDefaultProject: globs,
    isDefaultProjectFile: (relativePath) => globs.length > 0 && isMatch(relativePath),
    maximumDefaultProjectFileMatchCount: maximumCount,
    defaultProject: path.resolve(
      root,
      typeof defaultProject === 'string' ? defaultProject : 'tsconfig.json',
    ),
  }
}

function fileLimitOf(service: ServiceOptions): number {
  const count = service.maximumDefaultProjectFileMatchCount
  return typeof count === 'number' ? count : DEFAULT_PROJECT_FILE_MATCH_COUNT
}

/**
 * `undefined` when the reserved service treats `file` as the config of `service` would
 */
function conflictOf(
  service: ServiceOptions,
  reserved: ServiceOptions,
  file: string | undefined,
): string | undefined {
  if (service.shared !== reserved.shared) {
    return `options other than \`allowDefaultProject\` that differ, ${service.shared} against ${reserved.shared}`
  }
  if (file === undefined) return undefined
  // typescript-eslint matches the reserved globs against the path relative to the file's own root
  const relativePath = posixRelative(service.root, file)
  const isOwn = service.isDefaultProjectFile(relativePath)
  if (isOwn !== reserved.isDefaultProjectFile(relativePath)) {
    const globs = (options: ServiceOptions) => JSON.stringify(options.allowDefaultProject)
    return `\`allowDefaultProject\` ${globs(service)}, which ${isOwn ? 'matches' : "doesn't match"} the file, against ${globs(reserved)}`
  }
  if (!isOwn) return undefined
  const requested = fileLimitOf(service)
  const reservedLimit = fileLimitOf(reserved)
  if (requested > reservedLimit) {
    return `a default project file limit of ${String(requested)}, above ${String(reservedLimit)}`
  }
  const project = formatNames([realPath(service.defaultProject)])
  const reservedProject = formatNames([realPath(reserved.defaultProject)])
  if (compilerOptionsOf(service.defaultProject) !== compilerOptionsOf(reserved.defaultProject)) {
    return `the compiler options of ${project} for the default project, against those of ${reservedProject}`
  }
  return typePackagesOf(service.defaultProject) === typePackagesOf(reserved.defaultProject)
    ? undefined
    : `the type packages that ${project} loads for the default project, against those of ${reservedProject}`
}

/**
 * One root on both sides means the config changed in this process, as on an editor reload
 */
function describeServiceConflict(root: string, reservedRoot: string, conflict: string): string {
  const isReload = root === reservedRoot
  const what = isReload
    ? `changed in this process, and now sets ${conflict} in the project service it set up first`
    : `sets ${conflict} in the config of ${formatNames([reservedRoot])}, whose project service this process already uses`
  const fix = isReload
    ? "Restart the ESLint server, as with VS Code's `ESLint: Restart ESLint Server` command, or run ESLint again"
    : 'Lint the packages with one config at their common root, limiting presets with `scope` and settings with `files`, or run ESLint once per package'
  return `the config of ${formatNames([root])} ${what}. typescript-eslint keeps one project service per process, with the options of the first config that uses it. ${fix}`
}

/**
 * Reserves the service for the first parse's options and checks later files against them. Returns
 * the options with `tsconfigRootDir` given the file's path prefix
 *
 * @throws TypeError when the service would treat the file otherwise, or can't match it to its root.
 */
function checkProjectService(options: ParserOptions): ParserOptions {
  const { projectService, tsconfigRootDir, filePath, jsDocParsingMode } = options
  if (projectService == null || projectService === false || typeof tsconfigRootDir !== 'string') {
    return options
  }
  const file = typeof filePath === 'string' && path.isAbsolute(filePath) ? filePath : undefined
  const root = file === undefined ? tsconfigRootDir : rootFor(tsconfigRootDir, file)
  const cacheKey = JSON.stringify([root, projectService, jsDocParsingMode])
  let service = services.get(cacheKey)
  if (service === undefined) {
    service = serviceOptions(projectService, root, jsDocParsingMode)
    services.set(cacheKey, service)
  }
  state.reservation ??= service
  const reservation = state.reservation
  const conflict = conflictOf(service, reservation, file)
  if (conflict !== undefined) {
    fail(
      ['project service', ...(file === undefined ? [] : [formatNames([file])])],
      describeServiceConflict(realPath(root), realPath(reservation.root), conflict),
    )
  }
  return root === tsconfigRootDir ? options : { ...options, tsconfigRootDir: root }
}

export const DEFAULT_PROJECT_CONFLICT = 'was included by allowDefaultProject but also was found'

/**
 * For a file that `discoverProjects`, which doesn't read imports, missed in a project
 */
function withDefaultProjectFix(
  error: unknown,
  options: ParserOptions | null | undefined,
  checked: ParserOptions | null | undefined,
): unknown {
  const { filePath, tsconfigRootDir } = checked ?? {}
  const root = options?.tsconfigRootDir
  if (
    typeof filePath !== 'string' ||
    typeof tsconfigRootDir !== 'string' ||
    typeof root !== 'string' ||
    !(error instanceof Error) ||
    !error.message.includes(DEFAULT_PROJECT_CONFLICT)
  ) {
    return error
  }
  const file = posixRelative(tsconfigRootDir, filePath)
  if (!isFoundDefaultProjectFile(root, file)) {
    return error
  }
  const literal = `'${escapeGlob(file)
    .replaceAll('\\', '\\\\')
    .replaceAll("'", String.raw`\'`)}'`
  return new TypeError(
    formatErrorMessage(
      ['project service', formatNames([filePath])],
      `\`${file}\` is in the default project, and a tsconfig project also includes it through an import. Add it to that tsconfig's \`include\`, or leave it out of the default project with \`typeAware: { allowDefaultProject: (files) => files.filter((file) => file !== ${literal}) }\``,
    ),
    { cause: error },
  )
}

/**
 * Checks the service options first and names the fix for a file in both kinds of project
 */
const PROJECT_SERVICE_PARSER = {
  meta,
  parseForESLint: (code: string, options?: ParserOptions | null) => {
    const checked = options && checkProjectService(options)
    try {
      return parseForESLint(code, checked)
    } catch (error) {
      throw withDefaultProjectFix(error, options, checked)
    }
  },
}

/**
 * As the parser and as the `parserOptions.parser` of a parser that takes one
 */
export function withProjectServiceParser(configs: Array<TypedConfig>): Array<TypedConfig> {
  return configs.map((config) => {
    const languageOptions = config.languageOptions
    if (languageOptions === undefined) return config
    const parserOptions: unknown = languageOptions['parserOptions']
    const isParser = languageOptions['parser'] === tsEslintParser
    const isNestedParser = isRecord(parserOptions) && parserOptions['parser'] === tsEslintParser
    if (!isParser && !isNestedParser) return config
    return {
      ...config,
      languageOptions: {
        ...languageOptions,
        ...(isParser && { parser: PROJECT_SERVICE_PARSER }),
        ...(isNestedParser && {
          parserOptions: { ...parserOptions, parser: PROJECT_SERVICE_PARSER },
        }),
      },
    }
  })
}
