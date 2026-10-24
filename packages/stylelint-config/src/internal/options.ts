import path from 'node:path'

import type { Config, Plugin } from 'stylelint'
import type * as z from 'zod/mini'

import { expandBraces, scanBraces } from '@gpahal/internal/globs'
import {
  booleanOr,
  deferred,
  isStringOrStrings,
  listOption,
  optionsObject,
  required,
} from '@gpahal/internal/node/options'
import type { ListOption, ListTransform, OptionsShape } from '@gpahal/internal/node/options'
import {
  assertValid,
  expectedError,
  loadZod,
  plainObject,
  stringOrStrings,
  typeCheck,
} from '@gpahal/internal/node/zod'
import { isArray, isArrayOf, toArray } from '@gpahal/std/arrays'
import { describeValue, formatMessage, formatNames } from '@gpahal/std/errors'
import { once } from '@gpahal/std/functions'
import { isObject, isPlainObject, isRecord } from '@gpahal/std/objects'

import type {
  StylelintExtendedConfig,
  StylelintExtends,
  StylelintOverride,
  StylelintPlugins,
  StylelintReferenceFile,
  StylelintReferenceFiles,
  StylelintRules,
} from '@/internal/rules'

export type StylelintConfigOptions = {
  /**
   * Absolute path of an existing folder, usually `import.meta.dirname`. Relative paths, globs and
   * module names resolve from it
   */
  root: string
  /**
   * Accept Tailwind CSS v4's at-rules, functions and theme variables. `functions` and `atRules` take
   * an array that replaces the defaults or a function of them; a CSS at-rule such as `media` throws.
   * `entryPoint`, an absolute path, a path relative to `root`, or a `file:` URL or URL string, adds
   * the entry stylesheet, its imports and Tailwind's `theme.css` to the reference files. See
   * https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#tailwind-css-changes
   */
  tailwindcss?:
    | boolean
    | {
        functions?: ListOption | undefined
        atRules?: ListOption | undefined
        entryPoint?: string | URL | undefined
        /**
         * Turns on `@gpahal/tailwind-apply`, which checks `@apply` classes and `@variant` variants
         * against the design system of `entryPoint`, or Tailwind's default. Off by default, since
         * it compiles the entry point, plugins included, when the config loads
         */
        validateApply?: boolean | undefined
      }
    | undefined
  /**
   * Lints the `<style>` blocks and `style` attributes of `.astro` files. On by default. Off, as with
   * `html` and `markdown`, adds the files to `ignoreFiles` so Stylelint doesn't parse them as CSS
   */
  astro?: boolean | undefined
  /**
   * Lints the `<style>` blocks and `style` attributes of `.html` files. On by default
   */
  html?: boolean | undefined
  /**
   * Lints the CSS code blocks of `.md` and `.markdown` files, and their HTML `<style>` blocks and
   * `style` attributes. On by default. A `stylelint-disable` in a code block also covers the blocks
   * after it until a `stylelint-enable`
   */
  markdown?: boolean | undefined
  /**
   * The `@gpahal/comment-layout` rule. On by default. Off, its plugin stays registered for `rules`
   */
  commentLayout?: boolean | undefined
  /**
   * Prefers logical properties, units and keywords, as `margin-inline-start` for `margin-left`, with
   * Stylelint's `*-layout-mappings` rules. Off by default
   */
  logical?: boolean | undefined
  /**
   * Plugins after the preset's: plugin objects, or paths or package names resolved from `root`
   */
  plugins?: StylelintPlugins | undefined
  /**
   * Rules merged over the preset's and your `extends` configs' settings: the primary option
   * replaces, secondary options merge and `ignore*` lists add. `null` turns a rule off, `undefined`
   * keeps the base setting, and `replace()` skips merging. See
   * https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#rule-merging
   */
  rules?: StylelintRules | undefined
  /**
   * Overrides after the preset's, whose rules merge over the settings for their files. One that
   * spans file types splits by type, or throws when its globs can't split. `files` takes no `!`
   * globs. See https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#overrides
   */
  overrides?: ReadonlyArray<StylelintOverride> | undefined
  /**
   * A glob, an array of globs, or a function that receives `[]` and returns them. They follow the
   * globs of disabled file types and extended configs, keeping each glob's last occurrence, so a
   * later negation can restore files
   */
  ignoreFiles?: string | ReadonlyArray<string> | ListTransform | undefined
  /**
   * Files that define the custom properties, custom media and keyframes the linted files use, as
   * globs or Stylelint's `{ files, customSyntax, loader }` entries. Turns on the `no-unknown-*`
   * reference rules, adding Tailwind's theme with `tailwindcss` on. An entry of paths without glob
   * syntax, none of which exists, throws. See https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#reference-files
   */
  referenceFiles?: StylelintReferenceFiles | undefined
  /**
   * Config objects, paths or package names, loaded in order. A loaded config's paths resolve from
   * its folder, but override `files` match from `root`. Their rules replace the preset's, and yours
   * merge over theirs. Cycles, nesting over 32 levels and `fix` throw. See
   * https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#options
   */
  extends?: StylelintExtends | undefined
  /**
   * Stylelint's `languageOptions`, merged deeply into the preset's
   */
  languageOptions?: NonNullable<Config['languageOptions']> | undefined
  /**
   * The severity of the rules whose settings don't give one
   */
  defaultSeverity?: NonNullable<Config['defaultSeverity']> | undefined
  /**
   * The syntax of files no file type override matches: a PostCSS syntax or a package name
   */
  customSyntax?: NonNullable<Config['customSyntax']> | undefined
  /**
   * Stylelint's `quiet`
   */
  quiet?: boolean | undefined
  /**
   * Stylelint's `formatter`
   */
  formatter?: NonNullable<Config['formatter']> | undefined
  /**
   * Stylelint's `ignoreDisables`
   */
  ignoreDisables?: boolean | undefined
  /**
   * Stylelint's `reportNeedlessDisables`, in place of the preset's `[true, { except:
   * ['plugin/use-baseline'] }]`
   */
  reportNeedlessDisables?: Config['reportNeedlessDisables'] | undefined
  /**
   * Stylelint's `reportInvalidScopeDisables`, in place of the preset's `true`
   */
  reportInvalidScopeDisables?: Config['reportInvalidScopeDisables'] | undefined
  /**
   * Stylelint's `reportDescriptionlessDisables`, in place of the preset's `true`
   */
  reportDescriptionlessDisables?: Config['reportDescriptionlessDisables'] | undefined
  /**
   * Stylelint's `reportUnscopedDisables`
   */
  reportUnscopedDisables?: Config['reportUnscopedDisables'] | undefined
  /**
   * Stylelint's `maxWarnings`
   */
  maxWarnings?: number | undefined
  /**
   * Stylelint's `computeEditInfo`
   */
  computeEditInfo?: boolean | undefined
  /**
   * Stylelint's `configurationComment`
   */
  configurationComment?: string | undefined
  /**
   * Stylelint's experimental `processors`
   */
  processors?: ReadonlyArray<string> | undefined
  /**
   * Stylelint's `allowEmptyInput`
   */
  allowEmptyInput?: boolean | undefined
  /**
   * Stylelint's `cache`
   */
  cache?: boolean | undefined
}

