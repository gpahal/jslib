import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isTokenAtKeyword,
  isTokenCloseCurly,
  isTokenCloseParen,
  isTokenColon,
  isTokenDelim,
  isTokenEOF,
  isTokenFunction,
  isTokenIdent,
  isTokenOpenCurly,
  isTokenSemicolon,
  isTokenString,
  isTokenURL,
  isTokenWhiteSpaceOrComment,
  tokenize,
} from '@csstools/css-tokenizer'
import type { CSSToken } from '@csstools/css-tokenizer'
import { AtRule, CssSyntaxError, parse } from 'postcss'
import type { Plugin } from 'postcss'
import type { Config } from 'stylelint'

import { resolveListOption } from '@gpahal/internal/node/options'
import { resolveFileOption, URL_SCHEME_REGEX } from '@gpahal/internal/node/paths'
import { resolveFile, resolveFromNodeModules } from '@gpahal/internal/node/resolve'
import { formatMessage, formatNames, getErrorReason } from '@gpahal/std/errors'

import { CUSTOM_PROPERTY_EMPTY_LINE_BEFORE } from '@/internal/custom-property-empty-line-before'
import { PREFIX } from '@/internal/options'
import type { TailwindcssOptions } from '@/internal/options'
import { mergeUserRules } from '@/internal/rules'
import type { StylelintRules } from '@/internal/rules'
import { TAILWIND_APPLY } from '@/internal/tailwind-apply'
import { TAILWIND_DIRECTIVES, untypedFunctionsPattern } from '@/internal/tailwind-directives'
import {
  tailwindCompileOf,
  tailwindModulePath,
  tailwindStylesheetPath,
} from '@/internal/tailwind-loader'
import type { TailwindCompile } from '@/internal/tailwind-loader'
import { isReset, recordUnprefixedName } from '@/internal/tailwind-theme-function'
import { THEME_FUNCTIONS } from '@/internal/tailwind-values'

type Syntax = NonNullable<NonNullable<Config['languageOptions']>['syntax']>

type AtRuleSyntax = NonNullable<Syntax['atRules']>[string]

/**
 * Tailwind v4 functions, which only Tailwind can evaluate
 */
const TAILWIND_FUNCTIONS: ReadonlyArray<string> = ['theme', '--theme', '--spacing', '--alpha']

/**
 * Tailwind v4 at-rules
 */
const TAILWIND_AT_RULES: ReadonlyArray<string> = [
  'config',
  'plugin',
  'theme',
  'source',
  'utility',
  'variant',
  'custom-variant',
  'reference',
  'tailwind',
]

/**
 * The syntax of the Tailwind functions whose result has a known type. Values with the others, such
 * as `theme()`, skip `declaration-property-value-no-unknown`
 */
const TAILWIND_FUNCTION_SYNTAX: Record<string, Record<string, string>> = {
  // `color` takes a `|` alternative, which Stylelint adds to its own definition
  '--alpha': {
    '--alpha()': '--alpha( <color> / [ <percentage> | <number> ] )',
    color: '| <--alpha()>',
  },
}

/**
 * The options of `@theme`, which `@import 'tailwindcss' theme(…)` takes too
 */
const TAILWIND_THEME_OPTIONS = '[ inline || reference || default || static || prefix( <ident> ) ]'

/**
 * The syntax of Tailwind at-rules. Utility and variant names, as in `@utility tab-*` and
 * `@custom-variant 3xl`, aren't CSS identifiers, so their preludes take any value, as does an
 * at-rule without an entry. None declares descriptors, so its block's declarations aren't checked
 * as descriptors
 */
const TAILWIND_AT_RULE_SYNTAX: Record<string, AtRuleSyntax> = {
  config: { prelude: '<string>' },
  plugin: { prelude: '<string>' },
  theme: { prelude: `${TAILWIND_THEME_OPTIONS}?` },
  source: { prelude: 'not? [ <string> | inline( <string> ) ]' },
  utility: { prelude: '<any-value>' },
  variant: { prelude: '<any-value>' },
  'custom-variant': { prelude: '<any-value>' },
  reference: { prelude: '<string>' },
  // `@tailwind base` and the other layers are Tailwind CSS v3's
  tailwind: { prelude: 'utilities [ source( none | <string> ) ]?' },
}

/**
 * The CSS at-rules Tailwind extends. Stylelint's `@apply` is the abandoned CSS proposal's, which
 * takes one identifier. The `|` adds an `@import` alternative with Tailwind's options to
 * Stylelint's definition
 */
