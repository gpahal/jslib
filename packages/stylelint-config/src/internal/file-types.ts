import { isDeepStrictEqual } from 'node:util'

import { Document, Input, Root, stringify, type Syntax } from 'postcss'
import postcssHtml from 'postcss-html'
import postcssMarkdown from 'postcss-markdown'
import type { Config } from 'stylelint'

import { toArray } from '@gpahal/std/arrays'
import { formatMessage, formatNames } from '@gpahal/std/errors'

import { CUSTOM_PROPERTY_EMPTY_LINE_BEFORE } from '@/internal/custom-property-empty-line-before'
import { expandGlobBraces, PREFIX } from '@/internal/options'
import { FONT_FAMILY_VARIABLE_REGEX } from '@/internal/preset-rules'
import type { StylelintOverride } from '@/internal/rules'
import { TAILWIND_APPLY } from '@/internal/tailwind-apply'
import { TAILWIND_THEME_FUNCTION } from '@/internal/tailwind-theme-function'

/**
 * The kinds of file that get different settings: one per preset override, and CSS for the
 * top-level ones
 */
export type FileType = 'astro' | 'html' | 'markdown' | 'cssModules' | 'css'

type Override = NonNullable<Config['overrides']>[number]

export type FileTypeOverride = {
  type: FileType
  isOn: boolean
  override: Override & { files: string }
}

/**
 * A syntax that finds no styles. Its document has no roots, so postcss-markdown keeps the block's
 * text
 */
const NO_STYLES_SYNTAX: Syntax = {
  parse: () => new Document(),
  stringify,
}

/**
 * A syntax that finds no styles for postcss-html, which needs a root: an empty one that keeps the
 * block's text for fixes. postcss-markdown passes it on to postcss-html too
 */
const NO_STYLES_ROOT_SYNTAX: Syntax = {
  parse: (css, options) => {
    const text = String(css)
    const lines = text.split('\n')
    const root = new Root({ raws: { after: text } })
    root.source = {
      input: new Input(text, options),
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: text.length, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 },
    }
    return root
  },
  stringify,
}

/**
 * Syntaxes that find no styles for the style languages the preset doesn't lint, such as
 * ` ```scss `. Otherwise postcss-html and postcss-markdown load `postcss-scss` and the like by name
 * from the working directory, so the result would depend on what's installed there
 */
function otherStyleSyntaxes(syntax: Syntax) {
  return {
    sass: syntax,
    scss: syntax,
    less: syntax,
    stylus: syntax,
    styl: syntax,
    sugarss: syntax,
  }
}

const htmlSyntax = postcssHtml(otherStyleSyntaxes(NO_STYLES_ROOT_SYNTAX))

/**
 * The syntaxes of the HTML in Markdown. Without them postcss-markdown loads `postcss-html` by name
 * and silently skips the HTML when it can't, as under pnpm without hoisting. ` ```vue ` and
 * ` ```svelte ` blocks, which the package doesn't support, find no styles
 */
const MARKDOWN_SYNTAXES = {
  ...otherStyleSyntaxes(NO_STYLES_ROOT_SYNTAX),
  html: htmlSyntax,
  vue: NO_STYLES_SYNTAX,
  svelte: NO_STYLES_SYNTAX,
  xml: htmlSyntax,
}

/**
 * The syntax of Markdown files, built once and copied per config
 */
const markdownSyntax = postcssMarkdown(MARKDOWN_SYNTAXES)

/**
 * One function for every config, so configs built with the same options are equal
 */
function moduleClassMessage(selector: string): string {
  return `Expected class selector "${selector}" to be kebab-case or camelCase`
}

/**
 * A camelCase name that isn't a camelCase CSS keyword such as `currentColor`, as Stylelint lists
 * them for `value-keyword-case`'s `camelCaseSvgKeywords`
 */
