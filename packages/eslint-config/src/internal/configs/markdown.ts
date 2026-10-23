import { CODE_BLOCK_FILES, MARKDOWN_FILES } from '@/internal/files'
import { createMarkdownProcessor } from '@/internal/markdown/processor'
import type { MarkdownParseOptions, MarkdownProcessorOptions } from '@/internal/markdown/processor'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * Each renames a common name to the short one. A block's language decides how it's parsed, so
 * `jsx`, `tsx`, `mjs`, `cjs`, `mts` and `cts` stay, as do `console`, SQL dialects, whose syntax
 * differs, `bash`, which GitHub, VitePress and Docusaurus docs use, and `zsh`
 */
const CANONICAL_CODE_BLOCK_LANGUAGES = {
  javascript: 'js',
  typescript: 'ts',
  shell: 'sh',
  yml: 'yaml',
  python: 'py',
  rust: 'rs',
  golang: 'go',
  cplusplus: 'cpp',
  'c++': 'cpp',
  markdown: 'md',
}

/**
 * A ` ```md ` block, an excerpt, can't pass these
 */
const DOCUMENT_RULES = [
  '@gpahal/markdown/heading-increment',
  '@gpahal/markdown/no-multiple-h1',
  '@gpahal/markdown/no-missing-label-refs',
  'markdown/no-unused-definitions',
  'markdown/no-duplicate-definitions',
  '@gpahal/markdown/no-missing-link-fragments',
  'markdown-preferences/definitions-last',
  'markdown-preferences/sort-definitions',
  'markdown-preferences/prefer-link-reference-definitions',
]

function off(rules: Array<string>): TypedRules {
  return Object.fromEntries(rules.map((name) => [name, 'off']))
}

/**
 * `areas` says which areas that lint some languages' code blocks are on
 */
