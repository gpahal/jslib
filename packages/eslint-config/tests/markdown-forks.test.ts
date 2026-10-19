import markdown from '@eslint/markdown'
import { Linter } from 'eslint'

import { minCpuMs } from '@gpahal/internal/node/testing'

import { MARKDOWN_PLUGIN } from '@/internal/markdown/plugin'

// Each `@gpahal/markdown` rule forked from `@eslint/markdown` exists for the cases where the stock
// rule differs. These tests run the stock rule on those cases and fail once it no longer differs,
// so the fork may be removable

const linter = new Linter({ configType: 'flat' })

/**
 * The problems of `markdown/<rule>`, or of `@gpahal/markdown/<rule>` with `isFork`, on `code`, as
 * `line:column`. The stock rule runs on the stock language with `languageOptions`
 */
function problemsOf(
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

type Case = {
  name: string
  code: string
  stock: Array<string>
  fork: Array<string>
  languageOptions?: Linter.LanguageOptions
}

const CASES: Record<string, Array<Case>> = {
  'heading-increment': [
    {
      name: 'a title nested in YAML front matter',
      code: '---\nparams:\n  title: A\n---\n\n### B\n',
      languageOptions: { frontmatter: 'yaml' },
      stock: ['6:1'],
      fork: [],
    },
    {
      name: 'an HTML heading',
      code: '<h1>A</h1>\n\n### B\n',
      stock: [],
      fork: ['3:1'],
    },
  ],
  'no-multiple-h1': [
    {
      // A deliberate difference: `heading-increment` counts the same top-level titles
      name: 'a title nested in YAML front matter',
      code: '---\nmeta:\n  title: Nested\n---\n\n# Doc\n',
      languageOptions: { frontmatter: 'yaml' },
      stock: ['6:1'],
      fork: [],
    },
  ],
  'no-missing-label-refs': [
    {
      name: 'brackets in an autolink',
      code: '# T\n\n<https://x.y/[a]>\n',
      stock: ['3:15'],
      fork: [],
    },
  ],
  'no-missing-link-fragments': [
    {
      name: 'a link to a footnote',
      code: '# T\n\n[a](#fn-1)\n\nB[^1].\n\n[^1]: Note\n',
      stock: ['3:1'],
      fork: [],
    },
  ],
  'require-alt-text': [
    {
      name: 'an `<img>` in a `<textarea>`',
      code: '# T\n\n<textarea><img src="a"></textarea>\n',
      stock: ['3:11'],
      fork: [],
    },
  ],
  'no-missing-atx-heading-space': [
    { name: 'a tag', code: '# T\n\n#general\n', stock: ['3:1'], fork: [] },
  ],
}

/**
 * Makes each timed text unique, so no run reads a cached parse
 */
const runs = { count: 0 }

/**
 * These rules are quadratic through regexes that backtrack inside one call, which no call count
 * sees, so their tests take CPU time
 */
function lintRun(
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

const frontmatter = (spaces: number): string => `---\n${' '.repeat(spaces)}\n---\n\n# A\n`

describe('the fork of `no-multiple-h1`', () => {
  it('scales linearly on an unclosed `<!--`', () => {
    // Against a rule that only reads code blocks, so the time to parse the file, which most of the
    // lint takes, is in both. The stock rule takes over 20 times as long as that on 40,000 lines
    const code = `# A\n\n${'<!--\n'.repeat(40_000)}`
    const [forkMs = 0, baseMs = 0] = minCpuMs([
      lintRun('no-multiple-h1', code, true),
      lintRun('lowercase-code-block-language', code, true),
    ])
    expect(forkMs).toBeLessThan(4 * baseMs + 200)
  })

  it('differs from the stock rule, which is quadratic on a front matter line of spaces, or `FRONTMATTER_TITLE` may be removable', () => {
    // Once this fails, `FRONTMATTER_TITLE` in src/internal/markdown/rules/utils.ts may go back to
    // the stock default. 4 times the spaces take 16 times as long in quadratic code; the fixed
    // cost of a lint lowers the ratio, measured at about 12
    const yaml: Linter.LanguageOptions = { frontmatter: 'yaml' }
    const [shortMs = 0, longMs = 0] = minCpuMs([
      lintRun('no-multiple-h1', frontmatter(3000), false, yaml),
      lintRun('no-multiple-h1', frontmatter(12_000), false, yaml),
    ])
    expect(longMs / shortMs).toBeGreaterThan(7)
  })
})

describe.each(Object.entries(CASES))('the fork of `%s`', (rule, cases) => {
  it.each(cases)(
    'differs from the stock rule on $name, or the fork may be removable',
    ({ code, stock, fork, languageOptions }) => {
      expect(problemsOf(rule, code, { isFork: true })).toEqual(fork)
      expect(problemsOf(rule, code, { languageOptions })).toEqual(stock)
    },
  )
})