const CSS_MODULES_NAME_REGEX =
  /^(?!(?:currentColor|optimizeSpeed|optimizeQuality|optimizeLegibility|geometricPrecision|crispEdges|visiblePainted|visibleFill|visibleStroke|sRGB|linearRGB)$)[a-z][a-z0-9]*[A-Z]/

/**
 * The preset's file type overrides. A glob without a `/` matches at any depth. The syntaxes are
 * objects, since Stylelint would import a name such as `postcss-html` from the project, which pnpm
 * doesn't let it see
 */
export function fileTypeOverrides({
  astro,
  html,
  markdown,
}: {
  astro: boolean
  html: boolean
  markdown: boolean
}): Array<FileTypeOverride> {
  return [
    {
      type: 'astro',
      isOn: astro,
      override: {
        files: '*.astro',
        customSyntax: htmlSyntax,
        rules: {
          // Astro scopes a `<style>` block's selectors, and `:global()` opts one out
          'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global'] }],
        },
      },
    },
    // Unlike in `.astro` files, `:global()` is unknown here
    {
      type: 'html',
      isOn: html,
      override: { files: '*.html', customSyntax: htmlSyntax },
    },
    {
      type: 'markdown',
      isOn: markdown,
      override: {
        files: '*.{md,markdown}',
        customSyntax: markdownSyntax,
        rules: {
          // Prettier doesn't format the HTML in `.md` files, so nothing would fix a one-line block
          'declaration-block-single-line-max-declarations': null,
          // A code block can be a partial snippet using the project's definitions. The empty line
          // fix fights Prettier there
          'no-invalid-position-declaration': null,
          [CUSTOM_PROPERTY_EMPTY_LINE_BEFORE]: null,
          'no-unknown-custom-properties': null,
          'no-unknown-custom-media': null,
          'no-unknown-animations': null,
          [TAILWIND_THEME_FUNCTION]: null,
          // The project's classes and variants, which a snippet needn't use
          [TAILWIND_APPLY]: null,
        },
      },
    },
    // CSS Modules' syntax, as stylelint-config-css-modules allows it, and camelCase class names.
    // `value-keyword-case` would lowercase the camelCase names in `composes`, `:export`, `:import`
    // and `@value`, which then name nothing
    {
      type: 'cssModules',
      isOn: true,
      override: {
        files: '*.module.css',
        rules: {
          'selector-pseudo-class-no-unknown': [
            true,
            { ignorePseudoClasses: ['global', 'local', 'export', 'import'] },
          ],
          'property-no-unknown': [
            true,
            { ignoreProperties: ['composes'], ignoreSelectors: [':export', /^:import/] },
          ],
          'at-rule-no-unknown': [true, { ignoreAtRules: ['value'] }],
          'value-keyword-case': [
            'lower',
            {
              ignoreProperties: [FONT_FAMILY_VARIABLE_REGEX, 'composes'],
              ignoreKeywords: [CSS_MODULES_NAME_REGEX],
            },
          ],
          'selector-class-pattern': [
            '^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|[a-z][a-zA-Z0-9]*)$',
            { message: moduleClassMessage },
          ],
        },
      },
    },
  ]
}

const EXTENSIONS_OF_TYPE: ReadonlyArray<readonly [FileType, ReadonlyArray<string>]> = [
  ['astro', ['astro']],
  ['html', ['html']],
  ['markdown', ['md', 'markdown']],
  ['css', ['css', 'pcss', 'postcss']],
]

const FILE_TYPE_OF_EXTENSION: ReadonlyMap<string, FileType> = new Map(
  EXTENSIONS_OF_TYPE.flatMap(([type, extensions]) =>
    extensions.map((extension) => [extension, type] as const),
  ),
)

const ALL_FILE_TYPES: ReadonlyArray<FileType> = [
  ...EXTENSIONS_OF_TYPE.map(([type]) => type),
  'cssModules',
]

