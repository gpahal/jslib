import type { ESLint, Linter, Rule } from 'eslint'
import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

import { countWork, minCpuMs } from '@gpahal/internal/node/testing'

import type { EslintConfigOptions } from '@/index'
import { parseUncached } from '@/internal/markdown/language'
import { createMarkdownProcessor } from '@/internal/markdown/processor'

import { createESLint, sharedESLint, type ConfigOptions } from './helpers'

const FIXING_ESLINTS = new Map<string, Promise<ESLint>>()

/**
 * ESLint with `--fix` on the `markdown` fixture, made once per set of `options`, which must be JSON
 */
async function fixingESLint(options: ConfigOptions = {}): Promise<ESLint> {
  const key = JSON.stringify(options)
  let eslint = FIXING_ESLINTS.get(key)
  if (eslint === undefined) {
    eslint = createESLint('markdown', options, { fix: true })
    FIXING_ESLINTS.set(key, eslint)
  }
  return eslint
}

/**
 * `markdown` after `eslint --fix` as `docs.md`. Throws when a second pass changes it again
 */
async function fix(markdown: string, options: ConfigOptions = {}): Promise<string> {
  const eslint = await fixingESLint(options)
  const [first] = await eslint.lintText(markdown, { filePath: 'docs.md' })
  const output = first?.output ?? markdown
  const [second] = await eslint.lintText(output, { filePath: 'docs.md' })
  if (second?.output !== undefined) {
    throw new Error(`A second --fix pass changed the output:\n${second.output}`)
  }
  return output
}

/**
 * `code` after `eslint --fix` as a code block's virtual file of its own
 */
async function fixCode(code: string): Promise<string> {
  const eslint = await fixingESLint()
  const [result] = await eslint.lintText(code, { filePath: 'docs.md/0.js' })
  return result?.output ?? code
}

/**
 * Each problem of `markdown` linted as `docs.md` with `options`, as `line:column rule`, or the
 * message for one without a rule, with ` fix` when it has a fix
 */
async function problemsOf(
  markdown: string,
  options: Partial<EslintConfigOptions> = {},
): Promise<Array<string>> {
  const eslint = await sharedESLint('markdown', options)
  const results = await eslint.lintText(markdown, { filePath: 'docs.md' })
  return results.flatMap((result) =>
    result.messages.map(
      (message) =>
        `${String(message.line)}:${String(message.column)} ${message.ruleId ?? message.message}${message.fix ? ' fix' : ''}`,
    ),
  )
}

/**
 * A Markdown file of a title and `markdown`'s lines
 */
function lines(...markdown: Array<string>): string {
  return ['# Title', '', ...markdown, ''].join('\n')
}

function createProcessor(frontmatter: Array<'yaml' | 'toml'> = []) {
  return createMarkdownProcessor({
    frontmatter,
    math: false,
    areas: { astro: true, html: true, json: true, yaml: true, toml: true },
  })
}

/**
 * An unused-directive message for `markdown/no-html` at `offset` of `markdown`, whose fix replaces
 * `length` characters with `text`
 */
function unusedAt(
  markdown: string,
  offset: number,
  length: number,
  text = ' ',
): Linter.LintMessage {
  return {
    ruleId: null,
    severity: 2,
    message: "Unused eslint-disable directive (no problems were reported from 'markdown/no-html').",
    line: markdown.slice(0, offset).split('\n').length,
    column: offset - markdown.lastIndexOf('\n', offset - 1),
    fix: { range: [offset, offset + length], text },
  }
}

/**
 * Unused-directive messages for each `directive` in `markdown`
 */
function unusedEach(markdown: string, directive: string): Array<Linter.LintMessage> {
  const messages: Array<Linter.LintMessage> = []
  for (let start = markdown.indexOf(directive); start !== -1;) {
    messages.push(unusedAt(markdown, start, directive.length))
    start = markdown.indexOf(directive, start + directive.length)
  }
  return messages
}

/**
 * The rendered structure of `markdown`, parsed with GFM: its tree without positions and HTML
 * comments, with each run of whitespace in text as one space, and none at the end of a block, as
 * HTML renders it
 */
