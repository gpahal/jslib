import type { Linter } from 'eslint'

import { parseMarkdown, parseUncached } from '@/internal/markdown/language'
import type { FrontmatterKind } from '@/internal/markdown/language'
import { BOM, getBlocks, toCommentKey } from '@/internal/markdown/processor/blocks'
import type { FileState } from '@/internal/markdown/processor/blocks'
import { getFrontmatterRegex } from '@/internal/markdown/processor/comments'
import type { BlockOptions } from '@/internal/markdown/processor/comments'
import {
  adjustFileMessages,
  fixDirectiveRemovals,
  isDirectiveMessage,
} from '@/internal/markdown/processor/directives'
import { adjustMessage } from '@/internal/markdown/processor/mapping'
import { PACKAGE_META } from '@/internal/package-meta'

/**
 * A block's text ends where its fence starts, and starts in the middle of the Markdown file
 */
const UNSATISFIABLE_RULES: ReadonlySet<string> = new Set(['eol-last', 'unicode-bom'])

/**
 * Without the messages of rules a block can't pass and errors the file's own lint reports. The
 * messages about directives in the comments before the blocks go in `blockUnused`, by
 * `toCommentKey`, to match against the file's lint's
 */
function adjustBlockMessages(
  state: FileState,
  own: Array<Linter.LintMessage>,
  blockMessages: Array<Array<Linter.LintMessage>>,
): {
  messages: Array<Linter.LintMessage>
  blockUnused: Map<string, Array<Linter.LintMessage>>
} {
  const { blocks, comments } = state
  const blockUnused = new Map<string, Array<Linter.LintMessage>>()
  // Rule-less file messages, such as an inline config's invalid JSON, which a block's lint repeats
  const fileErrors = new Set(
    own
      .filter((message) => message.ruleId === null)
      .map((message) => `${String(message.line)}:${message.message}`),
  )
  const messages = blockMessages.flatMap((messagesOfBlock, index) => {
    const block = blocks[index]
    if (block === undefined) {
      return []
    }
    return messagesOfBlock.flatMap((message) => {
      if (message.ruleId !== null && UNSATISFIABLE_RULES.has(message.ruleId)) {
        return []
      }
      const adjusted = adjustMessage(state, block, message)
      if (adjusted === undefined) {
        return []
      }
      if (
        adjusted.fatal === true &&
        adjusted.ruleId === null &&
        fileErrors.has(`${String(adjusted.line)}:${adjusted.message}`)
      ) {
        return []
      }
      const key = toCommentKey(adjusted)
      if (isDirectiveMessage(adjusted) && comments.has(key)) {
        blockUnused.set(key, [...(blockUnused.get(key) ?? []), adjusted])
        return []
      }
      return [adjusted]
    })
  })
  return { messages, blockUnused }
}

/**
 * Shared by every processor, so `@gpahal/markdown/directive-placement`, which runs in the file's
 * lint between `preprocess` and `postprocess`, can read it
 */
const states = new Map<string, FileState>()

export function getProcessorState(filename: string, text: string): FileState | undefined {
  const state = states.get(filename)
  return state?.text === text ? state : undefined
}

/**
 * The processor parses as the language does, so its code blocks are the nodes the rules see
 */
export type MarkdownParseOptions = {
  frontmatter: Array<FrontmatterKind>
  math: boolean
}

/**
 * ESLint doesn't lint a block without a config, so a directive before it can't apply
 */
export type MarkdownProcessorOptions = MarkdownParseOptions & {
  areas: BlockOptions['areas']
}

/**
 * Lints a Markdown file, then its code blocks as virtual files such as `README.md/1_0.tsx` (or
 * `README.md/1_tool.config.js` for `filename="tool.config.js"`), ` ```md ` blocks up to
 * `MAX_MARKDOWN_BLOCK_DEPTH` deep. The file is parsed once, with the language's options, so a fence
 * in front matter or math is never a block.
 *
 * A directive before a block is also written into it, so each lint would report the other's rules
 * as unused, which `--fix` would delete. It's reported only for what both find unused, once, on the
 * HTML comment and without a fix
 */
export function createMarkdownProcessor(options: MarkdownProcessorOptions): Linter.Processor {
  const blockOptions: BlockOptions = {
    areas: options.areas,
    frontmatterRegex: getFrontmatterRegex(options.frontmatter),
  }
  return {
    meta: { name: `${PACKAGE_META.name}/markdown`, version: PACKAGE_META.version },
    supportsAutofix: true,
    preprocess: (text, filename) => {
      // A lint that threw before `postprocess` leaves its state, which a later unparseable lint
      // would read
      states.delete(filename)
      // Fix ranges are offsets of the text without its BOM, as ESLint applies them
      const source = text.startsWith(BOM) ? text.slice(BOM.length) : text
      const result = parseMarkdown(source, options.frontmatter, options.math)
      if (!result.ok) {
        return [text]
      }
      // A ` ```md ` block's state is its parent file's, kept while the parent's blocks are linted
      const parent = states.get(
        filename.slice(0, Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))),
      )
      const state = getBlocks(
        source,
        result.root,
        parent === undefined ? 0 : parent.depth + 1,
        blockOptions,
      )
      states.set(filename, state)
      return [
        text,
        ...state.blocks.map((block) => ({ filename: block.filename, text: block.text })),
      ]
    },
    postprocess: ([own = [], ...blockMessages], filename) => {
      const state = states.get(filename)
      states.delete(filename)
      if (state === undefined) {
        return own
      }
      const { messages: fromBlocks, blockUnused } = adjustBlockMessages(state, own, blockMessages)
      // In the file's order, as ESLint sorts messages without a processor
      return [
        ...fixDirectiveRemovals(
          adjustFileMessages(own, state.comments, blockUnused, state.placements),
          state,
          (text, isFileStart) => {
            const kinds = isFileStart ? options.frontmatter : []
            const result = parseUncached(text, kinds, options.math)
            return result.ok ? result.root : undefined
          },
        ),
        ...fromBlocks,
      ].toSorted((a, b) => (a.line === b.line ? a.column - b.column : a.line - b.line))
    },
  }
}