const GLOB_CHARACTERS = ['!', '(', ')', '*', '+', '?', '@', '[', ']'] as const

/**
 * Whether a glob's `base`, its text before a `.css` extension, names CSS Modules: `'always'` for
 * `.module`, `'maybe'` when its glob characters can end in `.module`, as `*` or `a*e`, else
 * `'never'`, as for `*-theme`
 */
function moduleBaseOf(base: string): 'always' | 'maybe' | 'never' {
  const segment = base.slice(Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\')) + 1)
  if (segment.endsWith('.module')) {
    return 'always'
  }
  const lastGlobCharacter = Math.max(...GLOB_CHARACTERS.map((char) => segment.lastIndexOf(char)))
  return lastGlobCharacter !== -1 && '.module'.endsWith(segment.slice(lastGlobCharacter + 1))
    ? 'maybe'
    : 'never'
}

/**
 * A glob extension that can't match a `.`: a word, or an `@(…)` extglob of words. A brace left after
 * expansion is part of the word, since micromatch, as bash, keeps `{astro}` literal
 */
const CLOSED_EXTENSION_REGEX = /^(?:[\w{}-]+|@\([\w{}|-]+\))$/

/**
 * A brace-free glob split into its base and its extension's words, such as `['astro', 'html']` for
 * `*.@(astro|html)`. `words` is `undefined` when the glob can match any type, as `**` and `*.*` do
 */
function splitExtension(glob: string): { base: string; words: Array<string> | undefined } {
  const name = glob.slice(glob.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? '' : name.slice(dot + 1)
  if (!CLOSED_EXTENSION_REGEX.test(extension)) {
    return {
      base: dot === -1 ? glob : glob.slice(0, glob.length - name.length + dot),
      words: undefined,
    }
  }
  const words = extension.replace(/^@\(/, '').replace(/\)$/, '').split('|')
  return { base: glob.slice(0, glob.length - name.length + dot), words }
}

/**
 * The file types of an extension's word. A word of no type counts as `css`, which covers CSS
 * Modules too when the base can name one
 */
function fileTypesOfWord(word: string, base: string): Array<FileType> {
  if (word !== 'css') {
    return [FILE_TYPE_OF_EXTENSION.get(word) ?? 'css']
  }
  const moduleBase = moduleBaseOf(base)
  return moduleBase === 'always'
    ? ['cssModules']
    : moduleBase === 'maybe'
      ? ['css', 'cssModules']
      : ['css']
}

/**
 * The file types a brace-free glob can match. An extension of no type, such as `*.scss`, counts as
 * `css`, whose files get the top-level settings
 */
function fileTypesOfGlob(glob: string): Array<FileType> {
  const { base, words } = splitExtension(glob)
  return words === undefined
    ? [...ALL_FILE_TYPES]
    : [...new Set(words.flatMap((word) => fileTypesOfWord(word, base)))]
}

/**
 * An override's `files` with their braces expanded
 *
 * @throws TypeError when a glob is out of `expandBraces`'s bounds.
 */
function expandedGlobsOf(files: string | ReadonlyArray<string>, name: string): Array<string> {
  return toArray(files).flatMap((glob) => expandGlobBraces(glob, formatNames([name])))
}

/**
 * The file types an override's `files` can match
 *
 * @throws TypeError when a glob is out of `expandBraces`'s bounds.
 */
function fileTypesOf(files: string | ReadonlyArray<string>, name: string): Set<FileType> {
  return new Set(expandedGlobsOf(files, name).flatMap((glob) => fileTypesOfGlob(glob)))
}

const TYPE_EXTENSIONS: Readonly<Record<FileType, string>> = {
  astro: 'astro',
  html: 'html',
  markdown: '{md,markdown}',
  cssModules: 'module.css',
  css: '@(css|pcss|postcss)',
}

/**
 * An override's globs split by file type, for the error that asks for one override per type
 */
function splitGlobsOf(files: string | ReadonlyArray<string>, name: string): Array<string> {
  const globs = expandedGlobsOf(files, name).flatMap((glob) => {
    const { base, words } = splitExtension(glob)
    if (words === undefined) {
      const stem = base.endsWith('**') ? `${base}/*` : base
      return ALL_FILE_TYPES.map((type) => `${stem}.${TYPE_EXTENSIONS[type]}`)
    }
    const types = fileTypesOfGlob(glob)
    if (types.length === 1) {
      return glob
    }
    return types.map((type) => {
      if (type === 'cssModules') {
        return `${moduleBaseOf(base) === 'always' ? base : `${base}.module`}.css`
      }
      const typeWords = words.filter((word) => fileTypesOfWord(word, base).includes(type))
      return `${base}.${typeWords.length === 1 ? typeWords.join('') : `@(${typeWords.join('|')})`}`
    })
  })
  return [...new Set(globs)]
}

/**
 * The suggested fix for an override of several file types: one override per type
 *
 * @throws TypeError when a glob is out of `expandBraces`'s bounds.
 */
function splitOverrideHint(files: string | ReadonlyArray<string>, name: string): string {
  return `Split this override into one per file type: ${formatNames(splitGlobsOf(files, name))}`
}

const TYPE_PATTERNS: ReadonlyArray<readonly [FileType, string]> = [
  ['astro', '*.astro'],
  ['html', '*.html'],
  ['markdown', '*.@(md|markdown)'],
  ['cssModules', '*.module.css'],
]

/**
 * The names of CSS files, those of no other type, as a negated extglob over a whole path segment
 */
const CSS_PATTERN = '!(*.@(astro|html|md|markdown)|*.module.css)'

/**
 * A pattern for the names `stem` matches less CSS Modules, only for `*` or a plain prefix before
 * `*`, such as `a*`. A `.` in the prefix could end a `.module` the negation misses, and micromatch
 * mishandles nested negations such as `!(!(a*e)|*.module)`
 */
function nonModulePattern(stem: string): string | undefined {
  const prefix = stem.slice(0, -1)
  return stem.endsWith('*') && !/[!().*+?@[\]]/.test(prefix) ? `${prefix}!(*.module)` : undefined
}

function extensionOf(words: ReadonlyArray<string>): string {
  return words.length === 1 ? words.join('') : `@(${words.join('|')})`
}

/**
 * The globs that match each type's files among `${prefixed}.<word>`, or `undefined` when no glob
 * matches just the `.css` files that aren't CSS Modules
 */
function typeGlobsOf(
  prefixed: string,
  stem: string,
  words: ReadonlyArray<string>,
): Array<readonly [FileType, string]> | undefined {
  const moduleBase = moduleBaseOf(stem)
  const types = new Set(words.flatMap((word) => fileTypesOfWord(word, stem)))
  const typeGlobs: Array<readonly [FileType, string]> = []
  for (const type of types) {
    if (type === 'cssModules') {
      typeGlobs.push([type, `${prefixed}${moduleBase === 'always' ? '' : '.module'}.css`])
      continue
    }
    const typeWords = words.filter((word) => fileTypesOfWord(word, stem).includes(type))
    if (type !== 'css' || moduleBase !== 'maybe' || !typeWords.includes('css')) {
      typeGlobs.push([type, `${prefixed}.${extensionOf(typeWords)}`])
      continue
    }
    const pattern = nonModulePattern(stem)
    if (pattern === undefined) {
      return undefined
    }
    const directory = prefixed.slice(0, prefixed.length - stem.length)
    typeGlobs.push([type, `${directory}${pattern}.css`])
    const otherWords = typeWords.filter((word) => word !== 'css')
    if (otherWords.length > 0) {
      typeGlobs.push([type, `${prefixed}.${extensionOf(otherWords)}`])
    }
  }
  return typeGlobs
}

/**
 * An override's globs grouped so each group matches exactly its files of one type, as
 * `src/**` gives `src/**\/*.astro`, `src/**\/*.module.css` and, for CSS,
 * `src/**\/!(*.@(astro|html|md|markdown)|*.module.css)`. A slash-less glob gets a `**\/` segment,
 * as Stylelint matches it at any depth. `undefined` when no glob can match just one type's files,
 * as with `src/a*`, `*.*` or `src/*e.css`
 *
 * @throws TypeError when a glob is out of `expandBraces`'s bounds.
 */
export function splitGlobsByType(
  files: string | ReadonlyArray<string>,
  name: string,
): Map<FileType, Array<string>> | undefined {
  const groups = new Map<FileType, Array<string>>()
  const add = (type: FileType, glob: string): void => {
    const group = groups.get(type) ?? []
    if (!group.includes(glob)) group.push(glob)
    groups.set(type, group)
  }
  for (const glob of expandedGlobsOf(files, name)) {
    const slash = Math.max(glob.lastIndexOf('/'), glob.lastIndexOf('\\'))
    const directory = slash === -1 ? '**/' : glob.slice(0, slash + 1)
    const segment = glob.slice(slash + 1)
    const { base, words } = splitExtension(glob)
    if (words !== undefined) {
      const prefixed = `${slash === -1 ? '**/' : ''}${base}`
      const typeGlobs = typeGlobsOf(prefixed, base.slice(slash + 1), words)
      if (typeGlobs === undefined) {
        return undefined
      }
      for (const [type, typeGlob] of typeGlobs) {
        add(type, typeGlob)
      }
      continue
    }
    if (segment !== '**' && segment !== '*') {
      return undefined
    }
    const stem = `${directory}${segment === '**' ? '**/' : ''}`
    for (const [type, pattern] of TYPE_PATTERNS) {
      add(type, `${stem}${pattern}`)
    }
    add('css', `${stem}${CSS_PATTERN}`)
  }
  return groups
}

/**
 * The file types of an override's files, and the rules whose merged settings differ across them,
 * as `:global()` in `.astro` files does. `mergedSettingsOf` gives the override's rules merged over
 * a type's settings. `null` and `replace()` settings don't merge, so they never differ
 *
 * @throws TypeError when a glob is out of `expandBraces`'s bounds.
 */
export function fileTypesOfOverride(
  { files, rules = {} }: StylelintOverride,
  index: number,
  mergedSettingsOf: (
    type: FileType | undefined,
    rules: NonNullable<StylelintOverride['rules']>,
  ) => (rule: string) => unknown,
): { types: ReadonlyArray<FileType>; differing: ReadonlyArray<string> } {
  const types = [...fileTypesOf(files, `overrides[${index}].files`)]
  if (types.length <= 1) {
    return { types, differing: [] }
  }
  const settingOf = mergedSettingsOf(undefined, rules)
  const typeSettingsOf = types.map((type) => mergedSettingsOf(type, rules))
  const differing = Object.keys(rules).filter((rule) =>
    typeSettingsOf.some(
      (typeSettingOf) => !isDeepStrictEqual(typeSettingOf(rule), settingOf(rule)),
    ),
  )
  return { types, differing }
}

/**
 * The error for an override that no glob can split by type and that sets rules whose settings
 * differ across its types
 *
 * @throws TypeError when a glob is out of `expandBraces`'s bounds.
 */
export function mixedTypesError(
  files: string | ReadonlyArray<string>,
  index: number,
  ruleNames: ReadonlyArray<string>,
): TypeError {
  const name = `overrides[${index}].files`
  return new TypeError(
    formatMessage(
      PREFIX,
      [formatNames([name])],
      `matches files of types with different settings of ${formatNames(ruleNames)}, and no glob matches just one type's files of it. ${splitOverrideHint(files, name)}, or wrap the setting with \`replace()\``,
    ),
  )
}