export async function markdown({
  math,
  areas,
}: {
  math: boolean
  areas: MarkdownProcessorOptions['areas']
}): Promise<Array<TypedConfig>> {
  const [{ default: eslintMarkdown }, { default: eslintMarkdownPreferences }, { MARKDOWN_PLUGIN }] =
    await Promise.all([
      import('@eslint/markdown'),
      import('eslint-plugin-markdown-preferences'),
      import('@/internal/markdown/plugin'),
    ])
  const languageOptions: MarkdownParseOptions = { frontmatter: ['yaml', 'toml'], math }
  return [
    {
      name: 'gpahal/markdown/setup',
      plugins: {
        markdown: eslintMarkdown,
        '@gpahal/markdown': MARKDOWN_PLUGIN,
        'markdown-preferences': eslintMarkdownPreferences,
      },
    },
    {
      name: 'gpahal/markdown/rules',
      files: MARKDOWN_FILES,
      // Not `markdown/gfm`, which crashes ESLint on text such as `<www.example.com>`:
      // https://github.com/eslint/markdown/issues/619
      language: '@gpahal/markdown/gfm',
      languageOptions,
      // A processor isn't given the language options, so it gets them here
      processor: createMarkdownProcessor({ ...languageOptions, areas }),
      rules: {
        'markdown/fenced-code-language': 'error',
        'markdown/no-duplicate-definitions': 'error',
        'markdown/no-duplicate-headings': ['error', { checkSiblingsOnly: true }],
        'markdown/no-empty-definitions': 'error',
        'markdown/no-empty-images': 'error',
        'markdown/no-empty-links': 'error',
        'markdown/no-invalid-label-refs': 'error',
        'markdown/no-reference-like-urls': 'error',
        // Not `markdown/no-reversed-media-syntax`, whose fix in 8.0.3 rewrites a link followed by
        // a footnote, `[docs](https://a.dev)[^1]`, and code such as `f(x)[0]`, and whose regex
        // takes exponential time on nested parentheses
        'markdown/no-space-in-emphasis': ['error', { checkStrikethrough: true }],
        'markdown/no-unused-definitions': 'error',
        'markdown/table-column-count': ['error', { checkMissingCells: true }],
        // Not `markdown-preferences/canonical-code-block-language`, which crashes the run on a
        // language such as ` ```constructor ` in 0.42.0
        '@gpahal/markdown/canonical-code-block-language': [
          'error',
          { languages: CANONICAL_CODE_BLOCK_LANGUAGES },
        ],
        '@gpahal/markdown/directive-placement': 'error',
        '@gpahal/markdown/lowercase-code-block-language': 'error',
        '@gpahal/markdown/heading-increment': 'error',
        '@gpahal/markdown/max-heading-length': ['error', { max: 80 }],
        // Not `markdown/no-bare-urls`, whose fix is broken in 8.0.3:
        // https://github.com/eslint/markdown/issues/710
        '@gpahal/markdown/no-bare-urls': 'error',
        '@gpahal/markdown/no-emphasis-as-heading': 'error',
        '@gpahal/markdown/no-missing-atx-heading-space': 'error',
        '@gpahal/markdown/no-missing-label-refs': 'error',
        '@gpahal/markdown/no-missing-link-fragments': 'error',
        // Not `markdown/no-multiple-h1`, whose regex in 8.0.3 is quadratic on an unclosed `<!--`
        '@gpahal/markdown/no-multiple-h1': 'error',
        '@gpahal/markdown/no-shell-dollars': 'error',
        '@gpahal/markdown/no-shortcut-reference': 'error',
        // Not `markdown-preferences/prefer-autolinks`, whose fix in 0.42.0 turns a link to a
        // relative URL, such as `[LICENSE](LICENSE)`, into an HTML tag, `<LICENSE>`
        '@gpahal/markdown/prefer-autolinks': 'error',
        '@gpahal/markdown/require-alt-text': 'error',
        'markdown-preferences/definitions-last': 'error',
        'markdown-preferences/emoji-notation': ['error', { prefer: 'unicode' }],
        'markdown-preferences/hard-linebreak-style': ['error', { style: 'backslash' }],
        'markdown-preferences/level1-heading-style': ['error', { style: 'atx' }],
        'markdown-preferences/level2-heading-style': ['error', { style: 'atx' }],
        'markdown-preferences/link-bracket-spacing': ['error', { space: 'never' }],
        // Without `!`, so a heading may end in `!` or `?`
        'markdown-preferences/no-heading-trailing-punctuation': [
          'error',
          { punctuation: '.,;:。、，；：｡､' },
        ],
        'markdown-preferences/no-text-backslash-linebreak': 'error',
        'markdown-preferences/ordered-list-marker-sequence': ['error', { increment: 'always' }],
        'markdown-preferences/ordered-list-marker-start': ['error', { start: 1 }],
        'markdown-preferences/prefer-fenced-code-blocks': 'error',
        // Not `prefer-link-reference-definitions`: an inline link used twice reads as well.
        // Footnotes, then links, each sorted, where the default sorts one list by code point
        'markdown-preferences/sort-definitions': [
          'error',
          {
            order: [
              { match: String.raw`/^\[\^/u`, sort: 'alphabetical' },
              { match: String.raw`!/^\[\^/u`, sort: 'alphabetical' },
            ],
          },
        ],
        'markdown-preferences/strikethrough-delimiters-style': ['error', { delimiter: '~~' }],
      },
    },
    {
      name: 'gpahal/markdown/code-blocks',
      files: CODE_BLOCK_FILES,
      languageOptions: { parserOptions: { ecmaFeatures: { impliedStrict: true } } },
    },
  ]
}

/**
 * Without the whole-document rules. A code-block config, after your configs
 */
export function markdownCodeBlockConfigs(): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/markdown/code-block-markdown',
      files: CODE_BLOCK_FILES.map((glob) => `${glob}/*.{md,markdown}`),
      rules: off(DOCUMENT_RULES),
    },
  ]
}