function structureOf(markdown: string): unknown {
  const normalize = (nodes: ReadonlyArray<Nodes>): Array<unknown> => {
    const result: Array<Record<string, unknown>> = []
    for (const node of nodes) {
      const trimmed = node.type === 'html' ? node.value.trim() : ''
      if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) {
        continue
      }
      const last = result.at(-1)
      if (node.type === 'text' && last?.['type'] === 'text') {
        last['value'] = `${String(last['value'])}${node.value}`.replaceAll(/\s+/gu, ' ')
        continue
      }
      const { position: _position, ...rest } = node
      result.push(
        'children' in node
          ? { ...rest, children: normalize(node.children) }
          : node.type === 'text'
            ? { ...rest, value: node.value.replaceAll(/\s+/gu, ' ') }
            : rest,
      )
    }
    const last = result.at(-1)
    if (last?.['type'] === 'text') {
      last['value'] = String(last['value']).trimEnd()
    }
    return result
  }
  return normalize(
    fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }).children,
  )
}

/**
 * The values of the code blocks of `markdown`, parsed with GFM
 */
function codeOf(markdown: string): Array<string> {
  const values: Array<string> = []
  const visit = (node: Nodes): void => {
    if (node.type === 'code') values.push(node.value)
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }))
  return values
}

describe('markdown processor offsets', () => {
  const BLOCK = '```js\nexport let foo = 1\n```\n'
  const FIXED_BLOCK = '```js\nexport const foo = 1\n```\n'

  it('keep fixes in place after front matter and math ranges with astral characters', async () => {
    const markdown = [
      '---',
      'title: 😀😀',
      '---',
      '',
      BLOCK,
      '$$',
      '😀 + 😀',
      '$$',
      '',
      BLOCK,
    ].join('\n')
    expect(await fix(markdown, { markdown: { math: true } })).toBe(
      markdown.split(BLOCK).join(FIXED_BLOCK),
    )
  })

  it('keep fixes in place in a CRLF file with a BOM, front matter and nested fences', async () => {
    const markdown = [
      '\u{FEFF}---',
      'title: 😀',
      '---',
      '',
      '````md',
      '😀 text',
      '',
      '```js',
      'export let foo = 1',
      '```',
      '````',
      '',
      '```js',
      'export let bar = 1',
      '```',
      '',
    ].join('\r\n')
    expect(await fix(markdown)).toBe(markdown.replaceAll('export let', 'export const'))
  })

  it.each<[string, string, (code: string) => string, Array<string>]>([
    [
      'a line indented by a tab that is partly the list indent',
      'var a = 1',
      (code) => `# T\n\n- Item\n\n  \`\`\`js\n\t${code}\n  \`\`\`\n`,
      ['6:2 no-var fix'],
    ],
    [
      'lone CR line endings',
      'var a = 1',
      (code) => `# T\r\rText\r\r\`\`\`js\r${code}\r\`\`\`\r`,
      ['6:1 no-var fix'],
    ],
  ])('map %s', async (_name, code, toMarkdown, problems) => {
    const markdown = toMarkdown(code)
    const fixedCode = await fixCode(`${code}\n`)
    expect(fixedCode).not.toBe(`${code}\n`)
    expect(await problemsOf(markdown)).toEqual(problems)
    expect(await fix(markdown)).toBe(toMarkdown(fixedCode.slice(0, -1)))
  })

  it.each([['before the first line', 0]])(
    'report a fatal message %s of a block on its opening fence',
    (_name, line) => {
      const processor = createProcessor()
      processor.preprocess?.('# Title\n\n<!-- global Foo -->\n> ```js\n> foo()\n> ```\n', 'docs.md')
      const message: Linter.LintMessage = {
        ruleId: null,
        fatal: true,
        severity: 2,
        message: 'Parsing error',
        line,
        column: 1,
      }
      expect(processor.postprocess?.([[], [message]], 'docs.md')).toEqual([
        { ...message, line: 4, column: 3 },
      ])
    },
  )
})

/**
 * Reports each identifier `MARK`, fixed to `MARKED`, and `MULTI`, fixed to two lines
 */