export type TailwindcssOptions = Extract<StylelintConfigOptions['tailwindcss'], object>

export const PREFIX = '@gpahal/stylelint-config'

/**
 * Whether `value` is a path, a package name or a plugin object, which a module imported whole holds
 * under `default`
 */
function isPlugin(value: unknown): boolean {
  return typeof value === 'string' || isRecord(value)
}

/**
 * Whether `value` is a package name or a PostCSS syntax, which can be a function, as `postcss-html`
 * is
 */
function isCustomSyntax(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'function' || isObject(value)
}

const DISABLE_SEVERITIES: ReadonlySet<unknown> = new Set([undefined, 'warning', 'error'])

/**
 * Whether `value` is a setting of Stylelint's disable reports, such as `reportNeedlessDisables`
 */
function isDisableSettings(value: unknown): boolean {
  if (value === null || typeof value === 'boolean') {
    return true
  }
  if (!isArray(value) || typeof value[0] !== 'boolean' || value.length > 2) {
    return false
  }
  if (value.length === 1) {
    return true
  }
  const options: unknown = value[1]
  if (!isPlainObject(options)) {
    return false
  }
  const { except, severity, ...rest } = options
  return (
    Reflect.ownKeys(rest).length === 0 &&
    (except === undefined ||
      isArrayOf(except, (item) => typeof item === 'string' || item instanceof RegExp)) &&
    DISABLE_SEVERITIES.has(severity)
  )
}