const TAILWIND_CSS_AT_RULE_SYNTAX: Record<string, AtRuleSyntax> = {
  apply: { prelude: '<any-value>' },
  import: {
    prelude: `| [ <url> | <string> ] [ [ layer | layer( <layer-name> ) ] || source( none | <string> ) || prefix( <ident> ) || important || theme( ${TAILWIND_THEME_OPTIONS} ) ]`,
  },
}

/**
 * The CSS at-rules that `tailwindcss.atRules` rejects, since an added name's any-value prelude would
 * replace Stylelint's syntax
 */
const CSS_AT_RULES: ReadonlySet<string> = new Set([
  'charset',
  'color-profile',
  'container',
  'counter-style',
  'custom-media',
  'document',
  'font-face',
  'font-feature-values',
  'font-palette-values',
  'function',
  'import',
  'keyframes',
  'layer',
  'media',
  'namespace',
  'page',
  'position-try',
  'property',
  'scope',
  'starting-style',
  'supports',
  'view-transition',
])

/**
 * A CSS function name, custom ones such as `--theme` included
 */
const CSS_FUNCTION_NAME_REGEX = /^(?:--)?-?[_a-z][\w-]*$/i

const AT_RULE_NAME_REGEX = /^-?[_a-z][\w-]*$/i

/**
 * The syntax and rules for Tailwind CSS v4. Some rules merge over the preset's setting, which
 * `settingOf` gives
 *
 * @throws TypeError when `functions` or `atRules` gives an invalid list or name.
 */
export function tailwindcssConfig(
  { functions, atRules, validateApply }: TailwindcssOptions,
  settingOf: (name: string) => unknown,
): { syntax: Syntax; rules: StylelintRules } {
  const tailwindFunctions = resolveListOption(functions, TAILWIND_FUNCTIONS, {
    prefix: PREFIX,
    name: 'tailwindcss.functions',
  })
  const tailwindAtRules = resolveListOption(atRules, TAILWIND_AT_RULES, {
    prefix: PREFIX,
    name: 'tailwindcss.atRules',
  })
  // The names go into a regular expression, which a name such as `a.b` would widen
  const invalidName = tailwindFunctions.find((name) => !CSS_FUNCTION_NAME_REGEX.test(name))
  if (invalidName !== undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`tailwindcss.functions`'],
        `${formatNames([invalidName])} isn't a CSS function name`,
      ),
    )
  }
  // An at-rule name such as `@brand` or `''` would never match, so it would do nothing
  const invalidAtRule = tailwindAtRules.find((name) => !AT_RULE_NAME_REGEX.test(name))
  if (invalidAtRule !== undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`tailwindcss.atRules`'],
        `${formatNames([invalidAtRule])} isn't an at-rule name${invalidAtRule.startsWith('@') ? '. Give it without the `@`' : ''}`,
      ),
    )
  }
  const cssAtRule = tailwindAtRules.find((name) => CSS_AT_RULES.has(name.toLowerCase()))
  if (cssAtRule !== undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`tailwindcss.atRules`'],
        `${formatNames([cssAtRule])} is a CSS at-rule, which Stylelint already knows`,
      ),
    )
  }
  const syntax: Syntax = {
    types: Object.fromEntries(
      tailwindFunctions.flatMap((name) => Object.entries(TAILWIND_FUNCTION_SYNTAX[name] ?? {})),
    ),
    atRules: {
      ...TAILWIND_CSS_AT_RULE_SYNTAX,
      ...Object.fromEntries(
        tailwindAtRules.map((name) => [
          name,
          (Object.hasOwn(TAILWIND_AT_RULE_SYNTAX, name)
            ? TAILWIND_AT_RULE_SYNTAX[name]
            : undefined) ?? { prelude: '<any-value>?' },
        ]),
      ),
    },
  }
  const untypedFunctions = tailwindFunctions.filter(
    (name) => !Object.hasOwn(TAILWIND_FUNCTION_SYNTAX, name),
  )
  const untypedPattern = untypedFunctionsPattern(untypedFunctions)
  // These rules don't read `languageOptions.syntax`, so each gets its own copy of the names
  const rules: StylelintRules = {
    // Tailwind scopes the `&` in its at-rules, such as `@custom-variant dark { &:where(.dark) {} }`
    'nesting-selector-no-missing-scoping-root': [true, { ignoreAtRules: [...tailwindAtRules] }],
    // A query with a Tailwind function is valid once Tailwind replaces the function
    'media-query-no-invalid': [true, { ignoreFunctions: [...tailwindFunctions] }],
    ...(untypedPattern !== undefined && {
      'declaration-property-value-no-unknown': [
        true,
        { ignoreProperties: { '/.+/': [untypedPattern] } },
      ],
    }),
    // Reports Tailwind's `theme(--color-red-500)` when the file defines `--color-red-500`
    'custom-property-no-missing-var-function': null,
    [TAILWIND_DIRECTIVES]: [true, { untypedFunctions: [...untypedFunctions] }],
    ...(validateApply === true && { [TAILWIND_APPLY]: true }),
    // Also allows namespace resets (`--color-*`, `--*`), sub-properties (`--text-tiny--line-height`)
    // and escaped dots (`--color-gray-0\.5`)
    'custom-property-pattern': [
      String.raw`^(\*|[a-z][a-z0-9]*(\\\.[a-z0-9]+)*(--?[a-z0-9]+(\\\.[a-z0-9]+)*)*(-\*)?)$`,
      {
        message: (name: string) => `Expected custom property name "${name}" to be kebab-case`,
      },
    ],
    // Tailwind's `theme.css` groups the variables of a `@theme` block with blank lines, which this
    // rule's fix deletes
    'custom-property-empty-line-before': null,
    [CUSTOM_PROPERTY_EMPTY_LINE_BEFORE]: null,
    // As Tailwind's `theme.css` writes them
    'alpha-value-notation': 'number',
    'hue-degree-notation': 'number',
    ...mergeUserRules(
      {
        // Stylelint skips custom functions, whose names start with `--`, by itself
        'function-no-unknown': [
          true,
          { ignoreFunctions: tailwindFunctions.filter((name) => !name.startsWith('--')) },
        ],
        // Legacy key paths, such as `fontSize.sm`, and theme variable names are case-sensitive
        'value-keyword-case': ['lower', { ignoreFunctions: [...THEME_FUNCTIONS] }],
        // `@apply` goes among declarations, and an entry file may group its at-rules with or
        // without blank lines, daisyUI's `@plugin` with an options block included
        'at-rule-empty-line-before': [
          'always',
          {
            except: ['first-nested'],
            ignore: ['blockless-after-blockless'],
            ignoreAtRules: ['apply', 'import', 'plugin', 'source', 'config', 'reference'],
          },
        ],
      },
      settingOf,
    ),
  }
  return { syntax, rules }
}