const MARK_RULE: Rule.RuleModule = {
  meta: { type: 'problem', fixable: 'code', schema: [] },
  create: (context) => ({
    Identifier: (node) => {
      if (node.name === 'MARK') {
        context.report({ node, message: 'mark', fix: (fixer) => fixer.replaceText(node, 'MARKED') })
      } else if (node.name === 'MULTI') {
        context.report({
          node,
          message: 'multi',
          fix: (fixer) => fixer.replaceText(node, 'MULTIDONE\nconst added = 1'),
        })
      }
    },
  }),
}

const PROBE_CONFIGS: Array<Linter.Config> = [
  { plugins: { probe: { rules: { mark: MARK_RULE } } } },
  { files: ['**/*.md/**'], rules: { 'probe/mark': 'error' } },
]

const CONTAINERS: Array<[string, (line: string, index: number) => string]> = [
  ['none', (line) => line],
  ['blockquote', (line) => `> ${line}`],
  ['ordered list item', (line, index) => (index === 0 ? `10. ${line}` : `    ${line}`)],
  ['list item in a blockquote', (line, index) => (index === 0 ? `> - ${line}` : `>   ${line}`)],
  ['tab-indented list item', (line, index) => (index === 0 ? `-\t${line}` : `\t${line}`)],
  ['footnote', (line, index) => (index === 0 ? `[^1]: ${line}` : `    ${line}`)],
]

const BODIES = [['\tconst MARK = 1', '', '\t\tvoid MULTI'], ['const s = "🎉"; const MARK = s']]

const HEADS = ['', '\u{FEFF}', '---\ntitle: T\n---\n\n']

/**
 * Each body in each container, with LF and CRLF line endings, after one of nothing, a BOM or front
 * matter in turn, so each container meets each head
 */
const MARKDOWN_CASES = CONTAINERS.flatMap(([container, wrap], containerIndex) =>
  BODIES.flatMap((body, bodyIndex) =>
    ['\n', '\r\n'].map((eol) => {
      const head = HEADS[(containerIndex + bodyIndex) % HEADS.length] ?? ''
      const blockLines = ['```ts', ...body, '```'].map((line, index) => wrap(line, index))
      const markdown = `${head}# T\n\nText.\n\n${blockLines.join('\n')}\n\nAfter.\n`
      return {
        name: `${container}, ${JSON.stringify(eol)}, ${JSON.stringify(head)}`,
        eol,
        markdown: markdown.split('\n').join(eol),
      }
    }),
  ),
)

