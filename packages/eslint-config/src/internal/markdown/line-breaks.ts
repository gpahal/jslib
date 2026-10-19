/**
 * A line break in Markdown, which mdast's positions count lines by
 */
export const MARKDOWN_LINE_BREAK_REGEX: RegExp = /\r\n|[\n\r]/u

/**
 * `MARKDOWN_LINE_BREAK_REGEX` with the `g` flag, for `matchAll` and `replaceAll` only. `matchAll`
 * starts from the regex's `lastIndex`, so code that sets it or calls `exec` needs its own regex
 */
export const MARKDOWN_LINE_BREAK_GLOBAL_REGEX: RegExp = new RegExp(
  MARKDOWN_LINE_BREAK_REGEX.source,
  'gu',
)
