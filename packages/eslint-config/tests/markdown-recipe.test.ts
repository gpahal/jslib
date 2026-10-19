import path from 'node:path'

import type { ESLint } from 'eslint'
import * as prettier from 'prettier'

import { defineConfig as definePrettierConfig } from '@gpahal/prettier-config'

import { REPORT_ONLY_RULES } from '@/internal/fix-policy'

import { createESLint } from './helpers'

// One run each of `eslint --fix` and Prettier settles Markdown that breaks every fixable Markdown
// rule. The report-only rules' fixes are on, except `definitions-last`'s, which breaks adjacent
// definitions

const prettierConfig = definePrettierConfig({ root: path.resolve(import.meta.dirname, '..') })

const FIXTURES: Record<string, string> = {
  'every-rule.md': [
    'Title',
    '=====',
    '',
    'Section',
    '-------',
    '',
    "##What's new",
    '',
    'Some ** bold ** text, ~struck~ and :rocket:.',
    '',
    'See [the docs](https://example.com/docs), [ spaced ](https://example.com/spaced) and [Mercury](mercury).',
    '',
    'A [shortcut] and ![an image].',
    '',
    '    indented code',
    '',
    '0. Zero',
    '1. One',
    '1. Two',
    '',
    '```javascript',
    'console.warn(1)',
    '```',
    '',
    '[shortcut]: https://example.com/shortcut',
    '',
    'Text after a definition.',
    '',
    '[mercury]: https://example.com/mercury',
    '',
    '[an image]: https://example.com/image.png',
    '',
  ].join('\n'),
  'links.md': [
    '# Links',
    '',
    'See [the docs](https://example.com/docs) and [them again](https://example.com/docs).',
    '',
    // Reported by `@gpahal/markdown/prefer-autolinks` and `@gpahal/markdown/no-bare-urls`
    'Visit https://example.com today.',
    '',
    'See [LICENSE](LICENSE).',
    '',
    'A line  ',
    'break.[^1]',
    '',
    '[zeta]: https://example.com/zeta',
    '',
    '[^1]: A note.',
    '',
  ].join('\n'),
}

const SETTLED: Record<string, string> = {
  'every-rule.md': [
    '# Title',
    '',
    '## Section',
    '',
    "## What's new",
    '',
    'Some **bold** text, ~~struck~~ and 🚀.',
    '',
    'See [the docs](https://example.com/docs), [spaced](https://example.com/spaced) and [Mercury][mercury].',
    '',
    'A [shortcut][] and ![an image][].',
    '',
    '```',
    'indented code',
    '```',
    '',
    '1. Zero',
    '2. One',
    '3. Two',
    '',
    '```js',
    'console.warn(1)',
    '```',
    '',
    '[shortcut]: https://example.com/shortcut',
    '',
    'Text after a definition.',
    '',
    '[an image]: https://example.com/image.png',
    '[mercury]: https://example.com/mercury',
    '',
  ].join('\n'),
  'links.md': [
    '# Links',
    '',
    'See [the docs](https://example.com/docs) and [them again](https://example.com/docs).',
    '',
    'Visit <https://example.com> today.',
    '',
    'See [LICENSE](LICENSE).',
    '',
    'A line\\',
    'break.[^1]',
    '',
    '[^1]: A note.',
    '',
    '[zeta]: https://example.com/zeta',
    '',
  ].join('\n'),
}

describe('eslint --fix, then Prettier', () => {
  let eslint: ESLint
  beforeAll(async () => {
    const fixes = Object.fromEntries(
      REPORT_ONLY_RULES.filter((rule) => rule !== 'markdown-preferences/definitions-last').map(
        (rule) => [rule, false],
      ),
    )
    eslint = await createESLint(
      'markdown',
      { configs: [{ settings: { '@gpahal/report-only': fixes } }] },
      { fix: true },
    )
  })

  it.each(Object.keys(FIXTURES))('settle %s in one run', async (fileName) => {
    const fix = async (code: string) => {
      const [result] = await eslint.lintText(code, { filePath: fileName })
      return result?.output ?? code
    }
    const format = async (code: string) =>
      prettier.format(code, { ...prettierConfig, filepath: fileName })

    const once = await format(await fix(FIXTURES[fileName] ?? ''))
    const twice = await format(await fix(once))
    expect(once).toBe(SETTLED[fileName])
    expect(twice).toBe(once)

    const [result] = await eslint.lintText(once, { filePath: fileName })
    expect(result?.messages.filter((message) => message.fix !== undefined)).toEqual([])
  })
})
