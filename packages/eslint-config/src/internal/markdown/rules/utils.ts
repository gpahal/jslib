import type { MarkdownRuleDefinition, MarkdownSourceCode } from '@eslint/markdown'
import eslintMarkdownPreferences from 'eslint-plugin-markdown-preferences'
import type { Nodes } from 'mdast'
import type { Position } from 'unist'

import { formatNames } from '@gpahal/std/errors'

import { MARKDOWN_LINE_BREAK_REGEX } from '@/internal/markdown/line-breaks'
import { formatErrorMessage, getDocsUrl } from '@/internal/utils'

/**
 * `@eslint/markdown`'s default `frontmatterTitle`, but not a quoted string such as `'title:'`.
 * Tested against a line without indentation, so no leading `\s*`, which backtracked quadratically
 * against the `\s*` after `{` on a line of spaces
 */
const FRONTMATTER_TITLE = String.raw`^(?!['"]title[:=]['"])(?:\{\s*)?['"]?title['"]?\s*[:=]`

type FrontmatterTitleOptions = [{ frontmatterTitle?: string }]

export const FRONTMATTER_TITLE_META: Required<
  Pick<
    NonNullable<MarkdownRuleDefinition<{ RuleOptions: FrontmatterTitleOptions }>['meta']>,
    'schema' | 'defaultOptions'
  >
> = {
  schema: [
    {
      type: 'object',
      properties: { frontmatterTitle: { type: 'string' } },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{ frontmatterTitle: FRONTMATTER_TITLE }],
}

/**
 * `undefined` when empty, which turns the check of front matter off
 */
export function getFrontmatterTitleRegex([
  { frontmatterTitle = FRONTMATTER_TITLE },
]: FrontmatterTitleOptions): RegExp | undefined {
  return frontmatterTitle === '' ? undefined : new RegExp(frontmatterTitle, 'iu')
}

const TOML_TABLE_REGEX = /^\s*\[/u

/**
 * 1-based, as mdast positions have them
 */
export type Loc = Pick<Position, 'start' | 'end'>

/**
 * The README's table of the `@gpahal/markdown/*` rules
 */
export const RULE_DOCS_URL: string = getDocsUrl('markdown-rules')

export function getRange(node: { position?: Position | undefined }): [number, number] | undefined {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? undefined : [start, end]
}

export function getLoc(sourceCode: MarkdownSourceCode, start: number, end: number): Loc {
  return { start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(end) }
}

type TomlState = { multiline: string | undefined; arrayDepth: number }

/**
 * Tracks open strings and arrays, skipping quoted escapes and comments
 */
function scanTomlLine(line: string, state: TomlState): void {
  let quote: string | undefined
  for (let index = 0; index < line.length; index++) {
    const char = line.charAt(index)
    if (char === '\\' && (quote === '"' || state.multiline === '"')) {
      index++
    } else if (state.multiline !== undefined) {
      if (line.startsWith(state.multiline.repeat(3), index)) {
        while (line[index + 1] === state.multiline) {
          index++
        }
        state.multiline = undefined
      }
    } else if (quote !== undefined) {
      if (char === quote) {
        quote = undefined
      }
    } else {
      switch (char) {
        case '#': {
          return
        }
        case '"':
        case "'": {
          if (line.startsWith(char.repeat(3), index)) {
            state.multiline = char
            index += 2
          } else {
            quote = char
          }
          continue
        }
        case '[': {
          state.arrayDepth++
          continue
        }
        case ']': {
          state.arrayDepth--
          continue
        }
        default: {
          continue
        }
      }
    }
  }
}

/**
 * Without string and array continuations and everything after the first table
 */
function getTomlTopLevelLines(lines: Array<string>): Array<string> {
  const topLevel: Array<string> = []
  const state: TomlState = { multiline: undefined, arrayDepth: 0 }
  for (const line of lines) {
    if (state.multiline === undefined && state.arrayDepth === 0) {
      if (TOML_TABLE_REGEX.test(line)) {
        break
      }
      topLevel.push(line.trim())
    }
    scanTomlLine(line, state)
  }
  return topLevel
}

/**
 * Without indentation. In YAML, the lines indented no more than the first non-blank, non-comment
 * line; in TOML, the lines before the first table
 */
function getTopLevelLines(type: 'yaml' | 'toml', value: string): Array<string> {
  const lines = value.split(MARKDOWN_LINE_BREAK_REGEX)
  if (type === 'toml') {
    return getTomlTopLevelLines(lines)
  }
  let rootIndent: number | undefined
  const topLevel: Array<string> = []
  for (const line of lines) {
    const text = line.trimStart()
    if (text === '' || text.startsWith('#')) {
      continue
    }
    const indent = line.length - text.length
    rootIndent ??= indent
    if (indent <= rootIndent) {
      topLevel.push(text)
    }
  }
  return topLevel
}

export function isFrontmatterWithTitle(node: Nodes, titleRegex: RegExp): boolean {
  const type = node.type as string
  return (
    (type === 'yaml' || type === 'toml') &&
    'value' in node &&
    getTopLevelLines(type, node.value).some((line) => titleRegex.test(line))
  )
}

/**
 * Throws when the plugin has no such rule, as after a rename
 */
export function getMarkdownPreferencesRule(
  name: string,
): (typeof eslintMarkdownPreferences.rules)[string] {
  const rule = eslintMarkdownPreferences.rules[name]
  if (!rule) {
    throw new Error(
      formatErrorMessage(
        [formatNames([name])],
        "isn't a rule that eslint-plugin-markdown-preferences has",
      ),
    )
  }
  return rule
}