/**
 * The deepest that {@link importedFiles} follows imports below the entry point
 */
const MAX_IMPORT_DEPTH = 32

/**
 * The imports of Tailwind's theme, which aren't followed. Their `prefix()` prefixes the theme, as a
 * `@theme` one does
 */
const THEME_PACKAGES: ReadonlySet<string> = new Set([
  'tailwindcss',
  'tailwindcss/index',
  'tailwindcss/index.css',
  'tailwindcss/theme',
  'tailwindcss/theme.css',
])

/**
 * The unescaped target of an `@import` or `@reference` prelude, in string or `url()` form
 */
function targetOf(prelude: ReadonlyArray<CSSToken>): string | undefined {
  const [first, second, third] = prelude
  if (isTokenString(first) || isTokenURL(first)) {
    return first[4].value
  }
  return isTokenFunction(first) &&
    first[4].value.toLowerCase() === 'url' &&
    isTokenString(second) &&
    isTokenCloseParen(third)
    ? second[4].value
    : undefined
}

/**
 * The `<ident>` of a prelude's `prefix( <ident> )`. Tailwind reads `prefix(` only in lowercase
 */
function prefixOf(prelude: ReadonlyArray<CSSToken>): string | undefined {
  const index = prelude.findIndex((token) => isTokenFunction(token) && token[4].value === 'prefix')
  const [ident, close] = prelude.slice(index + 1)
  return index !== -1 && isTokenIdent(ident) && isTokenCloseParen(close)
    ? ident[4].value
    : undefined
}

/**
 * The index of the `;`, `{` or end of file that ends the prelude of an at-rule from `start`
 */
function preludeEndOf(tokens: ReadonlyArray<CSSToken>, start: number): number {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (
      token === undefined ||
      isTokenSemicolon(token) ||
      isTokenOpenCurly(token) ||
      isTokenEOF(token)
    ) {
      return index
    }
  }
  return tokens.length
}

/**
 * An `@import` or `@reference` rule, or a `@theme` rule with the namespaces its block resets, such
 * as `--color` for `--color-*: initial` or `--` for `--*: initial`
 */
type StylesheetRule =
  | { kind: 'import'; target: string; prefix: string | undefined }
  | { kind: 'theme'; prefix: string | undefined; resets: ReadonlyArray<string> }

/**
 * Whether `tokens`, the four after a declaration's name, are `*`, `:`, `initial` and the
 * declaration's end
 */
