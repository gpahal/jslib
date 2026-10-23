/**
 * The languages that the presets give the JSON, YAML, TOML, Markdown and HTML files, and your
 * configs other files, and which a config's `files` can reach. Globs are compared by file name,
 * since ESLint takes a file's language from the last matching config with `language`, and the
 * presets pick these files mostly by name
 */

import type { ESLint, Linter } from 'eslint'

import { expandBraces, MAX_EXPANSIONS } from '@gpahal/internal/globs'
import { toArray } from '@gpahal/std/arrays'
import { formatMessage, formatNames } from '@gpahal/std/errors'

import { NON_CODE_EXTNS, NON_CODE_KIND_EXTNS } from '@/internal/files'
import { canMatchFile } from '@/internal/glob-match'
import { createSegmentMatcher, hasSegmentMagic } from '@/internal/globs'
import type { TypedConfig } from '@/internal/types'
import { PREFIX } from '@/internal/utils'

export type LanguageSource = {
  /**
   * For errors, as `JSON`, or the language in backticks, as `` `css/css` ``
   */
  kind: string
  /**
   * `js/js` for a config that sets only a parser, as the `html` preset does
   */
  language: string
  /**
   * Per `files` entry, the patterns a file's name must all match. A glob of yours that names folders
   * counts by its last segment, as `src/**\/*.css` does as `*.css`, so the patterns can match files
   * the entry doesn't, and JavaScript rules skip them all. A preset's entry with such a glob is left
   * out, since `**\/.vscode/*.json` would give every `.json` file its language. A leading `!`
   * negates a pattern, unless it starts an extglob, as in `!(a).css`
   */
  names: ReadonlyArray<ReadonlyArray<string>>
  ignoredNames: ReadonlyArray<string>
  /**
   * A folder-only ignore, such as `**\/fixtures/**`, lets an earlier config give the language there
   */
  hasFolderIgnores: boolean
}

export type KindLanguage = Pick<LanguageSource, 'kind' | 'language'>

/**
 * Names of every kind, which a segment that matches them all, such as `**` or `*`, matches. A
 * segment that matches every one but not every name, such as `!(zzz)`, counts too, which keeps the
 * entry out of scoping, as before the last-segment rule
 */
const ANY_NAME_PROBES: ReadonlyArray<string> = ['a', '.a', 'a.ts', 'A-b_1.d.ts', 'a b(1).json']

function matchesAnyName(segment: string): boolean {
  const matches = createSegmentMatcher(segment)
  return ANY_NAME_PROBES.every((name) => matches(name))
}

/**
 * As `*.json` for `**\/*.json`. No match when the glob names folders
 */
const ANY_FOLDER_NAME_REGEX = /^(?:\*\*\/)?([^/]+)$/

const LITERAL_EXTENSION_REGEX = /\.([^.*?[\]{}()!+@|\\]+)$/

function expand(glob: string, subjects: ReadonlyArray<string>): Array<string> {
  return expandBraces(glob, { prefix: PREFIX, subjects })
}

/**
 * A leading `!` negates the rest of `pattern`, as a `!` glob's does, unless it starts an extglob
 */
function matchesName(pattern: string, name: string): boolean {
  return pattern.startsWith('!') && !pattern.startsWith('!(')
    ? !createSegmentMatcher(pattern.slice(1))(name)
    : createSegmentMatcher(pattern)(name)
}

/**
 * As `*.json` for `**\/*.json`, and `*.css` for `src/**\/*.css` by its last segment. Escaped so
 * that a leading `!` negates only for a `!` glob, as `!*.css` for `!**\/*.css`. `null` for a `!`
 * glob that names folders, which is left out, since its last segment could leave out files the entry
 * matches, and `undefined` for a glob that leaves the entry out, as one whose last segment matches
 * every name, such as `cfg/**`, does
 */
function getEntryName(glob: string, byLastSegment: boolean): string | null | undefined {
  if (glob.startsWith('!')) {
    const name = ANY_FOLDER_NAME_REGEX.exec(glob.slice(1))?.[1]
    if (name === undefined) {
      return byLastSegment ? null : undefined
    }
    return `!${name.startsWith('(') ? '\\' : ''}${name}`
  }
  let name = ANY_FOLDER_NAME_REGEX.exec(glob)?.[1]
  if (name === undefined && byLastSegment) {
    name = glob.slice(glob.lastIndexOf('/') + 1)
    if (matchesAnyName(name)) {
      return undefined
    }
  }
  if (name === undefined || name === '') {
    return undefined
  }
  return name.startsWith('!') && !name.startsWith('!(') ? `\\${name}` : name
}

/**
 * `undefined` for code and other files
 */
