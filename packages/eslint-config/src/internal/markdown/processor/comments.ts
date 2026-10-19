import { CODE_EXTNS } from '@/internal/files'
import type { FrontmatterKind } from '@/internal/markdown/language'

/**
 * It contains the syntax's `close`, or spans lines, which a line comment can't
 */
export type UnwritableReason = 'containsClose' | 'multiLine'

/**
 * What stands for `<!--` and `-->`, why a directive can't be written so, and whether two
 * `eslint-disable-next-line` directives can share the line before the code
 */
export type CommentSyntax = {
  open: string
  close: string
  getUnwritableReason?: (directive: string) => UnwritableReason | undefined
  isLineShared: boolean
}

/**
 * For JavaScript, TypeScript and JSON, whose `@eslint/json` languages read block directives
 */
export const BLOCK_COMMENT_SYNTAX: CommentSyntax = {
  open: '/*',
  close: '*/',
  getUnwritableReason: (directive) => (directive.includes('*/') ? 'containsClose' : undefined),
  isLineShared: true,
}

const LINE_COMMENT_SYNTAX: CommentSyntax = {
  open: '#',
  close: '',
  getUnwritableReason: (directive) =>
    /[\n\r\u{2028}\u{2029}]/u.test(directive) ? 'multiLine' : undefined,
  isLineShared: false,
}

/**
 * The source HTML comment ends at its first `-->`, so no directive contains one
 */
const HTML_COMMENT_SYNTAX: CommentSyntax = {
  open: '<!--',
  close: '-->',
  isLineShared: true,
}

/**
 * These can start with a shebang
 */
const CODE_EXTENSIONS: ReadonlySet<string> = new Set(CODE_EXTNS)

/**
 * It must stay first, BOM and line break included, so directives go after it
 */
const SHEBANG_REGEX = /^\u{FEFF}?#![^\n\r]*(?:\r\n|[\n\r])?/u

/**
 * By extension. Astro's depends on the block, and other languages take no directives
 */
const COMMENT_SYNTAXES: ReadonlyMap<string, CommentSyntax> = new Map([
  ...[...CODE_EXTENSIONS, 'json', 'jsonc', 'json5'].map(
    (extension) => [extension, BLOCK_COMMENT_SYNTAX] as const,
  ),
  ['yaml', LINE_COMMENT_SYNTAX],
  ['yml', LINE_COMMENT_SYNTAX],
  ['toml', LINE_COMMENT_SYNTAX],
  ['md', HTML_COMMENT_SYNTAX],
  ['markdown', HTML_COMMENT_SYNTAX],
  ['html', HTML_COMMENT_SYNTAX],
])

/**
 * Markdown blocks need no entry, since the processor runs with the `markdown` area, and
 * `javascript` and `typescript` can't be turned off
 */
const EXTENSION_AREAS: ReadonlyMap<string, keyof BlockOptions['areas']> = new Map([
  ['json', 'json'],
  ['jsonc', 'json'],
  ['json5', 'json'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['html', 'html'],
  ['astro', 'astro'],
])

const ASTRO_FRONTMATTER_FENCE_REGEX = /^---[\t ]*(?:\r\n|[\n\r])/u

const FRONTMATTER_FENCES: Readonly<Record<FrontmatterKind, string>> = {
  yaml: '---',
  toml: String.raw`\+\+\+`,
}

/**
 * Up to the line break after its closing fence, or the end of the file
 */
export function getFrontmatterRegex(kinds: Array<FrontmatterKind>): RegExp | undefined {
  return kinds.length === 0
    ? undefined
    : new RegExp(
        String.raw`^(?<fence>${kinds.map((kind) => FRONTMATTER_FENCES[kind]).join('|')})[\t ]*(?:\r\n?|\n)(?:[^\n\r]*(?:\r\n|\r(?!\n)|\n))*?\k<fence>[\t ]*(?:\r\n?|\n|$)`,
        'u',
      )
}

/**
 * After the first `head` characters, or `undefined` for a language with no directives or no area
 * on. JavaScript's go after a shebang and Markdown's after front matter, which must start the file.
 * An Astro component's go in its front matter's script, since astro-eslint-parser reads no
 * directives in a template's HTML comments
 */
export function getCommentPlacement(
  filename: string,
  code: string,
  { areas, frontmatterRegex }: Pick<BlockOptions, 'areas' | 'frontmatterRegex'>,
): { syntax: CommentSyntax; head: number } | undefined {
  // Not lowercased: configs match a `filename` meta's extension as is
  const extension = filename.slice(filename.lastIndexOf('.') + 1)
  const area = EXTENSION_AREAS.get(extension)
  if (area !== undefined && !areas[area]) {
    return undefined
  }
  if (extension === 'md' || extension === 'markdown') {
    return { syntax: HTML_COMMENT_SYNTAX, head: frontmatterRegex?.exec(code)?.[0].length ?? 0 }
  }
  if (extension === 'astro') {
    const fence = ASTRO_FRONTMATTER_FENCE_REGEX.exec(code)
    return fence ? { syntax: BLOCK_COMMENT_SYNTAX, head: fence[0].length } : undefined
  }
  const syntax = COMMENT_SYNTAXES.get(extension)
  const head = CODE_EXTENSIONS.has(extension) ? (SHEBANG_REGEX.exec(code)?.[0].length ?? 0) : 0
  return syntax && { syntax, head }
}

export type BlockOptions = {
  areas: { astro: boolean; html: boolean; json: boolean; yaml: boolean; toml: boolean }
  frontmatterRegex: RegExp | undefined
}
