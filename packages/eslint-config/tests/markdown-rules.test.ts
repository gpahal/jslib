import fs from 'node:fs/promises'
import path from 'node:path'

import { Linter, RuleTester, type Rule } from 'eslint'
import GithubSlugger from 'github-slugger'

import { countWork } from '@gpahal/internal/node/testing'

import { MARKDOWN_PLUGIN } from '@/internal/markdown/plugin'
import { GPAHAL_PLUGIN } from '@/internal/plugin'

// Each case starts with a heading, so only the rule under test reports

const ruleTester = new RuleTester({
  plugins: { '@gpahal/markdown': MARKDOWN_PLUGIN },
  language: '@gpahal/markdown/gfm',
})

const getRule = (name: string) => MARKDOWN_PLUGIN.rules?.[name] as Rule.RuleModule

function errorsAt(
  messageId: string,
  ...locations: Array<string>
): Array<{ messageId: string; line: number; column: number }> {
  return locations.map((location) => {
    const [line = 0, column = 0] = location.split(':').map(Number)
    return { messageId, line, column }
  })
}

ruleTester.run('require-alt-text', getRule('require-alt-text'), {
  valid: [
    '# T\n\n![Alt](a.png)\n',
    // Decorative and hidden HTML images
    '# T\n\n<img src="a.png" alt=""> <img src="a.png" aria-hidden="true">\n',
    '# T\n\n<img src="a.png" ROLE="None"> <!-- <img src="x"> -->\n',
  ],
  invalid: [
    {
      code: '# T\n\n![](a.png) ![ ](a.png) ![Alt](a.png)\n',
      errors: errorsAt('missingAlt', '3:1', '3:12'),
    },
    {
      code: '# T\n\n<div>\n  <img src="a">\n  <img src="b" alt="B"><img src="c">\n</div>\n',
      errors: errorsAt('missingAlt', '4:3', '5:24'),
    },
  ],
})

ruleTester.run('no-missing-link-fragments', getRule('no-missing-link-fragments'), {
  valid: [
    '# Title\n\n## A `code` heading\n\n## Dup\n\n## Dup\n\n## Custom {#custom-id}\n\n<a id="anchor"></a>\n\nB[^n].\n\n[^n]: N\n\n' +
      '[a](#a-code-heading) [b](#dup-1) [c](#custom-id) [d](#anchor) [e](#top) [f](#L10C2-L12) [g](#TITLE) [h](#fn-n) [i](#user-content-title)\n',
  ],
  invalid: [
    {
      code: '# Title\n\n[a](#missing) [b][b] [c](#title-custom)\n\n[b]: #also-missing\n',
      errors: errorsAt('missingFragment', '3:1', '3:22', '5:1'),
    },
    // Explicit ids match case-sensitively, as browsers match them
    {
      code: '# T\n\n<a id="TOKEN"></a>\n\n[a](#token)\n',
      errors: errorsAt('missingFragment', '5:1'),
    },
  ],
})

ruleTester.run('no-missing-atx-heading-space', getRule('no-missing-atx-heading-space'), {
  valid: [
    '# T\n\n\\#Heading\n\n#######Seven\n\nIssue #12\n\n#123 fixed\n',
    // Inline code, a shebang, the keycap emoji, tags, hex colors and C directives
    '# T\n\nUse `foo\n#define X` in C.\n\n#!/usr/bin/env node\n\n#\u{FE0F}\u{20E3} is the keycap\n',
    '# T\n\n#general #random\n\n- #project/alpha\n\n- [ ] #urgent fix\n',
    '# T\n\n#ff00ff is magenta\n\n#include <x>\n',
  ],
  invalid: [
    {
      code: '# T\n\n#Heading:\n\n> #Quoted:\n\nText\n###Line two\n',
      // A later line may continue the sentence, so it gets a suggestion
      output: '# T\n\n# Heading:\n\n> # Quoted:\n\nText\n###Line two\n',
      errors: [
        ...errorsAt('missingSpace', '3:1', '5:3'),
        {
          ...errorsAt('missingSpace', '8:1')[0],
          suggestions: [
            {
              messageId: 'addSpace',
              output: '# T\n\n#Heading:\n\n> #Quoted:\n\nText\n### Line two\n',
            },
          ],
        },
      ],
    },
  ],
})

ruleTester.run('no-missing-label-refs', getRule('no-missing-label-refs'), {
  valid: [
    // GitHub alerts and task lists
    '# T\n\n> [!iMpOrTaNt]\n> Text.\n\n- [ ] Todo\n- [x] Done\n',
    // Brackets around a link or image, and shortcut references, which are as often text
    '# T\n\n[see [docs][] for details] [![x](a.png)]\n\n[docs]: https://a.dev\n',
    '# T\n\nPress [x] to close. Error [ERR_REQUIRE_ESM] in [page].astro\n',
    '# T\n\nText[^a] and \\[^missing] and [^ a].\n\n[^a]: n\n',
  ],
  invalid: [
    {
      code: '# T\n\nText[^missing] and [Two\n  Words][].\n',
      errors: [
        {
          messageId: 'undefinedReference',
          data: { id: '^missing', article: 'a', kind: 'footnote' },
        },
        { messageId: 'undefinedReference', data: { id: 'Two Words', article: 'a', kind: 'link' } },
      ],
    },
    // Commit hashes are 7 to 40 hexadecimal digits, with at least one digit
    {
      code: '# T\n\n[def5678][] [abc123][] [defaced][]\n',
      errors: errorsAt('undefinedReference', '3:13', '3:24'),
    },
  ],
})

