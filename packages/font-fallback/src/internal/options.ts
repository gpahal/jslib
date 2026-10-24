import * as z from 'zod/mini'

import { optionsObject } from '@gpahal/internal/node/options'
import type { OptionsShape } from '@gpahal/internal/node/options'
import { assertValid, expectedError, plainObject, typeCheck } from '@gpahal/internal/node/zod'
import { describeValue, formatMessage, formatNames } from '@gpahal/std/errors'

import { isSignalLike } from '@/internal/signal'
import type { FontFallbacksOptions } from '@/internal/types'

export const PREFIX = '@gpahal/font-fallback'

/**
 * The subject of errors about the options
 */
const OPTIONS_SUBJECT = '`getFontFallbacks` options'

const FONT_CATEGORIES = ['sans-serif', 'serif', 'monospace'] as const

/**
 * What a category must be, for the option and the CLI's `--category`
 */
export const EXPECTED_CATEGORY: string = formatNames(FONT_CATEGORIES, { conjunction: 'or' })

/**
 * Words of letters and digits, joined by single spaces or hyphens, with an optional leading
 * hyphen, as in `-apple-system`. It leaves out quotes, `:`, `/`, `\`, controls, schemes and
 * surrounding or repeated whitespace
 */
const FAMILY_NAME_REGEX = /^-?[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u
const MAX_FAMILY_NAME_LENGTH = 64

/**
 * What a family name must be, for a source, `fallbacks` and the CLI's font and `--fallback`
 */
export const EXPECTED_FAMILY_NAME: string = `a family name of letters, digits, single spaces and hyphens, up to ${MAX_FAMILY_NAME_LENGTH} characters`

export function isFamilyName(value: string): boolean {
  return value.length <= MAX_FAMILY_NAME_LENGTH && FAMILY_NAME_REGEX.test(value)
}

/**
 * {@link FAMILY_NAME_REGEX} with `_` and `.` in its words, for generated names such as Next.js's
 * `__Inter_d65c78`. Family names, which are looked up, stay strict
 */
const FONT_FACE_NAME_REGEX = /^-?[\p{L}\p{N}_.]+(?:[ -][\p{L}\p{N}_.]+)*$/u

/**
 * What the `font-family` name of the web font's `@font-face` must be, for `name` and `--name`
 */
export const EXPECTED_FONT_FACE_NAME: string = `a font-family name of letters, digits, underscores, periods, single spaces and hyphens, up to ${MAX_FAMILY_NAME_LENGTH} characters`

export function isFontFaceName(value: string): boolean {
  return value.length <= MAX_FAMILY_NAME_LENGTH && FONT_FACE_NAME_REGEX.test(value)
}

/**
 * The key two family names are compared by, as CSS compares them in any case
 */
export function getFamilyKey(familyName: string): string {
  return familyName.toLowerCase()
}

/**
 * The description of the error for options that can't be combined, for the options and the CLI
 */
export const CONFLICT_DESCRIPTION = "can't be combined. Drop one"

const familyName = z.string().check(
  z.refine(isFamilyName, {
    error: expectedError(EXPECTED_FAMILY_NAME),
  }),
)

const fontFaceName = z.string().check(
  z.refine(isFontFaceName, {
    error: expectedError(EXPECTED_FONT_FACE_NAME),
  }),
)

/**
 * The `@font-face` descriptors `fontFaceProperties` can set: those of CSS Fonts Level 4 and 5 that
 * the package doesn't write
 */
const FONT_FACE_DESCRIPTORS: ReadonlySet<string> = new Set([
  'font-display',
  'font-feature-settings',
  'font-language-override',
  'font-named-instance',
  'font-stretch',
  'font-style',
  'font-variation-settings',
  'font-weight',
  'font-width',
  'unicode-range',
])

/**
 * The `@font-face` descriptors the package writes, with the fix for setting each
 */
const COMPUTED_DESCRIPTORS: ReadonlyMap<string, string> = new Map([
  ['font-family', 'Drop it, and set `name` to change it'],
  ['src', 'Drop it'],
  ['size-adjust', 'Drop it, and set `sizeAdjust` to change it'],
  ['ascent-override', 'Drop it, and set `sizeAdjust` to change it'],
  ['descent-override', 'Drop it, and set `sizeAdjust` to change it'],
  ['line-gap-override', 'Drop it, and set `sizeAdjust` to change it'],
])

/**
 * The description of the error for a `fontFaceProperties` key that isn't a descriptor it can set,
 * or `undefined`
 */
function getDescriptorNameIssue(name: string): string | undefined {
  const fix = COMPUTED_DESCRIPTORS.get(name)
  if (fix !== undefined) {
    return `${formatNames([name])} is written by the package. ${fix}`
  }
  if (!FONT_FACE_DESCRIPTORS.has(name)) {
    return `expected an @font-face descriptor of ${formatNames([...FONT_FACE_DESCRIPTORS], { conjunction: 'or' })}, received ${describeValue(name)}`
  }
  return undefined
}

/**
 * A character that could end a declaration, the rule, a comment or the `<style>` element or
 * double-quoted attribute the CSS is inlined in, or that would hide text: a control or format
 * character, a line or paragraph separator, which breaks a JavaScript string literal before
 * ES2019, a lone surrogate, `;`, `{`, `}`, `<`, `>`, `&`, `"`, `\`, `!`, or a comment's start or
 * end. A descriptor value is CSS, not a string, so these are rejected rather than escaped
 */
const UNSAFE_VALUE_REGEX = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp};{}<>&"\\!]|\/\*|\*\//u