describe('markdown processor fixes', () => {
  it('map reports to the right position and fixes into the block, in any container', async () => {
    const eslint = await createESLint('markdown', { extraConfigs: PROBE_CONFIGS })
    const fixing = await createESLint('markdown', { extraConfigs: PROBE_CONFIGS }, { fix: true })
    const failures: Array<string> = []
    for (const { name, eol, markdown } of MARKDOWN_CASES) {
      const [result] = await eslint.lintText(markdown, { filePath: 'docs.md' })
      const markdownLines = markdown.replace('\u{FEFF}', '').split(/\r\n|\n/u)
      const marks = result?.messages.filter(({ ruleId }) => ruleId === 'probe/mark') ?? []
      if (marks.length === 0) {
        failures.push(`${name}: no report`)
      }
      for (const message of marks) {
        const word = message.message === 'mark' ? 'MARK' : 'MULTI'
        const text = markdownLines[message.line - 1]?.slice(
          message.column - 1,
          (message.endColumn ?? 0) - 1,
        )
        if (text !== word || message.fix === undefined) {
          failures.push(
            `${name}: ${String(message.line)}:${String(message.column)} reads ${JSON.stringify(text)}`,
          )
        }
      }
      const [fixed] = await fixing.lintText(markdown, { filePath: 'docs.md' })
      const expected = codeOf(markdown).map((value) =>
        value
          .replaceAll(/\bMARK\b/gu, 'MARKED')
          // The fix's new line gets the file's line ending
          .replaceAll(/\bMULTI\b/gu, () => `MULTIDONE${eol}const added = 1`),
      )
      if (JSON.stringify(codeOf(fixed?.output ?? markdown)) !== JSON.stringify(expected)) {
        failures.push(`${name}: fixed to ${JSON.stringify(fixed?.output)}`)
      }
    }
    expect(failures).toEqual([])
  })

  it.each([
    ['a blockquote without a space after its marker', '>', '> ', '>```ts', '>```'],
    [
      'a fence indented 3 spaces, whose lines start further left',
      '',
      ' '.repeat(3),
      '   ```ts',
      '   ```',
    ],
  ])(
    'keep the indentation of the new lines of a multi-line fix in %s',
    async (_name, startPrefix, prefix, opening, closing) => {
      const code = [
        'declare const c: boolean',
        'declare const d: boolean',
        'if (c) {',
        '  if (d) {',
        '    console.log(`a',
        '  b`)',
        '  }',
        '}',
      ]
      // The fix starts on the `if (c) {` line, whose Markdown prefix is `startPrefix`
      const markdown = [
        '# T',
        '',
        opening,
        ...code.map((line) => `${line === 'if (c) {' ? startPrefix : prefix}${line}`),
        closing,
        '',
      ].join('\n')
      expect(codeOf(markdown)).toEqual([code.join('\n')])
      const [fixed = ''] = codeOf(await fix(markdown))
      expect(fixed).toContain('if (c && d)')
      expect(fixed).toContain('`a\n  b`')
    },
  )

  it.each([['a blockquote', '> ```js', '> ', '>', '> ```']])(
    'leave no trailing whitespace on the empty lines a fix adds in %s',
    async (_name, opening, prefix, emptyLine, closing) => {
      const markdown = (code: Array<string>) =>
        [
          opening,
          ...code.map((line) => (line === '' ? emptyLine : `${prefix}${line}`)),
          closing,
          '',
        ].join('\n')
      expect(await fix(markdown(["import a from 'a'", 'a()']))).toBe(
        markdown(["import a from 'a'", '', 'a()']),
      )
    },
  )

  it.each([
    [
      'a removed unused directive in a blockquote',
      '> ```js\n> // eslint-disable-next-line no-console\n> export const a = 1\n> ```\n',
      '> ```js\n>\n> export const a = 1\n> ```\n',
    ],
  ])('leave no whitespace on the line of %s', async (_name, block, expected) => {
    expect(await fix(`# T\n\n${block}`)).toBe(`# T\n\n${expected}`)
  })

  // `import-x/newline-after-import`'s fix writes `\n`, which the block's line ending replaces
  it.each([['a CRLF blockquote', '\r\n', '> ']])(
    'write the line ending of %s in fixes',
    async (_name, eol, prefix) => {
      const markdown = (body: Array<string>) =>
        ['# T', '', ...body.map((line) => `${prefix}${line}`.trimEnd()), ''].join(eol)
      const [open, imports, code, close] = [
        '```js',
        "import path from 'node:path'",
        'export const sep = path.sep',
        '```',
      ]
      expect(await fix(markdown([open, imports, code, close]))).toBe(
        markdown([open, imports, '', code, close]),
      )
    },
  )

  it('settle in one run: repeated inline links become sorted collapsed references', async () => {
    // ESLint repeats fix passes within a run, so the shortcut references that
    // `prefer-link-reference-definitions` writes are collapsed in it. It's off by default, and its
    // fix and `sort-definitions`' only report, so they're turned back on
    const options: ConfigOptions = {
      configs: [
        {
          files: ['**/*.md'],
          rules: {
            'markdown-preferences/prefer-link-reference-definitions': ['error', { minLinks: 2 }],
          },
          settings: {
            '@gpahal/report-only': {
              'markdown-preferences/prefer-link-reference-definitions': false,
              'markdown-preferences/sort-definitions': false,
            },
          },
        },
      ],
    }
    expect(
      await fix(
        '# T\n\nSee [zed](https://z.dev), [zed](https://z.dev), [alpha](https://a.dev) and [alpha](https://a.dev).\n',
        options,
      ),
    ).toBe(
      '# T\n\nSee [zed][], [zed][], [alpha][] and [alpha][].\n\n[alpha]: https://a.dev\n\n[zed]: https://z.dev\n',
    )
  })
})