function isResetAfterName([star, colon, value, after]: ReadonlyArray<CSSToken>): boolean {
  const isStar = star !== undefined && isTokenDelim(star) && star[4].value === '*'
  const isColon = colon !== undefined && isTokenColon(colon)
  const isInitial =
    value !== undefined && isTokenIdent(value) && value[4].value.toLowerCase() === 'initial'
  const isEnd = after === undefined || isTokenSemicolon(after) || isTokenCloseCurly(after)
  return isStar && isColon && isInitial && isEnd
}

/**
 * Whether `tokens[index]`, at depth 1, starts a declaration of the block opened at `tokens[start]`:
 * it follows the block's `{`, a `;` or the `}` of a nested block
 */
function isDeclarationStart(
  tokens: ReadonlyArray<CSSToken>,
  index: number,
  start: number,
): boolean {
  const previous = tokens[index - 1]
  return (
    index === start + 1 ||
    (previous !== undefined && (isTokenSemicolon(previous) || isTokenCloseCurly(previous)))
  )
}

/**
 * The namespaces that the top-level declarations of the block opened at `tokens[start]` reset, and
 * the index after the block
 */
function blockResetsOf(
  tokens: ReadonlyArray<CSSToken>,
  start: number,
): { resets: Array<string>; end: number } {
  const resets: Array<string> = []
  let depth = 0
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined || isTokenEOF(token)) {
      return { resets, end: index }
    }
    if (isTokenOpenCurly(token)) {
      depth += 1
    } else if (isTokenCloseCurly(token)) {
      depth -= 1
      if (depth === 0) {
        return { resets, end: index + 1 }
      }
    } else if (
      depth === 1 &&
      isTokenIdent(token) &&
      isDeclarationStart(tokens, index, start) &&
      /^--(?:[\w-]*-)?$/.test(token[4].value) &&
      isResetAfterName(tokens.slice(index + 1, index + 5))
    ) {
      resets.push(token[4].value === '--' ? '--' : token[4].value.slice(0, -1))
    }
  }
  return { resets, end: tokens.length }
}

/**
 * A stylesheet's `@import`, `@reference` and `@theme` rules, in order. A tokenizer reads them, so
 * text in strings and comments isn't an at-rule. Each token is read once
 */
function readStylesheet(css: string): Array<StylesheetRule> {
  const tokens = tokenize({ css }).filter((token) => !isTokenWhiteSpaceOrComment(token))
  const rules: Array<StylesheetRule> = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    const name = isTokenAtKeyword(token) ? token[4].value.toLowerCase() : undefined
    if (name !== 'import' && name !== 'reference' && name !== 'theme') {
      index += 1
      continue
    }
    const end = preludeEndOf(tokens, index + 1)
    const prelude = tokens.slice(index + 1, end)
    index = end
    if (name === 'theme') {
      const opening = tokens[end]
      const block =
        opening !== undefined && isTokenOpenCurly(opening) ? blockResetsOf(tokens, end) : undefined
      rules.push({ kind: 'theme', prefix: prefixOf(prelude), resets: block?.resets ?? [] })
      index = block?.end ?? end
      continue
    }
    const target = targetOf(prelude)
    if (target !== undefined) {
      rules.push({ kind: 'import', target, prefix: prefixOf(prelude) })
    }
  }
  return rules
}

/**
 * The file that Tailwind's resolver gives for the relative path `importPath`: the file, else
 * `<importPath>.css`, else a folder's `style` field, else its `index.css`. The reason when the
 * folder's `package.json` can't be read
 */
function resolveCssFile(
  importPath: string,
): { path: string } | { reason: string; cause: unknown } | undefined {
  try {
    return resolveFile(importPath, { mainFields: ['style'], extensions: ['.css'] })
  } catch {
    // As in enhanced-resolve. Reading the path then reports the error
    return undefined
  }
}

/**
 * The path of an import's `target` in the file at `importer`, or `undefined` for one that isn't
 * followed. Relative paths and `file:` URLs resolve as in {@link resolveCssFile}, staying as they
 * are when no file matches so the walk reports them. A bare path is tried next to `importer`, as
 * Tailwind does, then as a package import. Tailwind's own package, missing packages, absolute and
 * scheme-relative paths, other URL schemes and paths with a query or hash aren't followed
 */