/**
 * The schemas, built on first use rather than on import, so the static presets don't load Zod
 */
const schemas = once(() => {
  const z = loadZod()
  const tailwindcssChecks: OptionsShape<TailwindcssOptions> = {
    functions: listOption(z.string(), 'functions'),
    atRules: listOption(z.string(), 'at-rules'),
    entryPoint: typeCheck<string | URL>(
      (value) => typeof value === 'string' || value instanceof URL,
      { expected: 'a string or a URL' },
    ),
    validateApply: z.boolean(),
  }

  const PLUGIN_SCHEMA = typeCheck<string | Plugin>(isPlugin, { expected: 'a plugin or a path' })

  // A plugin, or an array of them as a module of several plugins exports, which `defineConfig`
  // flattens
  const PLUGIN_ITEM_SCHEMA = z.union([PLUGIN_SCHEMA, z.array(PLUGIN_SCHEMA)], {
    error: expectedError('a plugin or a path, or an array of them'),
  })

  // What `plugins` takes, typed as the option, without the nested arrays `defineConfig` flattens
  const PLUGINS_SCHEMA = deferred<StylelintPlugins>(
    z.union([PLUGIN_SCHEMA, z.array(PLUGIN_ITEM_SCHEMA)], {
      error: expectedError('a plugin or a path, or an array of them'),
    }),
  )

  // Reference entries reject unknown keys before Stylelint can silently drop them
  const REFERENCE_ENTRY_SCHEMA = optionsObject<StylelintReferenceFile>({
    files: required(stringOrStrings()),
    customSyntax: typeCheck<NonNullable<StylelintReferenceFile['customSyntax']>>(isCustomSyntax, {
      expected: 'a package name or a PostCSS syntax',
    }),
    loader: typeCheck<NonNullable<StylelintReferenceFile['loader']>>(
      (value) => typeof value === 'string' || typeof value === 'function' || isObject(value),
      { expected: 'a string or a PostCSS plugin' },
    ),
  })

  const REFERENCE_FILE_SCHEMA = z.union([z.string(), REFERENCE_ENTRY_SCHEMA], {
    error: expectedError('a glob or an entry with `files`'),
  })

  const REFERENCE_FILES_SCHEMA = z.union([REFERENCE_FILE_SCHEMA, z.array(REFERENCE_FILE_SCHEMA)], {
    error: expectedError('a glob or an entry with `files`, or an array of them'),
  })

  const DISABLE_SETTINGS_SCHEMA = typeCheck<Exclude<Config['reportNeedlessDisables'], undefined>>(
    isDisableSettings,
    {
      expected: 'a boolean, or a boolean and an object of `except` and `severity`',
    },
  )

  // Stylelint accepts config objects even though its types only list strings
  const EXTENDS_ENTRY_SCHEMA = typeCheck<string | StylelintExtendedConfig>(
    (value) => typeof value === 'string' || isPlainObject(value),
    { expected: 'a config or a path or package name' },
  )

  const EXTENDS_SCHEMA = deferred<StylelintExtends>(
    z.union([EXTENDS_ENTRY_SCHEMA, z.array(EXTENDS_ENTRY_SCHEMA)], {
      error: expectedError('a config, a path or package name, or an array of them'),
    }),
  )

  const PROCESSORS_SCHEMA = z.array(z.string())

  // Typed so a key added to the options can't be left out
  const optionChecks: OptionsShape<StylelintConfigOptions> = {
    root: required(
      typeCheck<string>((value) => typeof value === 'string' && path.isAbsolute(value), {
        expected: 'an absolute path, such as `import.meta.dirname`',
      }),
    ),
    tailwindcss: booleanOr(optionsObject<TailwindcssOptions>(tailwindcssChecks)),
    astro: z.boolean(),
    html: z.boolean(),
    markdown: z.boolean(),
    commentLayout: z.boolean(),
    logical: z.boolean(),
    plugins: PLUGINS_SCHEMA,
    // Stylelint checks the rules' settings
    rules: deferred(plainObject()),
    // `checkOverrides` checks each override
    overrides: z.array(deferred<StylelintOverride>(plainObject()), {
      error: expectedError('an array of overrides'),
    }),
    // A function receives `[]`, since the disabled types' and extended configs' globs join separately
    ignoreFiles: z.union(
      [
        z.string(),
        z.array(z.string()),
        typeCheck<ListTransform>((value) => typeof value === 'function', {
          expected: 'a function',
        }),
      ],
      {
        error: expectedError(
          'a glob, an array of globs, or a function that receives `[]` and returns them',
        ),
      },
    ),
    referenceFiles: REFERENCE_FILES_SCHEMA,
    extends: EXTENDS_SCHEMA,
    languageOptions: plainObject(),
    defaultSeverity: z.literal(['warning', 'error']),
    customSyntax: typeCheck<NonNullable<Config['customSyntax']>>(isCustomSyntax, {
      expected: 'a package name or a PostCSS syntax',
    }),
    quiet: z.boolean(),
    formatter: typeCheck<NonNullable<Config['formatter']>>(
      (value) => typeof value === 'string' || typeof value === 'function',
      { expected: 'a formatter name or function' },
    ),
    ignoreDisables: z.boolean(),
    reportNeedlessDisables: DISABLE_SETTINGS_SCHEMA,
    reportInvalidScopeDisables: DISABLE_SETTINGS_SCHEMA,
    reportDescriptionlessDisables: DISABLE_SETTINGS_SCHEMA,
    reportUnscopedDisables: DISABLE_SETTINGS_SCHEMA,
    maxWarnings: typeCheck<number>(
      (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
      { expected: 'a non-negative integer' },
    ),
    computeEditInfo: z.boolean(),
    configurationComment: z.string(),
    processors: PROCESSORS_SCHEMA,
    allowEmptyInput: z.boolean(),
    cache: z.boolean(),
  }

  // Typed so a key Stylelint adds to its override type can't be left out. Stylelint checks the
  // values of the deferred keys. The keys it sets itself (`_*`) or reads once per run (`formatter`,
  // `maxWarnings`, `allowEmptyInput`, `cache`) do nothing in an override, so they're unknown
  const overrideChecks: OptionsShape<StylelintOverride> = {
    files: required(stringOrStrings()),
    name: deferred(),
    extends: EXTENDS_SCHEMA,
    plugins: PLUGINS_SCHEMA,
    ignoreFiles: stringOrStrings(),
    rules: deferred(plainObject()),
    quiet: deferred(),
    defaultSeverity: deferred(),
    ignoreDisables: deferred(),
    reportNeedlessDisables: deferred(),
    reportInvalidScopeDisables: deferred(),
    reportDescriptionlessDisables: deferred(),
    reportUnscopedDisables: deferred(),
    configurationComment: deferred(),
    customSyntax: deferred(),
    processors: deferred(),
    referenceFiles: REFERENCE_FILES_SCHEMA,
    languageOptions: deferred(),
    computeEditInfo: z.boolean(),
    validate: z.boolean(),
  }

  return {
    optionsSchema: optionsObject<StylelintConfigOptions>(optionChecks, {
      expected: 'an object of options',
    }),
    overrideSchema: optionsObject<StylelintOverride>(overrideChecks),
    referenceFilesSchema: REFERENCE_FILES_SCHEMA,
    processorsSchema: PROCESSORS_SCHEMA,
  }
})

export function optionsSchema(): z.ZodMiniType<StylelintConfigOptions, StylelintConfigOptions> {
  return schemas().optionsSchema
}

/**
 * A config's `fix` applies fixes in memory and drops their warnings, but Stylelint writes files only
 * with the run's `fix`, so the run would pass with the problems still in the files
 */
export const FIX_REJECTION =
  "isn't taken, since it hides problems without writing fixes. Pass `--fix`"

/**
 * Stylelint config keys the options reject. The run's `validate`, `true` by default, replaces a
 * top-level one, but an override's applies after it
 */
const KEY_REJECTIONS: ReadonlyMap<string, string> = new Map([
  ['fix', FIX_REJECTION],
  [
    'validate',
    "isn't taken at the top level, where the run's `validate`, `true` by default, replaces it. Pass `--no-validate`, or set it in an override",
  ],
])

/**
 * Check for the keys of {@link KEY_REJECTIONS}, which the schema would call unknown without saying
 * why
 *
 * @throws TypeError naming the first such key.
 */
export function checkRejectedKeys(options: unknown): void {
  if (!isPlainObject(options)) {
    return
  }
  for (const key of Object.keys(options)) {
    const reason = KEY_REJECTIONS.get(key)
    if (reason !== undefined) {
      throw new TypeError(formatMessage(PREFIX, [formatNames([key])], reason))
    }
  }
}

const OVERRIDE_KEY_REJECTIONS: ReadonlyMap<string, string> = new Map([['fix', FIX_REJECTION]])

/**
 * Check your overrides, since Stylelint ignores unknown keys. Returns copies of their own keys,
 * which are what to read
 *
 * @throws TypeError naming the override when it has `fix`, an unknown key, an invalid value or an
 *   invalid glob.
 */
export function checkOverrides(
  overrides: ReadonlyArray<StylelintOverride>,
): Array<StylelintOverride> {
  return overrides.map((override, index) => checkOverride(override, index))
}

/**
 * {@link checkOverrides} of the override at `index`
 *
 * @throws TypeError as {@link checkOverrides} does.
 */
export function checkOverride(override: StylelintOverride, index: number): StylelintOverride {
  for (const key of Object.keys(override)) {
    const reason = OVERRIDE_KEY_REJECTIONS.get(key)
    if (reason !== undefined) {
      throw new TypeError(
        formatMessage(PREFIX, [formatNames([`overrides[${index}].${key}`])], reason),
      )
    }
  }
  const untypedOverride: unknown = override
  const checked = assertValid(schemas().overrideSchema, untypedOverride, {
    prefix: PREFIX,
    path: ['overrides', index],
  })
  if (checked.ignoreFiles !== undefined)
    checkIgnoreGlobs(checked.ignoreFiles, `overrides[${index}].ignoreFiles`)
  checkOverrideFiles(checked.files, `overrides[${index}].files`)
  if (checked.referenceFiles !== undefined) {
    checkReferenceGlobs(checked.referenceFiles, `overrides[${index}].referenceFiles`)
  }
  return checked
}

/**
 * {@link expandBraces} of `glob`. Matchers read an unclosed `{` as text, but {@link expandBraces}
 * counts it toward the nesting limit, so the error says when those braces alone make it fail
 *
 * @throws TypeError when the glob is out of {@link expandBraces}'s bounds.
 */
export function expandGlobBraces(glob: string, subject: string): Array<string> {
  const context = { prefix: PREFIX, subjects: [subject] }
  try {
    return expandBraces(glob, context)
  } catch (error) {
    const { unclosed } = scanBraces(glob)
    if (unclosed.length === 0) {
      throw error
    }
    const escaped = unclosed.reduceRight(
      (text, index) => `${text.slice(0, index)}\\${text.slice(index)}`,
      glob,
    )
    try {
      expandBraces(escaped, context)
    } catch {
      throw error
    }
    throw new TypeError(
      formatMessage(
        PREFIX,
        [subject],
        `glob ${formatNames([glob])} has ${unclosed.length} \`{\` without a matching \`}\`, which count as nested braces, more than 10 deep. Close the braces, or escape a literal one as \`\\{\``,
      ),
      { cause: error },
    )
  }
}

/**
 * @throws TypeError when `globs` is empty, or a glob is empty or out of {@link expandBraces}'s
 *   bounds.
 */
function checkReferenceEntryGlobs(globs: string | ReadonlyArray<string>, name: string): void {
  checkGlobList(globs, name)
  for (const [index, glob] of toArray(globs).entries()) {
    const subject = typeof globs === 'string' ? name : `${name}[${index}]`
    expandGlobBraces(glob, formatNames([subject]))
  }
}

/**
 * Check the globs of `referenceFiles`, since long or deeply nested brace globs make Stylelint's
 * matching slow. `!` globs exclude files there, so they're allowed
 *
 * @throws TypeError when a glob list is empty, or a glob is empty or out of
 *   {@link expandBraces}'s bounds.
 */
export function checkReferenceGlobs(referenceFiles: StylelintReferenceFiles, name: string): void {
  const isList = isArray(referenceFiles)
  for (const [index, file] of toArray<string | StylelintReferenceFile>(referenceFiles).entries()) {
    const fileName = isList ? `${name}[${index}]` : name
    if (typeof file === 'string') {
      checkReferenceEntryGlobs(file, fileName)
    } else {
      checkReferenceEntryGlobs(file.files, `${fileName}.files`)
    }
  }
}

/**
 * @throws TypeError when `files` has no globs, or a glob is empty.
 */
function checkGlobList(files: string | ReadonlyArray<string>, name: string): void {
  const globs = toArray(files)
  if (globs.length === 0) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [formatNames([name])],
        `expected at least one glob, received ${describeValue(files)}`,
      ),
    )
  }
  for (const [index, glob] of globs.entries()) {
    const globSubject = formatNames([typeof files === 'string' ? name : `${name}[${index}]`])
    if (glob === '') {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [globSubject],
          `expected a non-empty glob, received ${describeValue(glob)}`,
        ),
      )
    }
  }
}

