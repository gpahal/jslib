import type { ESLint, Rule } from 'eslint'

import { withReport } from '@/internal/utils'

type Position = { line: number; column: number }

/**
 * A lone `\r`, or a JavaScript line or paragraph separator
 */
const OTHER_LINE_BREAK = /\r(?!\n)|[\u{2028}\u{2029}]/u

export function lfLineStarts(text: string): Array<number> {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}

/**
 * Shifts JavaScript's 0-based columns to the language's, since Markdown's and JSON's start at 1 and
 * a disable comment would miss the report otherwise. `keepsEnd` converts only the start. `lfLines`
 * remaps positions for a rule that counts only `\n` as a line break
 */
function withLanguageColumns(
  rule: Rule.RuleModule,
  { keepsEnd, lfLines }: { keepsEnd: boolean; lfLines: boolean },
): Rule.RuleModule {
  return {
    ...rule,
    create(context) {
      const { sourceCode } = context
      const columnStart = sourceCode.getLocFromIndex(0).column
      // Shifting columns is enough while the lines agree, which saves converting each position
      let lineStarts: Array<number> | undefined
      const toLanguageLoc = ({ line, column }: Position): Position => {
        // A negative column, which places a problem before its line, where no directive can hide
        // it, as eslint-comments does, stays before it
        if (!lfLines || column < 0) {
          return { line, column: column + columnStart }
        }
        lineStarts ??= OTHER_LINE_BREAK.test(sourceCode.text) ? lfLineStarts(sourceCode.text) : []
        const lineStart = lineStarts[line - 1]
        return lineStart === undefined
          ? { line, column: column + columnStart }
          : sourceCode.getLocFromIndex(lineStart + column)
      }
      return rule.create(
        withReport(context, (descriptor) => {
          const loc = 'loc' in descriptor ? descriptor.loc : undefined
          context.report(
            loc && 'start' in loc
              ? {
                  ...descriptor,
                  loc: {
                    start: toLanguageLoc(loc.start),
                    end: keepsEnd ? loc.end : toLanguageLoc(loc.end),
                  },
                }
              : descriptor,
          )
        }),
      )
    },
  }
}

export function withLanguageColumnsRule(
  plugin: ESLint.Plugin,
  name: string,
  { keepsEnd = false, lfLines = false }: { keepsEnd?: boolean; lfLines?: boolean } = {},
): ESLint.Plugin {
  const rule = plugin.rules?.[name]
  return rule && 'create' in rule
    ? {
        ...plugin,
        rules: { ...plugin.rules, [name]: withLanguageColumns(rule, { keepsEnd, lfLines }) },
      }
    : plugin
}