function importPathOf(
  target: string,
  importer: string,
): string | { reason: string; cause: unknown } | undefined {
  if (/^file:/i.test(target)) {
    let importPath: string
    try {
      importPath = fileURLToPath(new URL(target))
    } catch {
      return undefined
    }
    const resolved = resolveCssFile(importPath)
    return resolved === undefined ? importPath : 'path' in resolved ? resolved.path : resolved
  }
  if (
    target === '' ||
    target.startsWith('/') ||
    URL_SCHEME_REGEX.test(target) ||
    /[?#]/.test(target)
  ) {
    return undefined
  }
  const importPath = path.resolve(path.dirname(importer), target)
  const resolved = resolveCssFile(importPath)
  if (resolved !== undefined) {
    return 'path' in resolved ? resolved.path : resolved
  }
  // A bare `.` or `..` is a folder, as Tailwind reads it, and no package's name
  if (/^\.\.?(?:\/|$)/.test(target)) {
    return importPath
  }
  return isTailwindImport(target) ? undefined : packageImportPathOf(target, importer)
}

/**
 * The path of a stylesheet import for Tailwind's `compile()`, as {@link importPathOf} resolves it,
 * absolute paths included
 *
 * @throws TypeError when resolving it fails.
 */
export function resolveTailwindImport(target: string, importer: string): string | undefined {
  // Tailwind loads an absolute path, which the walk of the reference files doesn't follow
  const resolved =
    path.isAbsolute(target) && !target.startsWith('//')
      ? (resolveCssFile(target) ?? target)
      : importPathOf(target, importer)
  if (typeof resolved === 'object' && 'path' in resolved) {
    return resolved.path
  }
  if (typeof resolved === 'object') {
    throw new TypeError(resolved.reason, { cause: resolved.cause })
  }
  return resolved
}

/**
 * Whether `target` names Tailwind's package or a file in it. Only its `theme.css` defines theme
 * variables
 */
function isTailwindImport(target: string): boolean {
  return target === 'tailwindcss' || target.startsWith('tailwindcss/')
}

/**
 * The file a package import resolves to, as Tailwind resolves it: the `style` condition of
 * `exports`, else the `style` field, else `index.css`. `undefined` when the package isn't
 * installed, or the reason when `target` doesn't resolve in it
 */
function packageImportPathOf(
  target: string,
  importer: string,
): string | { reason: string; cause: unknown } | undefined {
  try {
    return resolveFromNodeModules(target, importer, {
      prefix: PREFIX,
      conditions: ['style'],
      mainFields: ['style'],
      extensions: ['.css'],
    })?.path
  } catch (error) {
    // The caller's message already names the package and the import
    const subject = `${PREFIX}: ${formatNames([target])}: `
    const reason = getErrorReason(error)
    return {
      reason: reason.startsWith(subject)
        ? reason.slice(subject.length)
        : reason.replace(`${PREFIX}: `, ''),
      cause: error,
    }
  }
}

/**
 * The files of an entry point's import graph and its theme prefix
 */
type ImportGraph = {
  files: Array<string>
  prefix: string | undefined
  /**
   * The namespaces reset after the import of Tailwind's theme, since a reset before it clears
   * nothing. All resets when the files don't import the theme
   */
  resets?: ReadonlyArray<string> | undefined
}

/**
 * A file's walk in {@link importGraph}: the prefix it sets last, whether it imports the theme, and
 * the namespaces it resets, all and after the theme
 */
type FileWalk = ThemeResets & { prefix: string | undefined }

type ThemeResets = {
  hasTheme: boolean
  resets: ReadonlySet<string> | ReadonlyArray<string>
  resetsAfterTheme: ReadonlySet<string> | ReadonlyArray<string>
}

/**
 * Add the resets of `next`, a `@theme` block or an import's walk, to `state`
 */
function followResets(
  state: { hasTheme: boolean; resets: Set<string>; resetsAfterTheme: Set<string> },
  next: ThemeResets,
): void {
  for (const namespace of next.resets) {
    state.resets.add(namespace)
  }
  const after = state.hasTheme ? next.resets : next.resetsAfterTheme
  for (const namespace of after) {
    state.resetsAfterTheme.add(namespace)
  }
  state.hasTheme ||= next.hasTheme
}

/**
 * Tailwind's reference files, its `theme.css` among them, and the `--tw-*` properties its utilities
 * register
 */
export type TailwindReferences = ImportGraph & {
  theme: string
  properties?: ReadonlyArray<string> | undefined
}

/**
 * The entry point and the files its `@import` and `@reference` rules name, recursively, each once by
 * real path, in first-import order, with the theme prefix. As in Tailwind, an import's `prefix()`
 * applies over its files' own, the last prefixed `@theme` or theme import sets the theme's prefix,
 * and a file imported again takes its last import's prefix. Walks are memoized by file and prefix,
 * so repeated imports cost little. Cycles are skipped, conditional imports followed, and non-CSS
 * files left out
 *
 * @throws TypeError naming the importing file when an import can't be resolved, doesn't exist,
 *   isn't a file, can't be read or doesn't parse, or the imports nest more than
 *   {@link MAX_IMPORT_DEPTH} deep.
 */
function importGraph(
  entryPath: string,
  entryCss: string,
): ImportGraph & { realPaths: ReadonlySet<string> } {
  const entryRealPath = fs.realpathSync(entryPath)
  const files = [entryPath]
  const listed = new Set([entryRealPath])
  const rulesOf = new Map([[entryRealPath, readStylesheet(entryCss)]])
  const walked = new Map<string, Map<string | undefined, FileWalk>>()
  const walking = new Set<string>()
  const walk = (
    file: string,
    realPath: string,
    depth: number,
    importPrefix: string | undefined,
  ): FileWalk => {
    const memo = walked.get(realPath)
    const memoized = memo?.get(importPrefix)
    if (memoized !== undefined) {
      return memoized
    }
    walking.add(realPath)
    let lastPrefix: string | undefined
    const state = {
      hasTheme: false,
      resets: new Set<string>(),
      resetsAfterTheme: new Set<string>(),
    }
    const rules = rulesOf.get(realPath) ?? []
    for (const rule of rules) {
      if (rule.kind === 'theme' || THEME_PACKAGES.has(rule.target)) {
        lastPrefix = importPrefix ?? rule.prefix ?? lastPrefix
      }
      if (rule.kind === 'theme') {
        followResets(state, { hasTheme: false, resets: rule.resets, resetsAfterTheme: [] })
        continue
      }
      state.hasTheme ||= THEME_PACKAGES.has(rule.target)
      const { target } = rule
      // As in Tailwind, a symlinked file's imports resolve from the folder of its real path
      const importPath = importPathOf(target, realPath)
      if (importPath === undefined) {
        continue
      }
      const fail = (description: string, cause?: unknown): never => {
        throw new TypeError(
          formatMessage(PREFIX, ['`tailwindcss.entryPoint`', formatNames([file])], description),
          cause === undefined ? undefined : { cause },
        )
      }
      if (typeof importPath !== 'string') {
        return fail(
          `resolving its import ${formatNames([target])} failed: ${importPath.reason}`,
          importPath.cause,
        )
      }
      const read = <T>(action: () => T): T => {
        try {
          return action()
        } catch (error) {
          return fail(
            `reading its import ${formatNames([importPath])} failed: ${getErrorReason(error)}`,
            error,
          )
        }
      }
      // A FIFO or a device would block the read or never end
      const stats = read(() => fs.statSync(importPath, { throwIfNoEntry: false }))
      if (stats === undefined) {
        return fail(`its import ${formatNames([importPath])} doesn't exist`)
      }
      if (!stats.isFile()) {
        return fail(`its import ${formatNames([importPath])} isn't a file`)
      }
      // A non-CSS file, such as a `.env` a package imports, would become a reference file whose
      // parse error prints its content. The real path is checked too, for a `.css` symlink
      if (!/\.css$/i.test(importPath)) {
        continue
      }
      const importRealPath = read(() => fs.realpathSync(importPath))
      if (!/\.css$/i.test(importRealPath) || walking.has(importRealPath)) {
        continue
      }
      const childPrefix = importPrefix ?? rule.prefix
      if (depth === MAX_IMPORT_DEPTH && walked.get(importRealPath)?.has(childPrefix) !== true) {
        return fail(`its imports nest more than ${MAX_IMPORT_DEPTH} deep`)
      }
      if (!rulesOf.has(importRealPath)) {
        const css = read(() => fs.readFileSync(importPath, 'utf8'))
        parseImport(css, importPath, fail)
        rulesOf.set(importRealPath, readStylesheet(css))
      }
      if (!listed.has(importRealPath)) {
        listed.add(importRealPath)
        files.push(importPath)
      }
      const child = walk(importPath, importRealPath, depth + 1, childPrefix)
      lastPrefix = child.prefix ?? lastPrefix
      followResets(state, child)
    }
    walking.delete(realPath)
    const result: FileWalk = { ...state, prefix: lastPrefix }
    walked.set(
      realPath,
      (memo ?? new Map<string | undefined, FileWalk>()).set(importPrefix, result),
    )
    return result
  }
  const entry = walk(entryPath, entryRealPath, 0, undefined)
  return {
    files,
    prefix: entry.prefix,
    // Files that don't import the theme are likely imported after it
    resets: [...(entry.hasTheme ? entry.resetsAfterTheme : entry.resets)],
    realPaths: listed,
  }
}

/**
 * Parse the import at `file`, so one that doesn't parse fails once here rather than for every file
 * Stylelint lints. The error drops the file's text, which could hold secrets: postcss keeps it as
 * the source, and its `Unknown word` reason quotes it
 */
function parseImport(
  css: string,
  file: string,
  fail: (description: string, cause?: unknown) => never,
): void {
  try {
    parse(css, { from: file })
  } catch (error) {
    if (!(error instanceof CssSyntaxError)) {
      throw error
    }
    Reflect.deleteProperty(error, 'source')
    if (error.input !== undefined) {
      Reflect.deleteProperty(error.input, 'source')
    }
    const reason = error.reason.startsWith('Unknown word') ? 'Unknown word' : error.reason
    error.reason = reason
    const position =
      error.line === undefined ? '' : ` at line ${error.line}, column ${error.column ?? 1}`
    error.message = `${file}${error.line === undefined ? '' : `:${error.line}:${error.column ?? 1}`}: ${reason}`
    return fail(
      `parsing its import ${formatNames([file])} failed${position}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
      error,
    )
  }
}

/**
 * The `tailwindcss/theme.css` installed at or above `parentPath`'s folder, ignoring `NODE_PATH`,
 * which pnpm sets for package scripts
 */
function themeFrom(parentPath: string): string | undefined {
  return resolveFromNodeModules('tailwindcss/theme.css', parentPath, { prefix: PREFIX })?.path
}

/**
 * The files that define the Tailwind theme, for `referenceFiles`: the entry point's import graph
 * and the `tailwindcss/theme.css` installed at or above its folder, or without an entry point, the
 * one installed at or above `root`
 *
 * @throws TypeError when the entry point is invalid or unreadable, an import fails to resolve,
 *   read or parse, or `tailwindcss/theme.css` doesn't resolve.
 */
export function tailwindReferenceFiles(
  entryPoint: string | URL | undefined,
  root: string,
): TailwindReferences {
  if (entryPoint === undefined) {
    const failRoot = (cause?: unknown): never => {
      throw new TypeError(
        formatMessage(
          PREFIX,
          ['`tailwindcss`'],
          `\`tailwindcss/theme.css\` doesn't resolve from \`root\`, ${formatNames([root])}. Install Tailwind CSS v4 there`,
        ),
        cause === undefined ? undefined : { cause },
      )
    }
    let theme: string | undefined
    try {
      theme = themeFrom(path.join(root, 'package.json'))
    } catch (error) {
      return failRoot(error)
    }
    const rootTheme = theme ?? failRoot()
    return { files: [rootTheme], prefix: undefined, theme: rootTheme }
  }
  // Stylelint would report a missing file only when it lints
  const entryPath = resolveFileOption(entryPoint, root, {
    prefix: PREFIX,
    name: 'tailwindcss.entryPoint',
  })
  let entryCss: string
  try {
    entryCss = fs.readFileSync(entryPath, 'utf8')
  } catch (error) {
    return failEntryPoint(
      `reading ${formatNames([entryPath])} failed: ${getErrorReason(error)}`,
      error,
    )
  }
  const { files, prefix, resets, realPaths } = importGraph(entryPath, entryCss)
  const notResolved = `\`tailwindcss/theme.css\` doesn't resolve from its folder, ${formatNames([path.dirname(entryPath)])}. Install Tailwind CSS v4 there`
  let theme: string | undefined
  try {
    theme = themeFrom(entryPath)
  } catch (error) {
    return failEntryPoint(notResolved, error)
  }
  if (theme === undefined) {
    return failEntryPoint(notResolved)
  }
  // An import of the theme through a symlinked `node_modules` lists it already
  const hasTheme = realPaths.has(fs.realpathSync(theme))
  return { files: hasTheme ? files : [...files, theme], prefix, resets, theme }
}