describe('markdown processor blocks', () => {
  it('lint a block whose language is in upper case, and fix the case', async () => {
    const markdown = '# Title\n\n```JS\nvar x = 1\nx()\n```\n'
    expect(await problemsOf(markdown)).toEqual([
      '3:4 @gpahal/markdown/lowercase-code-block-language fix',
      '4:1 no-var fix',
    ])
    expect(await fix(markdown)).toBe('# Title\n\n```js\nconst x = 1\nx()\n```\n')
  })

  // Core `dot-notation` runs in JavaScript files only
  it.each([
    ['ts:title=x.js', ['4:1 no-var fix']],
    ['js{1}', ['4:1 no-var fix', '5:3 dot-notation fix']],
  ])('lint a block of ```%s in its language', async (info, problems) => {
    expect(await problemsOf(lines(`\`\`\`${info}`, 'var o = { a: 1 }', "o['a']()", '```'))).toEqual(
      problems,
    )
  })

  it.each([
    ['```ts filename="App.widget"', 'App.widget'],
    ['```ts basefilename="App.widget"', '0.ts'],
  ])('name the block of %s', (opening, filename) => {
    const [, block] =
      createProcessor().preprocess?.(`${opening}\nconst a = 1\n\`\`\`\n`, 'docs.md') ?? []
    expect(typeof block === 'object' ? block.filename : block).toBe(filename)
  })

  it("maps a file's code blocks after `no-missing-atx-heading-space` checked a tag in another", async () => {
    const eslint = await createESLint('markdown', {}, { fix: true })
    await eslint.lintText('> first line\n> #heading\n> third line\n', { filePath: 'a.md' })
    const [second] = await eslint.lintText('# B\n\nText\n\n```js\nvar a = 1\n```\n', {
      filePath: 'b.md',
    })
    expect(second?.output).toBe('# B\n\nText\n\n```js\nconst a = 1\n```\n')
  })
})