function getKind(name: string): string | undefined {
  const extension = LITERAL_EXTENSION_REGEX.exec(name)?.[1]
  return NON_CODE_KIND_EXTNS.find(([, extensions]) => extensions.includes(extension ?? ''))?.[0]
}

/**
 * By the start of the language's name
 */
const LANGUAGE_KINDS: ReadonlyArray<[prefix: string, kind: string]> = [
  ['json/', 'JSON'],
  ['yml/', 'YAML'],
  ['yaml/', 'YAML'],
  ['toml/', 'TOML'],
  ['markdown/', 'Markdown'],
  ['@gpahal/markdown/', 'Markdown'],
  ['html/', 'HTML'],
  ['@html-eslint/', 'HTML'],
]

export function getLanguageKind(language: string): string {
  return LANGUAGE_KINDS.find(([prefix]) => language.startsWith(prefix))?.[1] ?? `\`${language}\``
}

/**
 * Each brace combination as file name patterns, or none for an entry left out
 *
 * @throws TypeError, before making them, when the combinations would be more than
 *   {@link MAX_EXPANSIONS}, as five globs of 10 alternatives each make 100,000
 */
function getEntryNames(
  subjects: ReadonlyArray<string>,
  entry: NonNullable<Linter.Config['files']>[number],
  byLastSegment: boolean,
): Array<Array<string>> {
  const globNames: Array<Array<string>> = []
  for (const glob of toArray(entry)) {
    if (typeof glob !== 'string') {
      return []
    }
    const names = expand(glob, subjects).map((expanded) => getEntryName(expanded, byLastSegment))
    if (names.includes(undefined)) {
      return []
    }
    if (!names.includes(null)) {
      globNames.push(names.map((name) => name ?? ''))
    }
  }
  // Counted once every glob is known to name files
  const count = globNames.reduce((product, names) => product * names.length, 1)
  if (count > MAX_EXPANSIONS) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        subjects,
        `the brace alternatives of the globs that a file must all match make more than ${String(MAX_EXPANSIONS)} combinations. Split the entry into entries with fewer alternatives each`,
      ),
    )
  }
  return globNames.reduce<Array<Array<string>>>(
    (combinations, names) =>
      combinations.flatMap((combination) => names.map((name) => [...combination, name])),
    [[]],
  )
}

/**
 * Each config that sets `language` or a parser for non-code files, and each that sets a `language`
 * other than `js/js` for other files, such as `json/jsonc` for `**\/*.code-workspace`
 */
export function getLanguageSources(configs: ReadonlyArray<TypedConfig>): Array<LanguageSource> {
  return configs.flatMap((config): Array<LanguageSource> => {
    const parser: unknown = config.languageOptions?.['parser']
    if (config.files === undefined || (parser === undefined && config.language === undefined)) {
      return []
    }
    const configSubject =
      config.name === undefined ? 'config' : `config ${formatNames([config.name])}`
    const isPreset = config.name?.startsWith('gpahal/') === true
    const names = config.files.flatMap((entry, index) =>
      getEntryNames([configSubject, `\`files[${String(index)}]\``], entry, !isPreset),
    )
    const kind =
      names
        .flat()
        .map((name) => getKind(name))
        .find((found) => found !== undefined) ??
      (config.language === undefined || config.language === 'js/js' || names.length === 0
        ? undefined
        : getLanguageKind(config.language))
    if (kind === undefined) {
      return []
    }
    const ignores = (config.ignores ?? []).flatMap((glob, index) =>
      expand(glob, [configSubject, `\`ignores[${String(index)}]\``]),
    )
    const ignoredNames = ignores.flatMap((glob) => {
      return ANY_FOLDER_NAME_REGEX.exec(glob)?.[1] ?? []
    })
    return [
      {
        kind,
        language: config.language ?? 'js/js',
        names,
        ignoredNames,
        hasFolderIgnores: ignoredNames.length < ignores.length,
      },
    ]
  })
}

/**
 * One glob per `files` entry: its pattern with a literal extension, or its first. That may skip
 * more files than the entry matches, which the entry's language would mostly get
 */
export function getLanguageIgnores(sources: ReadonlyArray<LanguageSource>): Array<string> {
  const ignores = new Set<string>()
  for (const { names } of sources) {
    for (const entry of names) {
      const pattern = entry.find((name) => LITERAL_EXTENSION_REGEX.test(name)) ?? entry[0]
      const extension = LITERAL_EXTENSION_REGEX.exec(pattern ?? '')?.[1]
      if (pattern !== undefined && !NON_CODE_EXTNS.includes(extension ?? '')) {
        ignores.add(`**/${pattern}`)
      }
    }
  }
  return [...ignores]
}

/**
 * Those for every folder, and those under the folder `glob` starts with
 */
