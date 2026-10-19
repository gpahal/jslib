/**
 * `escapeControls`, for std's own modules. `@gpahal/std/strings` makes it public
 */

/**
 * Characters that can rewrite or hide text in a terminal or log: control and format characters,
 * such as ESC and the bidirectional overrides, line and paragraph separators, lone surrogates (with
 * the `u` flag a pair is one code point, so only a lone half matches `Cs`), default-ignorable code
 * points, such as variation selectors, Hangul fillers and tag characters, and the braille blank,
 * U+2800.
 *
 * The zero-width non-joiner and joiner, U+200C and U+200D, are left out: they join emoji ZWJ
 * sequences and Persian and Indic script, and can't reorder text the way bidirectional controls can
 */
const CONTROL_REGEX =
  /(?![\u{200C}\u{200D}])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}\u{2800}]/gu

/**
 * {@link CONTROL_REGEX} or a backslash, matched in one pass so no escape is escaped again
 */
const CONTROL_OR_BACKSLASH_REGEX =
  /\\|(?![\u{200C}\u{200D}])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}\u{2800}]/gu

function escapeCharacter(char: string): string {
  if (char === '\\') {
    return '\\\\'
  }
  const codePoint = char.codePointAt(0) ?? 0
  const hex = codePoint.toString(16)
  return codePoint > 0xff_ff ? String.raw`\u{${hex}}` : String.raw`\u${hex.padStart(4, '0')}`
}

/**
 * `text` with each control or format character, line or paragraph separator, lone surrogate,
 * default-ignorable code point and braille blank written as a JavaScript escape, and each backslash
 * as `\\`, so the output reads back unambiguously. The zero-width joiner and non-joiner stay. For
 * untrusted text in error messages, logs and terminal output
 *
 * @example
 * ```ts
 * import { escapeControls } from '@gpahal/std/strings'
 *
 * escapeControls('a\u202eb') // 'a\\u202eb'
 * escapeControls('C:\\a', { keepBackslashes: true }) // 'C:\\a'
 * ```
 */
export function escapeControls(
  text: string,
  options?: {
    /**
     * Leaves backslashes as they are, for text whose backslashes are already escapes or path
     * separators. The output is then ambiguous: a literal `\u001b` reads like an escaped control
     * character
     */
    keepBackslashes?: boolean | undefined
  },
): string {
  return text.replaceAll(
    options?.keepBackslashes === true ? CONTROL_REGEX : CONTROL_OR_BACKSLASH_REGEX,
    (char) => escapeCharacter(char),
  )
}