describe('markdown processor directives before a code block', () => {
  it("apply to a block for a rule of a config of yours's plugin, which the Markdown file knows too", async () => {
    const eslint = await createESLint('markdown', {
      configs: [
        { plugins: { probe: { rules: { mark: MARK_RULE } } }, rules: { 'probe/mark': 'error' } },
      ],
    })
    const markdown = lines('```ts', 'export const MARK = 1', '```')
    const [result] = await eslint.lintText(markdown, { filePath: 'docs.md' })
    expect(result?.messages.map((message) => message.line)).toEqual([4])
    const disabled = markdown.replace(
      '```ts',
      '<!-- eslint-disable-next-line probe/mark -- example -->\n```ts',
    )
    const [disabledResult] = await eslint.lintText(disabled, { filePath: 'docs.md' })
    expect(disabledResult?.messages).toEqual([])
  })

  it('map an unused one before a BOM and shebang back to its HTML comment', async () => {
    const markdown =
      '<!-- eslint-disable no-console -- example -->\n\n```js\n\u{FEFF}#!/usr/bin/env node\nlet x = 1\nx()\n```\n'
    expect(await problemsOf(markdown)).toEqual([
      "1:1 Unused eslint-disable directive (no problems were reported from 'no-console').",
      '5:5 prefer-const fix',
    ])
    expect(await fix(markdown)).toBe(markdown.replace('let x', 'const x'))
  })

  it('report one unused by the block on the comment, without a fix', async () => {
    const markdown = lines(
      '<!-- eslint-disable no-var -- reason -->',
      '```js',
      'const a = 1',
      'a()',
      '```',
      '',
      '- Item',
      '',
      '  > <!--',
      '  >   eslint-disable no-console -- reason',
      '  > -->',
      '  >',
      '  > ```js',
      '  > const b = 1',
      '  > ```',
    )
    expect(await problemsOf(markdown)).toEqual([
      "3:1 Unused eslint-disable directive (no problems were reported from 'no-var').",
      "11:5 Unused eslint-disable directive (no problems were reported from 'no-console').",
    ])
  })

  it('scope one at the end of a blockquote or list item to its container, with no fix that makes a loose list tight', async () => {
    const markdown = lines(
      '> Quote',
      '>',
      '> <!-- eslint-disable no-var -- reason -->',
      '',
      '```js',
      'var a = 1',
      'a()',
      '```',
      '',
      '- Item',
      '',
      '  <!-- eslint-disable no-var -- reason -->',
      '',
      '```js',
      'var b = 1',
      'b()',
      '```',
    )
    expect(await problemsOf(markdown)).toEqual([
      "5:3 Unused eslint-disable directive (no problems were reported from 'no-var'). fix",
      '8:1 no-var fix',
      "14:3 Unused eslint-disable directive (no problems were reported from 'no-var').",
      '17:1 no-var fix',
    ])
  })

  it.each([['<!-- eslint-skip -->', ['```', 'plain output', '```']]])(
    'apply %s only to the block right after it',
    async (comment, between) => {
      const problems = await problemsOf(
        lines(comment, '', ...between, '', '```js', 'var a = 1', 'a()', '```'),
      )
      expect(problems.filter((problem) => problem.endsWith(' no-var fix'))).toHaveLength(1)
    },
  )

  it.each([
    [
      'no-var, no-console, markdown/no-html, markdown/no-empty-links',
      "3:1 Unused eslint-disable directive (no problems were reported from 'no-console', 'markdown/no-html', or 'markdown/no-empty-links').",
    ],
  ])(
    'report the rules of `%s` that neither lint uses, once, without a fix',
    async (rules, problem) => {
      const markdown = lines(
        `<!-- eslint-disable ${rules} -- reason -->`,
        '```js',
        'var a = 1',
        '```',
      )
      expect(await problemsOf(markdown)).toEqual([problem])
      expect(await fix(markdown)).toBe(markdown)
    },
  )

  it.each([
    [
      'markdown/no-html: "off"',
      "3:1 Unused inline config ('markdown/no-html' is not enabled so can't be turned off).",
    ],
  ])('report the inline config `%s` once', async (config, problem) => {
    expect(
      await problemsOf(lines(`<!-- eslint ${config} -- reason -->`, '```js', 'const a = 1', '```')),
    ).toEqual([problem])
  })

  it.each(['global foo'])('forward `%s` to the block', (directive) => {
    const [, block] =
      createProcessor().preprocess?.(
        lines(`<!-- ${directive} -->`, '```js', 'foo()', '```'),
        'docs.md',
      ) ?? []
    expect(block).toEqual({ filename: '0.js', text: `/* ${directive} */\nfoo()\n` })
  })

  it.each([
    [
      'two next-line directives in one HTML comment line',
      [
        '<!-- eslint-disable-next-line no-var -- reason --> <!-- eslint-disable-next-line eqeqeq -- reason -->',
      ],
    ],
  ])('apply %s to the first line of code', async (_name, directives) => {
    const markdown = lines(...directives, '```js', 'var a = a == 1', 'a()', '```')
    expect(await problemsOf(markdown)).toEqual([])
  })
})

describe('markdown processor directives in the comment syntax of the block', () => {
  it.each([
    ['a YAML', 'yml/no-empty-sequence-entry', ['```yaml', '- a', '-', '- b', '```'], '6:1'],
    ['a JSON', 'json/no-duplicate-keys', ['```json', '{ "a": 1, "a": 2 }', '```'], '5:11'],
  ])('apply a directive to %s block, keeping its offsets', async (_name, rule, block, at) => {
    expect(await problemsOf(lines(`<!-- eslint-disable ${rule} -- reason -->`, ...block))).toEqual(
      [],
    )
    expect(await problemsOf(lines('<!-- global Foo -->', ...block))).toEqual([`${at} ${rule}`])
  })
})

