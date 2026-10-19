import type { Declaration, Root } from 'postcss'

/**
 * Whether `root` is a `style` attribute's, which postcss-html marks as inline. Prettier wraps a long
 * attribute onto lines, and an empty line written into it there isn't wanted
 */
export function isInlineStyle(root: Root): boolean {
  const source: unknown = root.source
  return typeof source === 'object' && source !== null && Reflect.get(source, 'inline') === true
}

/**
 * Give the declaration `node` one empty line before it when `isExpected`, as Stylelint's
 * `*-empty-line-before` fixes do, or else take out the empty lines before it, leaving one line
 * break
 */
export function setEmptyLineBefore(node: Declaration, isExpected: boolean, newline: string): void {
  const before = node.raws.before ?? ''
  if (!isExpected) {
    node.raws.before = before.replaceAll(/(?:\r?\n\s*\n)+/g, () => newline)
  } else if (/\r?\n/.test(before)) {
    node.raws.before = before.replace(/\r?\n/, (lineBreak: string) => `${newline}${lineBreak}`)
  } else {
    node.raws.before = newline.repeat(2) + before
  }
}
