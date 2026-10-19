import type { AstPath, Parser, Printer } from 'prettier'
import { builders } from 'prettier/doc'
import { parsers as markdownParsers, printers as markdownPrinters } from 'prettier/plugins/markdown'

// A Prettier plugin module, passed by path, that keeps the line break after a GitHub alert marker
// such as `> [!NOTE]`, which Prettier otherwise joins with the next line under `proseWrap: 'never'`
// or `'always'`. It replaces the `markdown` parser's printer, so it can clash with other Markdown
// plugins

const AST_FORMAT = 'mdast-github-alerts'

const ALERT_TYPES = '(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)'
const ALERT_MARKER_WORD_REGEX = new RegExp(String.raw`^\[!${ALERT_TYPES}\]$`, 'i')

type MarkdownNode = {
  type: string
  value?: string
  children?: Array<MarkdownNode>
}

/**
 * The markdown parser reads the marker as text, so it's the first word of the sentence the line
 * break is in
 */
function isAfterAlertMarker(sentence: MarkdownNode, paragraph: MarkdownNode, node: MarkdownNode) {
  if (paragraph.children?.[0] !== sentence) {
    return false
  }
  const [marker, next] = sentence.children ?? []
  return (
    next === node &&
    marker?.type === 'word' &&
    marker.value !== undefined &&
    ALERT_MARKER_WORD_REGEX.test(marker.value)
  )
}

/**
 * A line break right after the marker, in the first paragraph of a blockquote
 */
function isLineBreakAfterAlertMarker(path: AstPath<MarkdownNode>): boolean {
  const { node } = path
  if (node.type !== 'whitespace' || node.value !== '\n') {
    return false
  }

  const sentence = path.parent
  const paragraph = path.grandparent
  const blockquote = path.getNode(3)
  return (
    sentence?.type === 'sentence' &&
    paragraph?.type === 'paragraph' &&
    blockquote?.type === 'blockquote' &&
    blockquote.children?.[0] === paragraph &&
    isAfterAlertMarker(sentence, paragraph, node)
  )
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prettier types the printer's nodes as `any`
const markdownPrinter = markdownPrinters.mdast as Printer<MarkdownNode>

export const printers: Record<string, Printer<MarkdownNode>> = {
  [AST_FORMAT]: {
    ...markdownPrinter,
    print(path, options, print, args) {
      return isLineBreakAfterAlertMarker(path)
        ? builders.hardline
        : markdownPrinter.print(path, options, print, args)
    },
  },
}

/**
 * Not the `mdx` parser: MDX isn't supported
 */
export const parsers: Record<string, Parser<MarkdownNode>> = Object.fromEntries(
  Object.entries(markdownParsers)
    .filter(([name]) => name !== 'mdx')
    .map(([name, parser]) => [
      name,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prettier types the parsers' nodes as `any`
      { ...(parser as Parser<MarkdownNode>), astFormat: AST_FORMAT },
    ]),
)