describe('`@gpahal/markdown/directive-placement`', () => {
  const REMEDY = 'Use `<!-- eslint-skip -->`, or move the directive'

  /**
   * The messages of `markdown` linted as `docs.md` with `options`, as `line:column severity
   * message`, with ` fatal` for a fatal one and ` fix` for one with a fix
   */
  async function messagesOf(markdown: string, options: ConfigOptions = {}): Promise<Array<string>> {
    const eslint = await sharedESLint('markdown', options)
    const results = await eslint.lintText(markdown, { filePath: 'docs.md' })
    return results.flatMap((result) =>
      result.messages.map(
        (message) =>
          `${String(message.line)}:${String(message.column)} ${String(message.severity)} ${message.message}${message.fatal ? ' fatal' : ''}${message.fix ? ' fix' : ''}`,
      ),
    )
  }

  it.each([
    [
      'a directive containing `*/` before a JavaScript block',
      ['<!-- eslint-disable no-var -- a*/b -->', '```js', 'a()', '```'],
      `3:1 2 Unexpected \`*/\` in a directive before a \`\`\`js block, which would end the \`/*\` comment it becomes there, so it isn't applied to the block. ${REMEDY}`,
    ],
    [
      'an unused directive before a block named by its `filename` meta',
      ['<!-- eslint-disable no-var -- reason -->', '```ts filename="App.widget"', 'var a', '```'],
      `3:1 2 Unexpected directive before a \`\`\`ts filename="App.widget" block, which takes no directives, so it isn't applied to the block. ${REMEDY}`,
    ],
  ])('reports %s as an error that is not fatal', async (_name, markdown, message) => {
    const problems = await messagesOf(lines(...markdown))
    expect(problems.filter((problem) => problem.includes('Unexpected'))).toEqual([message])
    expect(problems.filter((problem) => problem.includes(' fatal'))).toEqual([])
  })

  it('leaves an unused directive before a block without directives reported unused, without a fix, when off', async () => {
    const options: ConfigOptions = {
      markdown: { rules: { '@gpahal/markdown/directive-placement': 'off' } },
    }
    expect(
      await messagesOf(
        lines('<!-- eslint-disable no-var -- reason -->', '```sh', 'ls', '```'),
        options,
      ),
    ).toEqual(["3:1 2 Unused eslint-disable directive (no problems were reported from 'no-var')."])
    expect(
      await messagesOf(
        lines('<!-- eslint-disable no-var -- a*/b -->', '```js', 'a()', '```'),
        options,
      ),
    ).toEqual([])
  })
})

describe('markdown processor unused directive removal', () => {
  const DIRECTIVE = '<!-- eslint-disable-next-line markdown/no-html -- reason -->'
  const LINE_DIRECTIVE = '<!-- eslint-disable-line markdown/no-html -- reason -->'

  it.each([
    ['between words', `a ${LINE_DIRECTIVE} b\n`, 'a b\n'],
    ['after a quote, before lazy text', `> quote\n${DIRECTIVE}\nmore\n`, '> quote\n\nmore\n'],
    ['in a loose list item', `- item\n\n  ${DIRECTIVE}\n\n  text\n`, '- item\n\n  text\n'],
    [
      // The first pass removes the disable directive, which leaves the enable directive unused
      'a disable and enable pair around a region without problems',
      '# T\n\n<!-- eslint-disable markdown/no-html -->\n\nText\n\n<!-- eslint-enable markdown/no-html -->\n\nMore\n',
      '# T\n\nText\n\nMore\n',
    ],
  ])('removes one %s without changing what renders', async (_name, markdown, expected) => {
    const output = await fix(markdown)
    expect(output).toBe(expected)
    expect(structureOf(output)).toEqual(structureOf(markdown))
  })

  it.each([
    [
      'in a tight list item, which a blank line would make loose',
      `- item\n  ${DIRECTIVE}\n  text\n`,
      '2:3',
    ],
    ['between same-marker lists', `- one\n\n${DIRECTIVE}\n\n- two\n`, '3:1'],
  ])('reports one %s without a fix', async (_name, markdown, position) => {
    expect(await fix(markdown)).toBe(markdown)
    expect(
      (await problemsOf(markdown)).filter((problem) => problem.includes('Unused eslint-disable')),
    ).toEqual([
      `${position} Unused eslint-disable directive (no problems were reported from 'markdown/no-html').`,
    ])
  })

  it.each([
    [
      'after a table, which would take the next line as a row',
      '# T\n\n| a | b |\n| - | - |\n| 1 | 2 |\n<!-- eslint-disable no-alert -- r -->\nAfter text\n',
    ],
  ])('reports one %s without a fix, as a reparse finds', async (_name, markdown) => {
    expect(await fix(markdown)).toBe(markdown)
    expect(
      (await problemsOf(markdown)).filter((problem) => problem.includes('Unused eslint-disable')),
    ).toEqual([
      expect.stringMatching(
        /^\d+:1 Unused eslint-disable directive \(no problems were reported from 'no-alert'\)\.$/u,
      ),
    ])
  })

  it('keeps a used directive under its public rule name', async () => {
    const markdown =
      '# T\n\n<!-- eslint-disable-next-line @gpahal/markdown/no-missing-atx-heading-space -- tag -->\n#Usage:\n'
    expect(await problemsOf(markdown)).toEqual([])
    expect(await fix(markdown)).toBe(markdown)
  })

  it.each([['YAML', '---']])(
    "doesn't turn the text after a thematic break at the start into %s front matter",
    async (_name, fence) => {
      const markdown = `<!-- eslint-disable no-var -- reason -->\n\n${fence}\n\n# Title\n\nSome intro paragraph.\n\n${fence}\n\nMore.\n`
      const typesOf = (text: string) => {
        const result = parseUncached(text, ['yaml', 'toml'], false)
        return result.ok && result.root.children.map((node) => node.type)
      }
      const types = typesOf(await fix(markdown))
      expect(types).toEqual(typesOf(markdown))
      expect(types).not.toContain(fence === '---' ? 'yaml' : 'toml')
    },
  )

  it('keeps the removals that pass alone when one fails, checking no more than 50 alone', () => {
    const directive = '<!-- eslint-disable markdown/no-html -- reason -->'
    const removalsOf = (markdown: string) => {
      const processor = createProcessor(['yaml', 'toml'])
      processor.preprocess?.(markdown, 'docs.md')
      return (processor.postprocess?.([unusedEach(markdown, directive)], 'docs.md') ?? []).flatMap(
        (message) => (message.fix ? `${String(message.line)}:${String(message.column)}` : []),
      )
    }
    const head = `${directive}\n\n---\n\n# T\n\n---\n\n`
    expect(removalsOf(`${head}Text\n\n${directive}\n\nMore\n`)).toEqual(['11:1'])
    expect(removalsOf(`${head}${`Text\n\n${directive}\n\n`.repeat(60)}`)).toHaveLength(49)
  })
})