function getExcludedNames(
  subjects: ReadonlyArray<string>,
  glob: string,
  exclusions: ReadonlyArray<string>,
): Array<string> {
  return exclusions.flatMap((exclusion) =>
    expand(exclusion, subjects).flatMap((expanded) => {
      const slash = expanded.lastIndexOf('/')
      const folder = expanded.slice(0, slash + 1)
      const name = expanded.slice(slash + 1)
      const isCovering =
        folder === '**/' ||
        (folder.endsWith('/**/') && glob.startsWith(folder.slice(0, -'**/'.length)))
      return isCovering ? name : []
    }),
  )
}

function getGlobLanguages(
  subjects: ReadonlyArray<string>,
  glob: string,
  sources: ReadonlyArray<LanguageSource>,
  excludedNames: ReadonlyArray<string>,
): Array<KindLanguage> {
  const name = glob.slice(glob.lastIndexOf('/') + 1)
  if (!hasSegmentMagic(name)) {
    if (excludedNames.some((excluded) => matchesName(excluded, name))) {
      return []
    }
    // The last matching config gives the language, or an earlier one where its `ignores` skip
    const matched: Array<KindLanguage> = []
    for (const source of sources.toReversed()) {
      if (
        source.ignoredNames.some((ignored) => matchesName(ignored, name)) ||
        source.names.every((names) => names.some((pattern) => !matchesName(pattern, name)))
      ) {
        continue
      }
      matched.push(source)
      if (!source.hasFolderIgnores) {
        break
      }
    }
    return matched
  }
  return sources.filter((source) =>
    source.names.some(
      (names) =>
        names.every((pattern) =>
          excludedNames.every((excluded) => !matchesName(excluded, pattern)),
        ) &&
        names.every((pattern) => {
          const extension = LITERAL_EXTENSION_REGEX.exec(pattern)?.[1]
          return extension === undefined || canMatchFile(subjects, glob, [extension])
        }),
    ),
  )
}

/**
 * No `files` matches every file. A negated glob skips what it matches. An exclusion naming other
 * folders than its glob's is taken to skip nothing, and so is each `ignores` glob before the last
 * negated one, which may un-ignore what they match
 */
export function getMatchedLanguages(
  subjects: ReadonlyArray<string>,
  files: Linter.Config['files'],
  ignores: Linter.Config['ignores'],
  sources: ReadonlyArray<LanguageSource>,
): Array<KindLanguage> {
  const allIgnores = ignores ?? []
  const configIgnores = allIgnores.slice(
    allIgnores.findLastIndex((glob) => glob.startsWith('!')) + 1,
  )
  const matched = new Map<string, KindLanguage>()
  const entries = files ?? ['**']
  for (const entry of entries) {
    const globs = toArray(entry).filter((glob) => typeof glob === 'string')
    const positives = globs.filter((glob) => !glob.startsWith('!'))
    const exclusions = [
      ...globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1)),
      ...configIgnores,
    ]
    let languages: Array<KindLanguage> | undefined
    const globsToMatch = positives.length === 0 ? ['**'] : positives
    for (const glob of globsToMatch) {
      const globLanguages = expand(glob, subjects).flatMap((expanded) =>
        getGlobLanguages(
          subjects,
          expanded,
          sources,
          getExcludedNames(subjects, expanded, exclusions),
        ),
      )
      languages = (languages ?? globLanguages).filter((found) =>
        globLanguages.some(
          ({ kind, language }) => kind === found.kind && language === found.language,
        ),
      )
    }
    const entryLanguages = languages ?? []
    for (const found of entryLanguages) {
      matched.set(`${found.kind} ${found.language}`, { kind: found.kind, language: found.language })
    }
  }
  return matched.values().toArray()
}

/**
 * As ESLint checks it: no list, `*`, the language, or `<plugin>/*` or `<plugin>/<name>` by the
 * language's plugin name or `meta.namespace`
 */
export function canRunIn(
  languages: unknown,
  language: string,
  plugins: ReadonlyMap<string, ESLint.Plugin>,
): boolean {
  if (!Array.isArray(languages)) {
    return true
  }
  const slash = language.lastIndexOf('/')
  const pluginName = language.slice(0, slash)
  const name = language.slice(slash + 1)
  const namespace = plugins.get(pluginName)?.meta?.namespace
  const pluginNames = new Set([pluginName, ...(namespace === undefined ? [] : [namespace])])
  return languages.some((entry: unknown) => {
    if (typeof entry !== 'string') {
      return false
    }
    if (entry === '*' || entry === language) {
      return true
    }
    const entrySlash = entry.lastIndexOf('/')
    const entryName = entry.slice(entrySlash + 1)
    return pluginNames.has(entry.slice(0, entrySlash)) && (entryName === '*' || entryName === name)
  })
}
