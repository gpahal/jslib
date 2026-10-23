import markdown from '@eslint/markdown'
import { Linter } from 'eslint'
import type { ESLint, Rule } from 'eslint'

import { withLanguageColumnsRule } from '@/internal/language-columns'

import { createESLint, lint, lintText, ruleSeverity, sharedESLint, withProject } from './helpers'

test('a disable comment before adjacent definitions turns definition placement off', async () => {
  const eslint = await sharedESLint('markdown')
  const code = '# T\n\n[a][a] and [b][b]\n\n[a]: /a\n[b]: /b\n\nMore\n'
  const disabled = code.replace(
    '[a]: /a',
    '<!-- eslint-disable markdown-preferences/definitions-last -- keep these together -->\n\n[a]: /a',
  )
  expect(await lintText(eslint, 'docs.md', disabled)).toEqual([])
})

describe('markdown code blocks', () => {
  it('lint with the react preset without type information', async () => {
    const eslint = await createESLint('markdown', { react: true })
    expect(await lint(eslint, ['README.md'])).toEqual({ 'README.md': [] })
  })
})

describe('markdown code blocks with base alone', () => {
  it('parse JSON as JSONC', async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = [
      '# Config',
      '',
      '```json',
      '{',
      '  // A comment',
      '  "a": 1,',
      '  "a": 2',
      '}',
      '```',
      '',
    ].join('\n')
    expect(await lintText(eslint, 'docs.md', markdown)).toEqual([
      expect.stringMatching(/^json\/no-duplicate-keys: /),
    ])
  })

  it('parse `.jsonc` files and jsonc blocks with trailing commas', async () => {
    const eslint = await sharedESLint('markdown')
    expect(await lintText(eslint, 'settings.jsonc', '{\n  "a": [1,],\n}\n')).toEqual([])
    const markdown = ['# Setup', '', '```jsonc', '{', '  "a": [1],', '}', '```', ''].join('\n')
    expect(await lintText(eslint, 'docs.md', markdown.replace('[1]', '[1,]'))).toEqual([])
  })

  it('allow anonymous default exports, expression statements and imports of packages that are not installed', async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = [
      '# Usage',
      '',
      '```js',
      "import { thing } from 'not-installed'",
      '',
      'thing.length > 0',
      '',
      'export default function () {',
      '  return thing',
      '}',
      '```',
      '',
    ].join('\n')
    expect(await lintText(eslint, 'docs.md', markdown)).toEqual([])
  })
})

/**
 * Each problem `code` linted as `filePath` has, as `line:column rule`, with its severity and
 * whether it has a fix. With `isKept`, only the problems whose rule it keeps
 */
async function problemsOf(
  eslint: ESLint,
  filePath: string,
  code: string,
  isKept: (ruleId: string | null) => boolean = () => true,
): Promise<Array<string>> {
  const results = await eslint.lintText(code, { filePath })
  return results.flatMap((result) =>
    result.messages
      .filter((message) => isKept(message.ruleId))
      .map(
        (message) =>
          `${message.line}:${message.column} ${message.ruleId ?? message.message} ${message.severity}${message.fix ? ' fix' : ''}`,
      ),
  )
}

