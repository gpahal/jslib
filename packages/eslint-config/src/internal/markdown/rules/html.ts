import { createRequire } from 'node:module'

import type { MarkdownSourceCode } from '@eslint/markdown'
import type { Element, Nodes, Root } from 'hast'
import type * as HastUtilFromHtml from 'hast-util-from-html'
import type { Html } from 'mdast'

import { getRange } from '@/internal/markdown/rules/utils'

const PROPERTY_NAMES = {
  alt: 'alt',
  id: 'id',
  name: 'name',
  'aria-hidden': 'ariaHidden',
  role: 'role',
} as const

export type HtmlAttributeName = keyof typeof PROPERTY_NAMES

const HEADING_TAG_NAME_REGEX = /^h([1-6])$/u

const loaded: { htmlParser?: typeof HastUtilFromHtml } = {}

/**
 * Loaded on first parse, since it and parse5 take about 20 ms to load. Rules run synchronously, so
 * this ES module loads with `require`
 */
function loadHtmlParser(): typeof HastUtilFromHtml {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `require` returns `any`, and this is the `hast-util-from-html` module
  loaded.htmlParser ??= createRequire(import.meta.url)(
    'hast-util-from-html',
  ) as typeof HastUtilFromHtml
  return loaded.htmlParser
}

/**
 * As a browser parses a fragment. `undefined` when the parse fails, as with a `RangeError` for
 * elements nested thousands deep, so the rules skip the node rather than crash
 */
function parseHtml(html: string): Root | undefined {
  const { fromHtml } = loadHtmlParser()
  try {
    return fromHtml(html, { fragment: true })
  } catch {
    // Any parse error, not only a `RangeError`: the HTML checks don't run on unparseable HTML
    return undefined
  }
}

type ParsedHtmlNode = {
  tree: Root
  start: number
}

function getBlockquoteDepth(node: Html, sourceCode: MarkdownSourceCode): number {
  let depth = 0
  for (let parent = sourceCode.getParent(node); parent; parent = sourceCode.getParent(parent)) {
    if (parent.type === 'blockquote') {
      depth++
    }
  }
  return depth
}

/**
 * Replaced by spaces, so the HTML parses at the same offsets
 */
function withoutBlockquoteMarkers(source: string, depth: number): string {
  if (depth === 0) {
    return source
  }
  // After each line ending, `\n`, `\r\n` or a lone `\r`
  const markers = new RegExp(String.raw`(?<=[\n\r])(?:[\t ]*>){1,${depth}}`, 'g')
  return source.replaceAll(markers, (prefix) => prefix.replaceAll('>', ' '))
}

/**
 * `null` for a failed parse. Shared by the rules that read a node
 */
const PARSED_HTML_NODES = new WeakMap<Html, ParsedHtmlNode | null>()

/**
 * The source rather than the value, whose offsets differ in a blockquote
 */
export function parseHtmlNode(
  node: Html,
  sourceCode: MarkdownSourceCode,
): ParsedHtmlNode | undefined {
  const cached = PARSED_HTML_NODES.get(node)
  if (cached !== undefined) {
    return cached ?? undefined
  }
  const range = getRange(node)
  if (!range) {
    return undefined
  }
  const source = withoutBlockquoteMarkers(
    sourceCode.text.slice(range[0], range[1]),
    getBlockquoteDepth(node, sourceCode),
  )
  const tree = parseHtml(source)
  const parsed = tree === undefined ? null : { tree, start: range[0] }
  PARSED_HTML_NODES.set(node, parsed)
  return parsed ?? undefined
}

/**
 * A loop, so deep nesting can't overflow the stack
 */
export function* getElements(tree: Root | Element): Generator<Element> {
  const stack: Array<Element> = []
  pushChildElements(stack, tree)
  for (let element = stack.pop(); element !== undefined; element = stack.pop()) {
    yield element
    pushChildElements(stack, element)
  }
}

/**
 * Last first, one at a time, since spreading thousands of children overflows the stack
 */
function pushChildElements(stack: Array<Element>, node: Root | Element): void {
  for (let index = node.children.length - 1; index >= 0; index--) {
    const child = node.children[index]
    if (child?.type === 'element') {
      stack.push(child)
    }
  }
}

/**
 * `''` for a bare attribute, `undefined` when missing
 */
export function getHtmlAttribute(element: Element, name: HtmlAttributeName): string | undefined {
  // hast types these as strings, but a boolean attribute can be `true` or `false`
  const value: unknown = element.properties[PROPERTY_NAMES[name]]
  if (typeof value === 'string') {
    return value
  }
  return value === true ? '' : undefined
}

export function getHtmlHeadingRank(element: Element): number | undefined {
  const match = HEADING_TAG_NAME_REGEX.exec(element.tagName)
  return match ? Number(match[1]) : undefined
}

/**
 * Without comments. A loop, so deep nesting can't overflow the stack
 */
export function getHtmlText(node: Nodes): string {
  let text = ''
  const stack: Array<Nodes> = [node]
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (current.type === 'text') {
      text += current.value
    } else if ('children' in current) {
      for (let index = current.children.length - 1; index >= 0; index--) {
        const child = current.children[index]
        if (child !== undefined) {
          stack.push(child)
        }
      }
    }
  }
  return text
}