/**
 * Check an override's `files`. Stylelint applies an override when any glob matches, so a `!` glob
 * would match every other file rather than exclude
 *
 * @throws TypeError when `files` has no globs, or a glob is empty or starts with `!`.
 */
export function checkOverrideFiles(files: string | ReadonlyArray<string>, name: string): void {
  assertValid(stringOrStrings(), files, { prefix: PREFIX, subject: formatNames([name]) })
  checkGlobList(files, name)
  for (const [index, glob] of toArray(files).entries()) {
    const globSubject = formatNames([typeof files === 'string' ? name : `${name}[${index}]`])
    expandGlobBraces(glob, globSubject)
    if (glob.startsWith('!')) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [globSubject],
          `${formatNames([glob])} matches every other file, since Stylelint applies an override when any of its globs matches. Exclude files with \`ignoreFiles\`, or list positive globs`,
        ),
      )
    }
  }
}

/**
 * Bound every ignore glob, including those read from shared configs
 */
export function checkIgnoreGlobs(globs: string | ReadonlyArray<string>, name: string): void {
  // Zod only for a value it would reject, so the static presets don't load it
  if (!isStringOrStrings(globs)) {
    assertValid(stringOrStrings(), globs, { prefix: PREFIX, subject: formatNames([name]) })
  }
  for (const [index, glob] of toArray(globs).entries()) {
    expandGlobBraces(glob, formatNames([typeof globs === 'string' ? name : `${name}[${index}]`]))
  }
}

/**
 * Check reference entries read from extended configs as strictly as public options
 */
export function checkReferenceFiles(value: unknown, name: string): void {
  const checked = assertValid(schemas().referenceFilesSchema, value, {
    prefix: PREFIX,
    subject: formatNames([name]),
  })
  checkReferenceGlobs(checked, name)
}

/**
 * Validate loaded processor entries before path normalization
 */
export function checkProcessors(value: unknown, name: string): void {
  assertValid(schemas().processorsSchema, value, { prefix: PREFIX, subject: formatNames([name]) })
}