describe('markdown linting', () => {
  it('is off with `markdown: false`', async () => {
    const eslint = await createESLint('markdown', { markdown: false })
    const results = await eslint.lintText('# Title\n\n### Skipped\n', { filePath: 'docs.md' })
    expect(results.map((result) => result.messages.map((message) => message.message))).toEqual([
      [expect.stringMatching(/^File ignored because no matching configuration was supplied/)],
    ])
  })

  it('lints `.markdown` files and their code blocks', async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = [
      '# Title',
      '',
      '### Skipped',
      '',
      '```js',
      'var a = 1',
      'a()',
      '```',
      '',
      '````md',
      '```json',
      '{ "a": 1, "a": 2 }',
      '```',
      '````',
      '',
    ].join('\n')
    expect(await problemsOf(eslint, 'docs.markdown', markdown)).toEqual([
      '3:1 @gpahal/markdown/heading-increment 2',
      '6:1 no-var 2 fix',
      '12:11 json/no-duplicate-keys 2',
    ])
  })

  it('fixes a code-block problem and a Markdown problem in one run, but not bare URLs', async () => {
    const eslint = await sharedESLint('markdown', {}, { fix: true })
    const markdown = [
      '# Title',
      '',
      'See [ docs ](https://a.dev) at www.example.com.',
      '',
      '```js',
      'var a = 1',
      'a()',
      '```',
      '',
    ].join('\n')
    const [result] = await eslint.lintText(markdown, { filePath: 'docs.md' })
    expect(result?.output).toBe(markdown.replace('[ docs ]', '[docs]').replace('var a', 'const a'))
    expect(result?.messages.map((message) => message.ruleId)).toEqual([
      '@gpahal/markdown/no-bare-urls',
    ])
  })

  it('reports a bare URL once: a scheme URL with a fix, and `www.` and email literals without', async () => {
    const eslint = await sharedESLint('markdown')
    // `prefer-autolinks` leaves out a URL with a character reference, so `no-bare-urls` keeps it
    const markdown =
      '# Title\n\nGo to https://a.dev now.\n\nSee www.a.dev and a@b.dev.\n\nSee https://a.dev/?a=1&amp;b=2.\n'
    expect(await problemsOf(eslint, 'docs.md', markdown)).toEqual([
      '3:7 @gpahal/markdown/prefer-autolinks 2 fix',
      '5:5 @gpahal/markdown/no-bare-urls 2',
      '5:19 @gpahal/markdown/no-bare-urls 2',
      '7:5 @gpahal/markdown/no-bare-urls 2',
    ])
  })

  it('skips HTML nested too deep to parse without crashing', async () => {
    const eslint = await sharedESLint('markdown')
    const html = `${'<div>'.repeat(3000)}x${'</div>'.repeat(3000)}`
    expect(await problemsOf(eslint, 'docs.md', `# Title\n\n${html}\n`)).toEqual([])
  })
})

describe('markdown math', () => {
  const MONEY = [
    '# Title',
    '',
    '$$ signs are money.',
    '',
    '## Usage',
    '',
    'See [missing](#nowhere) and https://bare.example.com.',
    '',
    '```js',
    'var x = 1',
    '```',
    '',
  ].join('\n')

  it('is off by default, so `$$` is text', async () => {
    const eslint = await sharedESLint('markdown')
    expect(await problemsOf(eslint, 'docs.md', MONEY)).toEqual([
      '7:5 @gpahal/markdown/no-missing-link-fragments 2',
      '7:29 @gpahal/markdown/prefer-autolinks 2 fix',
      '10:1 no-var 2 fix',
    ])
  })

  it('is on with `math: true`, where an unclosed `$$` runs to the end of the document', async () => {
    const eslint = await sharedESLint('markdown', { markdown: { math: true } })
    expect(await problemsOf(eslint, 'docs.md', MONEY)).toEqual([])
    expect(
      await problemsOf(
        eslint,
        'docs.md',
        '# Title\n\n$$\n\\frac{a}{b}\n$$\n\n```js\nvar x = 1\n```\n',
      ),
    ).toEqual(['8:1 no-var 2 fix'])
  })
})

/**
 * `[empty]()` in a ```md block nested `depth` deep, on the line `depth + 3`
 */
function nestedMarkdown(depth: number): string {
  let text = '[empty]()'
  for (let level = 1; level <= depth; level++) {
    const fence = '`'.repeat(level + 2)
    text = `${fence}md\n${text}\n${fence}`
  }
  return `# Title\n\n${text}\n`
}