function failEntryPoint(description: string, cause?: unknown): never {
  throw new TypeError(
    formatMessage(PREFIX, ['`tailwindcss.entryPoint`'], description),
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Candidates whose utilities register every `--tw-*` property. `tests/tailwind-properties.test.ts`
 * checks them against all of Tailwind's classes and variants
 */
export const TAILWIND_PROPERTY_CANDIDATES: ReadonlyArray<string> = [
  '-mask-conic-0',
  '-mask-linear-0',
  '-rotate-x-0',
  '-scale-0',
  '-space-x-0',
  '-space-y-0',
  '-tracking-normal',
  '-translate-0',
  'backdrop-blur-2xl',
  'before:flex',
  'blur-2xl',
  'border',
  'border-spacing-0',
  'contain-inline-size',
  'diagonal-fractions',
  'divide-x',
  'divide-y',
  'duration-75',
  'ease-in',
  'font-black',
  'from-0%',
  'inset-ring',
  'leading-0',
  'mask-b-from-0',
  'mask-l-from-0',
  'mask-r-from-0',
  'mask-radial-from-0',
  'mask-t-from-0',
  'outline',
  'scrollbar-thumb-amber-50',
  'snap-both',
  'text-shadow-2xs',
  'touch-pan-down',
]

export function propertyNamesOf(css: string): Array<string> {
  return [...new Set(css.matchAll(/@property\s+(--[\w-]+)/g).map((match) => match[1] ?? ''))]
}

/**
 * The `--tw-*` property names by Tailwind module path, so a process compiles Tailwind once
 */
const propertyNamesCache = new Map<string, Promise<Array<string>>>()

/**
 * The `--tw-*` properties that the utilities of the Tailwind next to `theme` register with
 * `@property`, which no stylesheet declares. A theme prefix doesn't change them
 *
 * @throws TypeError when that Tailwind can't be loaded or compiled.
 */
export async function tailwindPropertyNames(theme: string): Promise<Array<string>> {
  const modulePath = tailwindModulePath(theme, failEntryPoint)
  let names = propertyNamesCache.get(modulePath)
  if (names === undefined) {
    names = compileProperties(tailwindCompileOf(modulePath, failEntryPoint), path.dirname(theme))
    propertyNamesCache.set(modulePath, names)
  }
  try {
    return [...(await names)]
  } catch (error) {
    propertyNamesCache.delete(modulePath)
    return failEntryPoint(
      `compiling Tailwind CSS for its \`--tw-*\` properties failed: ${getErrorReason(error)}`,
      error,
    )
  }
}

async function compileProperties(
  compile: TailwindCompile,
  packageDir: string,
): Promise<Array<string>> {
  const loadStylesheet = async (id: string, base: string) => {
    const file = tailwindStylesheetPath(id, packageDir) ?? path.resolve(base, id)
    return {
      path: file,
      base: path.dirname(file),
      content: await fs.promises.readFile(file, 'utf8'),
    }
  }
  const compiler = await compile("@import 'tailwindcss';", { base: packageDir, loadStylesheet })
  return propertyNamesOf(compiler.build([...TAILWIND_PROPERTY_CANDIDATES]))
}

/**
 * The loader of Tailwind's reference files. It renames `@theme` variables with the theme `prefix`,
 * as Tailwind does, and in `theme.css` removes the `resets` namespaces and adds an `@property` rule
 * for each of `properties`, so the reference rules know them
 */
export function tailwindThemeLoader({
  prefix,
  theme,
  properties,
  resets = [],
}: {
  prefix: string | undefined
  theme: string
  properties: ReadonlyArray<string>
  resets?: ReadonlyArray<string> | undefined
}): Plugin {
  const themeRealPath = realPathOf(theme)
  const cachedRealPathOf = realPathCache()
  return {
    postcssPlugin: '@gpahal/stylelint-config/tailwind-theme',
    Once(root) {
      const file = root.source?.input.file
      const isTheme = file !== undefined && cachedRealPathOf(file) === themeRealPath
      if (isTheme && resets.length > 0) {
        root.walkAtRules(/^theme$/i, (atRule) => {
          atRule.walkDecls(/^--/, (declaration) => {
            if (isReset(declaration.prop, resets)) {
              declaration.remove()
            }
          })
        })
      }
      if (prefix !== undefined) {
        root.walkAtRules(/^theme$/i, (atRule) => {
          atRule.walkDecls(/^--/, (declaration) => {
            recordUnprefixedName(declaration, declaration.prop)
            declaration.prop = `--${prefix}-${declaration.prop.slice(2)}`
          })
        })
      }
      if (isTheme && properties.length > 0) {
        root.append(properties.map((name) => new AtRule({ name: 'property', params: name })))
      }
    },
  }
}

/**
 * The real path of `file`, or `file` when it doesn't exist
 */
function realPathOf(file: string): string {
  try {
    return fs.realpathSync(file)
  } catch {
    return file
  }
}

/**
 * {@link realPathOf}, read once per file. A loader keeps one, so each reference file is resolved
 * once per config, like the paths the loader compares it with
 */
function realPathCache(): (file: string) => string {
  const realPaths = new Map<string, string>()
  return (file) => {
    let realPath = realPaths.get(file)
    if (realPath === undefined) {
      realPath = realPathOf(file)
      realPaths.set(file, realPath)
    }
    return realPath
  }
}

/**
 * The loader of your reference files under a prefixed theme. It empties the files of the theme's
 * import graph, which already load with the prefix and would otherwise add unprefixed names
 */
export function outsideThemeGraphLoader(graphFiles: ReadonlyArray<string>): Plugin {
  const graphRealPaths = new Set(graphFiles.map((file) => realPathOf(file)))
  const cachedRealPathOf = realPathCache()
  return {
    postcssPlugin: '@gpahal/stylelint-config/outside-theme-graph',
    Once(root) {
      const file = root.source?.input.file
      if (file !== undefined && graphRealPaths.has(cachedRealPathOf(file))) {
        root.removeAll()
      }
    },
  }
}
