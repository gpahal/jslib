import type { FontFallback } from '@/internal/types'

/**
 * The `@font-face` rule of a fallback, with `properties` after the computed descriptors. The
 * comment and the strings have no `<` or `"`, so any name is safe to inline in a `<style>` element
 * or a double-quoted HTML attribute. `checkOptions` checks that the properties' values are as safe
 */
export function renderFontFace(
  rule: Omit<FontFallback, 'css'>,
  properties: Readonly<Record<string, string>> = {},
): string {
  const declarations = [
    `font-family: ${quote(rule.familyName)}`,
    `src: ${rule.localNames.map((name) => `local(${quote(name)})`).join(', ')}`,
    `size-adjust: ${toPercentage(rule.sizeAdjust)}`,
    `ascent-override: ${toPercentage(rule.ascentOverride)}`,
    `descent-override: ${toPercentage(rule.descentOverride)}`,
    `line-gap-override: ${toPercentage(rule.lineGapOverride)}`,
    ...Object.entries(properties).map(([name, value]) => `${name}: ${value}`),
  ]
  return `/* fallback ${toCommentText(rule.fallbackFamily)} */
@font-face {
${declarations.map((declaration) => `  ${declaration};`).join('\n')}
}`
}

/**
 * The characters escaped in a CSS string: the quote, `\` and controls, `<`, `>`, `&` and `"` so
 * the string can't end a `<style>` element or a double-quoted attribute, format characters, which
 * can hide or reorder text, and lone surrogates. NUL becomes U+FFFD, as the CSS parser reads it
 */
const CSS_STRING_SPECIAL_CHAR_REGEX = /[\p{Cc}\p{Cf}\p{Cs}'\\<>&"]/gu

function quote(name: string): string {
  return `'${name.replaceAll(CSS_STRING_SPECIAL_CHAR_REGEX, (char) => {
    if (char === '\0') {
      return '\u{FFFD}'
    }
    return char === "'" || char === '\\' ? `\\${char}` : escapeCodePoint(char)
  })}'`
}

/**
 * `char` as a CSS escape. The space ends the escape, so a hex digit after it isn't read as part of it
 */
function escapeCodePoint(char: string): string {
  return `\\${char.codePointAt(0)?.toString(16).toUpperCase() ?? ''} `
}

const CSS_IDENTIFIER_REGEX = /^-?[a-z_][\w-]*$/i

/**
 * Keywords a family name must be quoted to be read as a name
 */
const FONT_FAMILY_KEYWORDS: ReadonlySet<string> = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'default',
  '-webkit-body',
  '-webkit-pictograph',
  '-webkit-standard',
])

/**
 * A family name for a `font-family` value, quoted unless it's an identifier that isn't a keyword
 */
export function toFontFamilyName(name: string): string {
  return CSS_IDENTIFIER_REGEX.test(name) && !FONT_FAMILY_KEYWORDS.has(name.toLowerCase())
    ? name
    : quote(name)
}

const CONTROL_CHAR_REGEX = /[\p{Cc}\p{Cf}]/gu
const HTML_SPECIAL_CHAR_REGEX = /[<>&"]/g

/**
 * `text` with nothing that could end its comment, or the `<style>` element or double-quoted
 * attribute around it. Comments have no escapes, so `<`, `>`, `&` and `"` are written as the CSS
 * escapes they'd be in a string, and controls and format characters, which could reorder the
 * comment, are dropped
 */
function toCommentText(text: string): string {
  return text
    .replaceAll(CONTROL_CHAR_REGEX, '')
    .replaceAll('*/', String.raw`*\/`)
    .replaceAll(HTML_SPECIAL_CHAR_REGEX, (char) => escapeCodePoint(char))
}

export function toPercentage(value: number, fractionDigits = 6): string {
  // Rounding through `Number` drops trailing zeros and float noise such as `28.999999999999996`
  return `${Number((value * 100).toFixed(fractionDigits))}%`
}