describe('markdown processor', () => {
  it('lints ```md blocks as Markdown without the document rules, and their own code blocks', async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = [
      '# Title',
      '',
      '````md',
      '# Another title',
      '',
      '### Skipped [label]',
      '',
      '[empty]()',
      '',
      '```js',
      'var a = 1',
      'a()',
      '```',
      '````',
      '',
    ].join('\n')
    expect(await problemsOf(eslint, 'docs.md', markdown)).toEqual([
      '8:1 markdown/no-empty-links 2',
      '11:1 no-var 2 fix',
    ])
  })

  it('lints a block named `*.markdown` without the document rules', async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = [
      '# Title',
      '',
      '```md filename="x.markdown"',
      '### Skipped [label]',
      '',
      '[empty]()',
      '```',
      '',
    ].join('\n')
    expect(await problemsOf(eslint, 'docs.md', markdown)).toEqual(['6:1 markdown/no-empty-links 2'])
  })

  it('lints ```md blocks nested up to 3 deep', async () => {
    const eslint = await sharedESLint('markdown')
    expect(await problemsOf(eslint, 'docs.md', nestedMarkdown(3))).toEqual([
      '6:1 markdown/no-empty-links 2',
    ])
    expect(await problemsOf(eslint, 'docs.md', nestedMarkdown(4))).toEqual([])
  })

  it('leaves the `package-json` rules off in a block named package.json', async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = [
      '# Title',
      '',
      '```json filename="package.json"',
      '{ "name": "x" }',
      '```',
      '',
    ].join('\n')
    expect(await problemsOf(eslint, 'docs.md', markdown)).toEqual([])
    expect(
      await ruleSeverity(eslint, 'docs.md/1_package.json', 'package-json/require-version'),
    ).toBeUndefined()
  })

  it('lints the file itself under its own name, so ignoring code blocks keeps its rules', async () => {
    const eslint = await createESLint('markdown', {
      markdown: true,
      ignores: (defaults) => [...defaults, '**/*.md/**'],
    })
    expect(await lintText(eslint, 'docs.md', '# Title\n\n### Skipped\n')).toEqual([
      expect.stringMatching(/^@gpahal\/markdown\/heading-increment: /),
    ])
  })

  it.each([
    ['front matter', {}, '---\nexample: |\n  ```js\n  var a = 1\n  ```\n---\n\n# Title\n'],
    [
      'a math block with `math: true`',
      { markdown: { math: true } },
      '# Title\n\n$$\n```js\nvar a = 1\n```\n$$\n',
    ],
  ])('never lints a code fence in %s as a code block', async (_name, options, markdown) => {
    const eslint = await sharedESLint('markdown', options)
    expect(await problemsOf(eslint, 'docs.md', markdown)).toEqual([])
  })

  it('tells a disable comment before a code block from the same one in prose', async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = [
      '# Title',
      '',
      '<!-- eslint-disable-next-line no-var -- an example -->',
      'Text',
      '',
      '<!-- eslint-disable-next-line no-var -- an example -->',
      '```js',
      'var a = 1',
      'a()',
      '```',
      '',
    ].join('\n')
    expect(await problemsOf(eslint, 'docs.md', markdown)).toEqual([
      "3:1 Unused eslint-disable directive (no problems were reported from 'no-var'). 2 fix",
    ])
  })

  it("doesn't lint a block whose language has `/`, `\\` or `..` as a file outside it", async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = [
      '# Title',
      '',
      '```js/../../eslint.config.js',
      'const unused = 1',
      '```',
      '',
      '```js\\..\\..\\eslint.config.js',
      'const unused = 1',
      '```',
      '',
    ].join('\n')
    expect(await problemsOf(eslint, 'docs.md', markdown)).toEqual([])
  })

  it('keeps a block named with `/` or `..` inside the Markdown file', async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = [
      '# Title',
      '',
      '```js filename="../../../dist/x.js"',
      'var a = 1',
      'a()',
      '```',
      '',
    ].join('\n')
    expect(await problemsOf(eslint, 'README.md', markdown)).toEqual(['4:1 no-var 2 fix'])
    expect(await ruleSeverity(eslint, 'README.md/0_.._.._.._dist_x.js', 'no-var')).toBe(2)
  })

  // Column 0, before the comment, so no directive on the line hides it
  it.each([
    [
      'Markdown',
      'docs.md',
      '# Title\n\n<!-- eslint-disable-next-line markdown/no-empty-links -->\n[empty]()\n',
      '3:0',
    ],
    ['code', 'x.js', '// eslint-disable-next-line no-var\nvar a = 1\na()\n', '1:0'],
  ])(
    'requires a reason in a disable comment in %s, at the start of its line',
    async (_name, file, code, at) => {
      const eslint = await sharedESLint('markdown')
      expect(await problemsOf(eslint, file, code)).toEqual([
        `${at} @eslint-community/eslint-comments/require-description 2`,
      ])
    },
  )
})

