/**
 * The categories that pick the default fallbacks.
 */
export type FontCategory = 'sans-serif' | 'serif' | 'monospace'

/**
 * The web font's regular face:
 * - a string: a URL that starts with `https://`, in any case, which is fetched, or else the exact,
 *   case-sensitive name of a family in `@capsizecss/metrics`, such as `'Inter'`. A family name is
 *   letters, digits, single spaces and hyphens, up to 64 characters, so whitespace around it,
 *   quotes, a face suffix such as `:wght@400`, a path and another scheme throw, and so do
 *   `-apple-system` and `BlinkMacSystemFont`, which name the system UI font;
 * - a `URL`: a `file:` URL is read, and an `https:` one fetched. Its path must end in `.ttf`,
 *   `.otf` or `.woff2`;
 * - the bytes of a TTF, OTF or WOFF2 font file, up to 20 MiB.
 *
 * A `URL` and bytes are copied when passed, so changing them later has no effect. The README's
 * "Rejected inputs" lists the URL rules, such as no credentials, query or private host.
 */
export type FontSource = string | URL | Uint8Array

export type FontFallbacksOptions = {
  /**
   * Picks the default fallbacks. Defaults to the category of the family in `@capsizecss/metrics`
   * that the source, or else `name`, names exactly, with display and handwriting fonts as
   * `sans-serif`. A font file whose `name` isn't such a family needs `category` or `fallbacks`.
   * Can't be combined with `fallbacks`.
   */
  category?: FontCategory | undefined
  /**
   * The local font families to fall back to, in order, in place of the category's defaults. Each
   * must be the exact name of a family in `@capsizecss/metrics` with a regular face. An empty array, a
   * repeated family, the web font itself in any case, or one too unlike it for a size-adjusted rule
   * throws.
   */
  fallbacks?: ReadonlyArray<string> | undefined
  /**
   * Other descriptors written into each `@font-face` rule, after the ones the package computes,
   * such as `{ 'font-display': 'swap' }`: `font-display`, `font-feature-settings`,
   * `font-language-override`, `font-named-instance`, `font-stretch`, `font-style`,
   * `font-variation-settings`, `font-weight`, `font-width` or `unicode-range`, in lowercase. A
   * value is written as is, so characters that could end the rule or a `<style>` element throw.
   * Quote a string such as a feature tag with `'`.
   */
  fontFaceProperties?: Readonly<Record<string, string>> | undefined
  /**
   * The web font's `font-family` name, which the fallback family names start with: letters,
   * digits, underscores, periods, single spaces and hyphens, up to 64 characters, so a generated
   * name such as `__Inter_d65c78` works. Required for a font file, URL or bytes, and defaults to the
   * family name for a family.
   */
  name?: string | undefined
  /**
   * Aborts fetching and reading a font file and looking up families, and rejects with its reason
   * once it's aborted, or an `AbortError` if it has none. A signal of another realm, or a polyfill
   * with `aborted`, `addEventListener` and `removeEventListener`, works too. Parsing is synchronous, so it can't
   * interrupt that.
   */
  signal?: AbortSignal | undefined
  /**
   * The `size-adjust` of every rule, as a percentage from 50 to 200, such as `105` for 105%, in
   * place of the one computed from average widths. The ascent, descent and line gap overrides are
   * computed from it, so the fallback's lines still take the web font's height, except in Safari,
   * which ignores those overrides.
   */
  sizeAdjust?: number | undefined
}

/**
 * One `@font-face` rule: a local font, size-adjusted to match the web font.
 */
export type FontFallback = Readonly<{
  /**
   * The rule's `font-family`, such as `Inter fallback Arial`. Unescaped: escape it to render it.
   */
  familyName: string
  /**
   * The local font's family name, such as `Arial`. Unescaped: escape it to render it.
   */
  fallbackFamily: string
  /**
   * The local font's names for `src: local()`. Unescaped: escape them to render them.
   */
  localNames: readonly [string, ...Array<string>]
  /**
   * The `size-adjust` descriptor as a ratio: 1 is 100%.
   */
  sizeAdjust: number
  /**
   * The `ascent-override` descriptor as a ratio: 1 is 100%.
   */
  ascentOverride: number
  /**
   * The `descent-override` descriptor as a ratio: 1 is 100%.
   */
  descentOverride: number
  /**
   * The `line-gap-override` descriptor as a ratio: 1 is 100%.
   */
  lineGapOverride: number
  /**
   * The rule, safe to inline in a `<style>` element. Without `font-weight` and `font-style` from
   * `fontFaceProperties`, the browser synthesises bold and italic from it.
   */
  css: string
}>

export type FontFallbacks = {
  /**
   * Every rule, joined. Safe to inline in a `<style>` element.
   */
  css: string
  /**
   * The web font's name and the fallback family names, as a `font-family` value safe to inline in
   * a `<style>` element. Add a generic family such as `sans-serif` after it.
   */
  fontFamily: string
  /**
   * One rule for each fallback, in order.
   */
  fallbacks: Array<FontFallback>
  /**
   * For a font file whose line box on Windows differs from its `hhea` one by over 1%, the Windows
   * box's height over the `hhea` box's, such as `1.024` for Roboto. The overrides match `hhea`, as
   * Capsize does, so on Windows the fallback's lines are shorter than the web font's when this is
   * over 1. Unset for a family name, as `@capsizecss/metrics` has only the `hhea` metrics
   */
  windowsLineHeightRatio?: number | undefined
}

/**
 * The metrics the overrides are computed from, in font units, as `@capsizecss/metrics` has them
 */
export type FontMetrics = {
  unitsPerEm: number
  /**
   * The average advance width of Latin text, weighted by character frequency. A character without
   * a glyph is measured with `.notdef`, as Capsize does
   */
  xWidthAvg: number
  ascent: number
  /**
   * Below the baseline, so usually negative
   */
  descent: number
  lineGap: number
  /**
   * A font file's `windowsLineHeightRatio` of {@link FontFallbacks}
   */
  windowsLineHeightRatio?: number | undefined
}
