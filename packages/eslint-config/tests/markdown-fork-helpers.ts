import markdown from '@eslint/markdown'
import { Linter } from 'eslint'

import { MARKDOWN_PLUGIN } from '@/internal/markdown/plugin'

const linter = new Linter({ configType: 'flat' })

/**
 * The problems of `markdown/<rule>`, or of `@gpahal/markdown/<rule>` with `isFork`, on `code`, as
 * `line:column`. The stock rule runs on the stock language with `languageOptions`
 */
export function problemsOf(
  rule: string,
  code: string,
  {
    isFork = false,
    languageOptions = {},
  }: { isFork?: boolean; languageOptions?: Linter.LanguageOptions | undefined } = {},
): Array<string> {
  const config: Linter.Config = isFork
    ? {
        files: ['**/*.md'],
        plugins: { '@gpahal/markdown': MARKDOWN_PLUGIN },
        language: '@gpahal/markdown/gfm',
        rules: { [`@gpahal/markdown/${rule}`]: 'error' },
      }
    : {
        files: ['**/*.md'],
        plugins: { markdown },
        language: 'markdown/gfm',
        languageOptions,
        rules: { [`markdown/${rule}`]: 'error' },
      }
  return linter
    .verify(code, config, 'doc.md')
    .map((message) => `${String(message.line)}:${String(message.column)}`)
}

/**
 * Makes each timed text unique, so no run reads a cached parse
 */
const runs = { count: 0 }

/**
 * These rules are quadratic through regexes that backtrack inside one call, which no call count
 * sees, so their tests take CPU time
 */
export function lintRun(
  rule: string,
  code: string,
  isFork = false,
  languageOptions: Linter.LanguageOptions = {},
): () => void {
  return () => {
    runs.count++
    problemsOf(rule, `${code}${String(runs.count)}\n`, { isFork, languageOptions })
  }
}