const EXPECTED_DESCRIPTOR_VALUE =
  'a CSS value without surrounding whitespace, control, format, line separator or paragraph separator characters, `;`, `{`, `}`, `<`, `>`, `&`, `"`, `\\`, `!` or comments, whose single quotes, parentheses and brackets are closed and whose `url()` arguments are quoted'

/**
 * A `url(` whose argument isn't quoted. An unquoted URL is a token of its own, in which quotes and
 * parentheses don't nest
 */
const UNQUOTED_URL_REGEX = /(?:^|[^\w-])url\($/i

/**
 * Whether a value's single quotes, parentheses and brackets are closed, outside of quotes, and its
 * `url(` arguments are quoted. Unclosed, they would swallow the rest of the rule
 */
function isClosed(value: string): boolean {
  const closers: Array<string> = []
  let isQuoted = false
  // By UTF-16 unit, so that indexes match `slice`'s
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index)
    if (char === "'") {
      isQuoted = !isQuoted
      continue
    }
    if (isQuoted) {
      continue
    }
    if (char === '(' || char === '[') {
      const isUnquotedUrl =
        char === '(' &&
        UNQUOTED_URL_REGEX.test(value.slice(0, index + 1)) &&
        // Spaces only: CSS's other whitespace, tab, LF, CR and FF, are controls, which
        // `UNSAFE_VALUE_REGEX` rejects first. Not JavaScript's `\s`, which also matches U+00A0
        !/^ *'/.test(value.slice(index + 1))
      if (isUnquotedUrl) {
        return false
      }
      closers.push(char === '(' ? ')' : ']')
    } else if ((char === ')' || char === ']') && closers.pop() !== char) {
      return false
    }
  }
  return !isQuoted && closers.length === 0
}

function isDescriptorValue(value: string): boolean {
  return (
    value !== '' && value.trim() === value && !UNSAFE_VALUE_REGEX.test(value) && isClosed(value)
  )
}

const MIN_SIZE_ADJUST = 50
const MAX_SIZE_ADJUST = 200
const EXPECTED_SIZE_ADJUST = `a percentage from ${MIN_SIZE_ADJUST} to ${MAX_SIZE_ADJUST}, such as 105 for 105%`

const OPTIONS_SCHEMA = optionsObject<FontFallbacksOptions>({
  category: z.enum(FONT_CATEGORIES, {
    error: expectedError(EXPECTED_CATEGORY),
  }),
  fallbacks: z.array(familyName).check(
    z.refine((fallbacks) => fallbacks.length > 0, {
      error: expectedError(
        'at least one family',
        "Leave the option out for the category's defaults",
      ),
    }),
  ),
  // Names are checked on the raw own keys, as `z.record` drops a JSON `__proto__` key
  fontFaceProperties: z.pipe(
    plainObject().check(
      z.superRefine((value, context) => {
        for (const name of Object.keys(value)) {
          const description = getDescriptorNameIssue(name)
          if (description !== undefined) {
            context.addIssue({ code: 'custom', message: description, input: value })
            return
          }
        }
      }),
    ),
    z.record(
      z.string(),
      z
        .string()
        .check(z.refine(isDescriptorValue, { error: expectedError(EXPECTED_DESCRIPTOR_VALUE) })),
    ),
  ),
  name: fontFaceName,
  // Checked by the parts read, so a signal of another realm, or a polyfill, passes
  signal: typeCheck<AbortSignal>(isSignalLike, {
    expected: 'an `AbortSignal`',
  }),
  sizeAdjust: z.number({ error: expectedError(EXPECTED_SIZE_ADJUST) }).check(
    z.refine((value) => value >= MIN_SIZE_ADJUST && value <= MAX_SIZE_ADJUST, {
      error: expectedError(EXPECTED_SIZE_ADJUST),
    }),
  ),
} satisfies OptionsShape<FontFallbacksOptions>)

/**
 * The options checked, as a copy of their own keys, which is what to read
 *
 * @throws TypeError if an option is unknown or not valid, or a fallback repeats.
 */
export function checkOptions(options: unknown): FontFallbacksOptions {
  const checked = assertValid(OPTIONS_SCHEMA, options, {
    prefix: PREFIX,
    subject: OPTIONS_SUBJECT,
  })
  if (checked.category !== undefined && checked.fallbacks !== undefined) {
    throw new TypeError(
      formatMessage(PREFIX, [OPTIONS_SUBJECT, '`category` and `fallbacks`'], CONFLICT_DESCRIPTION),
    )
  }
  const seen = new Map<string, number>()
  const fallbacks = checked.fallbacks ?? []
  for (const [index, fallback] of fallbacks.entries()) {
    const firstIndex = seen.get(getFamilyKey(fallback))
    if (firstIndex !== undefined) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [OPTIONS_SUBJECT, `\`fallbacks[${index}]\``],
          `repeats \`fallbacks[${firstIndex}]\`, as family names match in any case. Drop one`,
        ),
      )
    }
    seen.set(getFamilyKey(fallback), index)
  }
  return checked
}