describe('the language columns of a rule that reports JavaScript columns', () => {
  // Reports the dash of line 3, at JavaScript's 0-based columns
  const rule: Rule.RuleModule = {
    create: (context) => ({
      'root:exit': () => {
        context.report({
          loc: { start: { line: 3, column: 2 }, end: { line: 3, column: 3 } },
          message: 'dash',
        })
      },
    }),
  }
  const plugin = withLanguageColumnsRule({ rules: { dash: rule } }, 'dash')
  const linter = new Linter({ configType: 'flat' })
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('count %s as a line break', (_name, eol) => {
    const messages = linter.verify(
      ['# T', '', 'A \u{2014} b', ''].join(eol),
      {
        files: ['**/*.md'],
        plugins: { markdown, test: plugin },
        language: 'markdown/gfm',
        rules: { 'test/dash': 'error' },
      },
      'doc.md',
    )
    expect(
      messages.map((message) => [message.line, message.column, message.endLine, message.endColumn]),
    ).toEqual([[3, 3, 3, 4]])
  })
})

describe('markdown code block fixes', () => {
  it('leaves an object-literal excerpt, which parses as a labelled block', async () => {
    const eslint = await sharedESLint('markdown', {}, { fix: true })
    const code =
      "# T\n\n```js\nresolve: {\n  alias: [\n    { find: 'a', replacement: 'b' }\n  ]\n}\n```\n"
    const [result] = await eslint.lintText(code, { filePath: 'docs.md' })
    expect(result?.output).toBeUndefined()
    expect(
      result?.messages
        .map((message) => message.ruleId)
        .filter((ruleId) => ruleId?.includes('label') === true || ruleId === 'no-lone-blocks'),
    ).toEqual([])
  })

  const MODULE_BLOCK =
    "# T\n\n```ts\nimport type { Y } from 'y'\n\ninterface X {\n  m(): Array<Y>\n  n: Y[]\n}\n\nexport function f(x: X): void {\n  const count: number = 1\n  x.m(count)\n}\n```\n"

  it('reports the type shapes of a module block without fixing them', async () => {
    // A TypeScript file, so the project isn't JavaScript-only, which typescript-eslint doesn't lint
    await using project = await withProject({ 'src/index.ts': 'export {}\n' })
    const eslint = await createESLint(project.dir, {}, { fix: true })
    const [result] = await eslint.lintText(MODULE_BLOCK, { filePath: 'docs.md' })
    expect(result?.output).toBeUndefined()
    expect(result?.messages.map((message) => message.ruleId)).toEqual(
      expect.arrayContaining([
        '@typescript-eslint/array-type',
        '@typescript-eslint/consistent-type-definitions',
        '@typescript-eslint/method-signature-style',
        '@typescript-eslint/no-inferrable-types',
      ]),
    )
  })

  it('parses a TypeScript block of a JavaScript-only project, without typescript-eslint rules', async () => {
    const eslint = await sharedESLint('markdown', {}, { fix: true })
    const [result] = await eslint.lintText(MODULE_BLOCK, { filePath: 'docs.md' })
    expect(result?.output).toBeUndefined()
    expect(result?.messages.map((message) => message.ruleId)).toEqual([])
  })
})