describe('markdown processor directives in tab-indented containers', () => {
  const DIRECTIVE = '<!-- eslint-disable markdown/no-html -- reason -->'

  it('remove an unused one without deleting the text after it', async () => {
    const markdown = `# T\n\n- item\n\n\t${DIRECTIVE}\n\n  more text\n`
    const output = await fix(markdown)
    expect(output).toBe('# T\n\n- item\n\n  more text\n')
    expect(structureOf(output)).toEqual(structureOf(markdown))
  })
})

describe('markdown processor speed', () => {
  it('finds unused directive blocks without quadratic scaling', () => {
    const processor = createProcessor()
    const directive = '<!-- eslint-disable-next-line markdown/no-html -- reason -->'
    const chunk = `${directive}\n\nParagraph.\n\n`
    const workOf = (count: number) => {
      const markdown = chunk.repeat(count)
      processor.preprocess?.(markdown, 'docs.md')
      const messages = unusedEach(markdown, directive)
      let adjusted: Array<Linter.LintMessage> = []
      const work = countWork(() => {
        adjusted = processor.postprocess?.([messages], 'docs.md') ?? []
      })
      expect(adjusted.filter((message) => message.fix?.text === '')).toHaveLength(count)
      return work
    }
    expect(workOf(4000)).toBeLessThan(6 * workOf(1000))
  })

  it('reads an HTML node of unclosed comments without quadratic scaling', () => {
    const processor = createProcessor()
    let runCount = 0
    const markdownOf = (count: number) =>
      `${'<!-- '.repeat(count)}\n\n\`\`\`js\nvar a = ${String(runCount++)}\n\`\`\`\n`
    const preprocess = (count: number) => () => processor.preprocess?.(markdownOf(count), 'docs.md')
    // CPU time, since a lazy regex, the quadratic way to read them, backtracks inside one call that
    // no count sees
    const [shortMs = 0, longMs] = minCpuMs([preprocess(4000), preprocess(40_000)])
    expect(longMs).toBeLessThan(30 * shortMs + 50)
  })
})