ruleTester.run('canonical-code-block-language', getRule('canonical-code-block-language'), {
  valid: ['```js\nx\n```\n', '```constructor\nx\n```\n'],
  invalid: [
    {
      code: '# Doc\n\n> ~~~ c++ title="x"\n> x\n> ~~~\n',
      output: '# Doc\n\n> ~~~ cpp title="x"\n> x\n> ~~~\n',
      errors: [{ messageId: 'useCanonical', line: 3, column: 7, endLine: 3, endColumn: 10 }],
    },
    // A character reference in the language has no fix
    {
      code: '# Doc\n\n```b&#97;sh\nx\n```\n',
      output: null,
      errors: [{ messageId: 'useCanonical', line: 3, column: 4, endLine: 3, endColumn: 12 }],
    },
  ],
})

ruleTester.run('lowercase-code-block-language', getRule('lowercase-code-block-language'), {
  valid: ['# T\n\n```js\nx\n```\n', '# T\n\n```sh Title\nx\n```\n'],
  invalid: [
    {
      code: '# T\n\n```JSX:title=src/App.jsx\nx\n```\n\n> ~~~ TypeScript title="A"\n> x\n> ~~~\n',
      output: '# T\n\n```jsx:title=src/App.jsx\nx\n```\n\n> ~~~ typescript title="A"\n> x\n> ~~~\n',
      errors: [
        { messageId: 'lowercase', line: 3, column: 4, endColumn: 7 },
        { messageId: 'lowercase', line: 7, column: 7, endColumn: 17 },
      ],
    },
  ],
})

ruleTester.run('heading-increment', getRule('heading-increment'), {
  valid: [
    '# Title\n\n<div><!-- <h4>hidden</h4> --></div>\n\n<header><hr></header>\n\n## Next\n',
    // Only a top-level title of front matter is rank 1
    '---\nmeta:\n  title: Nested\n---\n\n### Skipped\n',
    '+++\n[params]\ntitle = "T"\n+++\n\n### Skipped\n',
    { code: '---\ntitle: T\n---\n\n### Skipped\n', options: [{ frontmatterTitle: '' }] },
  ],
  invalid: [
    { code: '---\ntitle: T\n---\n\n### Skipped\n', errors: errorsAt('skippedRank', '5:1') },
    { code: '+++\ntitle = "T"\n+++\n\n### Skipped\n', errors: errorsAt('skippedRank', '5:1') },
    {
      code: '# Title\n\n<div><h2>a</h2><H4>b</H4></div>\n',
      errors: errorsAt('skippedRank', '3:16'),
    },
  ],
})

ruleTester.run('no-multiple-h1', getRule('no-multiple-h1'), {
  valid: [
    '# Heading 1\n\n## Heading 2',
    '<h2>Heading 2</h2>\n\n# Heading 1',
    // Comments, code and escapes don't count
    '<!-- <h1>Heading 1</h1> -->\n\n# Heading 1\n\n`<h1>x</h1>`\n\n\\# Heading 1',
    '---\ntitle: My Title\n---\n\n## Heading 2',
    '+++\nitems = [\n  { title = "Nested" },\n]\n+++\n\n# Actual\n',
    `+++\ndescription = """\ntitle = "just a sample"\n[table]\n"""\n+++\n\n# Actual\n`,
    { code: '---\ntitle: My Title\n---\n\n# Heading 1', options: [{ frontmatterTitle: '' }] },
  ],
  invalid: [
    {
      code: '# Heading 1\n\n<H1>Another H1</H1>\n\nH1\n==\n',
      errors: errorsAt('multipleH1', '3:1', '5:1'),
    },
    { code: '---\ntitle: My Title\n---\n\n# Heading 1', errors: errorsAt('multipleH1', '5:1') },
    {
      code: '---\nheading: My Title\n---\n\n# Heading 1',
      options: [{ frontmatterTitle: String.raw`^\s*heading\s*:` }],
      errors: errorsAt('multipleH1', '5:1'),
    },
  ],
})

ruleTester.run('max-heading-length', getRule('max-heading-length'), {
  valid: [`# ${'a'.repeat(80)}\n`, { code: '# Ten chars\n', options: [{ max: 10 }] }],
  invalid: [
    {
      code: `# ${'a'.repeat(81)}\n`,
      errors: [{ messageId: 'tooLong', data: { length: '81', max: '80' }, line: 1, column: 1 }],
    },
  ],
})

ruleTester.run('no-shell-dollars', getRule('no-shell-dollars'), {
  valid: [
    // Output after the commands
    '# T\n\n```sh\n$ npm install\nadded 1 package\n```\n',
    '# T\n\n```js\n$ a\n```\n',
    '# T\n\n```sh\n$HOME/bin/tool\n```\n',
  ],
  invalid: [
    {
      code: '# T\n\n```Bash\n$ npm install\n\n  $ npm test\n```\n',
      errors: [{ messageId: 'shellDollars', line: 3, column: 1, endLine: 7, endColumn: 4 }],
    },
  ],
})

ruleTester.run('no-emphasis-as-heading', getRule('no-emphasis-as-heading'), {
  valid: ['# T\n\n*Section*\n', '# T\n\n*Section* text\n\nText.\n', '# T\n\n**A**\n\n- Item\n'],
  invalid: [
    {
      code: '# T\n\n> **Section**\n>\n> Text.\n',
      errors: [{ messageId: 'emphasisAsHeading', data: { type: 'strong' }, line: 3, column: 3 }],
    },
  ],
})

ruleTester.run('no-shortcut-reference', getRule('no-shortcut-reference'), {
  valid: ['# T\n\n[a][] and [b][a] and ![a][]\n\n[a]: https://a.dev\n', '# T\n\n[a]\n'],
  invalid: [
    {
      code: '# T\n\nSee [a] and ![a].\n\n[a]: https://a.dev\n',
      output: '# T\n\nSee [a][] and ![a][].\n\n[a]: https://a.dev\n',
      errors: [...errorsAt('shortcutLink', '3:5'), ...errorsAt('shortcutImage', '3:13')],
    },
  ],
})

ruleTester.run('prefer-autolinks', getRule('prefer-autolinks'), {
  valid: [
    // Relative URLs, which `<…>` would make an HTML tag or text
    '[LICENSE](LICENSE) [#top](#top) [c:/a](c:/a)',
    // Characters that would end or break the autolink, or change the URL
    '| Link |\n| - |\n| [https://a.dev/x\\|y](https://a.dev/x\\|y) |',
    'See https://a.dev/?a=1&amp;b=2',
    '[the docs](https://a.dev) <https://a.dev>',
    '[https://a.dev][]\n\n[https://a.dev]: https://a.dev',
  ],
  invalid: [
    ['[https://a.dev](https://a.dev)', '<https://a.dev>', 'useAutolinkInsteadInlineLink'],
    ['See https://a.dev today', 'See <https://a.dev> today', 'useAutolinkInsteadGFMAutolink'],
  ].map(([code = '', output = '', messageId = '']) => ({
    code: `${code}\n`,
    output: `${output}\n`,
    errors: [{ messageId }],
  })),
})

test('the heading and reference rules scale linearly with the siblings of a node', () => {
  const linter = new Linter({ configType: 'flat' })
  const work = (count: number, rules: Linter.RulesRecord) =>
    countWork(() => {
      const config: Linter.Config = {
        files: ['**/*.md'],
        plugins: { '@gpahal/markdown': MARKDOWN_PLUGIN },
        language: '@gpahal/markdown/gfm',
        rules,
      }
      expect(linter.verify('*a*\n\n---\n\n'.repeat(count / 2), config, 'a.md')).toEqual([])
    })
  const rules: Linter.RulesRecord = Object.fromEntries(
    [
      'heading-increment',
      'no-emphasis-as-heading',
      'no-missing-label-refs',
      'no-missing-link-fragments',
    ].map((name) => [`@gpahal/markdown/${name}`, 'error']),
  )
  // Less the work of parsing. 4 times the siblings take 16 times the work in quadratic code
  const rulesWork = (count: number) => work(count, rules) - work(count, {})
  expect(rulesWork(8000)).toBeLessThan(6 * rulesWork(2000))
})

// `no-bare-urls` keeps the messages of the stock rule it runs
test.each(Object.keys(MARKDOWN_PLUGIN.rules ?? {}).filter((name) => name !== 'no-bare-urls'))(
  "`%s`'s messages quote with backticks and end without a period",
  (name) => {
    const messages = Object.values(getRule(name).meta?.messages ?? {})
    for (const message of messages) {
      expect(message.replaceAll(/`[^`]*`/g, '')).not.toMatch(/\.$|"/)
    }
  },
)

test("each rule's docs URL is a section of the README", async () => {
  const readme = await fs.readFile(path.join(import.meta.dirname, '..', 'README.md'), 'utf8')
  const slugger = new GithubSlugger()
  const anchors = readme
    .split('\n')
    .filter((line) => line.startsWith('#'))
    .map((line) => slugger.slug(line.replace(/^#+ /u, '')))
  const rules = [
    ...Object.entries(MARKDOWN_PLUGIN.rules ?? {}),
    ...Object.entries(GPAHAL_PLUGIN.rules),
  ]
  for (const [name, rule] of rules) {
    const url = typeof rule === 'function' ? undefined : rule.meta?.docs?.url
    expect(anchors, name).toContain(url?.split('#', 2)[1])
  }
})
