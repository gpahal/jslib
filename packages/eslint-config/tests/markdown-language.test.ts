import markdown from '@eslint/markdown'
import { Linter } from 'eslint'
import type { Root } from 'mdast'
import type * as FromMarkdown from 'mdast-util-from-markdown'
import type { Node } from 'unist'
import { visit } from 'unist-util-visit'

import { GpahalMarkdownLanguage } from '@/internal/markdown/language'
import { MARKDOWN_PLUGIN } from '@/internal/markdown/plugin'

import { CORE_AREAS_OFF, createESLint, lintText, sharedESLint } from './helpers'

const parses = vi.hoisted(() => ({ count: 0 }))

// Counts the parses of this package's Markdown language and processor
vi.mock('mdast-util-from-markdown', async (importOriginal) => {
  const original = await importOriginal<typeof FromMarkdown>()
  return {
    ...original,
    fromMarkdown: (...args: Parameters<typeof original.fromMarkdown>) => {
      parses.count++
      return original.fromMarkdown(...args)
    },
  }
})

const language = new GpahalMarkdownLanguage()

/**
 * Markdown, without the core areas, whose only Markdown rule is `slop/no-em-dash`
 */
const OPTIONS = { ...CORE_AREAS_OFF, markdown: true } as const

function parse(text: string, languageOptions: Record<string, unknown> = {}): Root {
  const result = language.parse(
    { path: 'doc.md', physicalPath: 'doc.md', body: text, bom: false },
    { languageOptions: { ...language.defaultLanguageOptions, ...languageOptions } },
  )
  if (!result.ok) {
    throw new Error(`${text} doesn't parse`)
  }
  return result.ast
}

function typesOf(tree: Root, filter: (node: Node) => boolean = () => true): Array<string> {
  const types: Array<string> = []
  visit(tree, (node) => {
    if (filter(node)) {
      types.push(node.type)
    }
  })
  return types
}

describe('markdown language', () => {
  it('parses front matter, math and GFM', () => {
    expect(typesOf(parse('+++\ntitle = "A"\n+++\n\n# T\n'))).toContain('toml')
    const tree = parse(
      '---\ntitle: A\n---\n\n$x$ A[^a].\n\n$$\ny\n$$\n\n| a |\n| - |\n\n- [x] Done\n\n[^a]: Note\n',
      { math: true },
    )
    expect(typesOf(tree)).toEqual(
      expect.arrayContaining(['yaml', 'inlineMath', 'math', 'table', 'footnoteDefinition']),
    )
    const checked: Array<boolean | null | undefined> = []
    visit(tree, 'listItem', (node) => {
      checked.push(node.checked)
    })
    expect(checked).toEqual([true])
  })

  describe('text positions', () => {
    // GFM's transforms would split this text into nodes without positions, which the language
    // leaves out
    const LITERALS_IN_TEXT = [
      'Tom &amp; Jerry [https://a.dev] for more.\n',
      '- Item one\n  [see\n  https://a.dev] and more text\n',
      '> Quote [see\n> https://a.dev] and more text\n',
      '(docs)[https://example.com]\n',
      '<www.example.com>\n',
    ]

    it('are on every node', () => {
      for (const markdown of LITERALS_IN_TEXT) {
        expect(
          typesOf(parse(markdown), (node) => node.position === undefined),
          markdown,
        ).toEqual([])
      }
    })

    it('let --fix leave them as they are', async () => {
      const eslint = await createESLint('markdown', OPTIONS, { fix: true })
      for (const markdown of LITERALS_IN_TEXT) {
        const [result] = await eslint.lintText(`# T\n\n${markdown}`, { filePath: 'doc.md' })
        expect(result?.output, markdown).toBeUndefined()
      }
    })
  })

  it('reports nesting too deep to walk as a parse error rather than crash', async () => {
    const eslint = await sharedESLint('markdown', OPTIONS)
    const markdown = `# Title\n\n${'> '.repeat(2000)}x\n\n\`\`\`js\nvar a = 1\n\`\`\`\n`
    expect(await lintText(eslint, 'docs.md', markdown)).toEqual([
      'fatal: Parsing error: Markdown nested more than 1000 levels deep',
    ])
  })

  it('rejects JSON front matter', () => {
    expect(() => {
      language.validateLanguageOptions({ frontmatter: 'json' })
    }).toThrow(
      "@gpahal/eslint-config: `languageOptions.frontmatter`: expected `false`, `'yaml'`, `'toml'` or an array of `'yaml'` and `'toml'`, received `\"json\"`. JSON front matter isn't supported",
    )
    expect(() => {
      language.validateLanguageOptions({ frontmatter: ['yaml', 'toml'], math: false })
    }).not.toThrow()
  })

  describe('directive comments', () => {
    const linter = new Linter({ configType: 'flat' })
    const config: Linter.Config = {
      files: ['**/*.md'],
      plugins: { markdown, '@gpahal/markdown': MARKDOWN_PLUGIN },
      language: '@gpahal/markdown/gfm',
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: { 'markdown/no-empty-links': 'error' },
    }
    const DIRECTIVE = '<!-- eslint-disable markdown/no-empty-links -->'

    // mdast expands the part of a tab that a container's indent doesn't take into spaces in an
    // HTML node's value, so offsets into the value run past the comment in the source text
    it.each([
      ['a tab-indented list item', `- item\n\t${DIRECTIVE}\n`, '2:2', DIRECTIVE],
      ['a blockquote with a tab', `>\t${DIRECTIVE}\n`, '1:3', DIRECTIVE],
      [
        'a multi-line comment',
        '- item\n\t<!-- eslint-disable\n\tmarkdown/no-empty-links -->\n',
        '2:2',
        '<!-- eslint-disable\n\tmarkdown/no-empty-links -->',
      ],
      [
        'a paragraph',
        'Text <!-- eslint-disable-line markdown/no-empty-links --> more\n',
        '1:6',
        '<!-- eslint-disable-line markdown/no-empty-links -->',
      ],
    ])('are located in %s', (_name, text, location, comment) => {
      const messages = linter.verify(text, config, 'doc.md')
      expect(messages.map(({ line, column }) => `${String(line)}:${String(column)}`)).toEqual([
        location,
      ])
      const [{ fix } = {}] = messages
      expect(fix && text.slice(...fix.range)).toBe(comment)
    })
  })
})

describe('the Markdown parse', () => {
  it('runs once per file, shared by the processor and the language', async () => {
    const eslint = await sharedESLint('markdown', OPTIONS)
    const markdown = '# Title\n\n```js\nconst a = 1\na()\n```\n'
    // The first lint loads the configs
    await eslint.lintText(markdown, { filePath: 'first.md' })
    parses.count = 0
    const [result] = await eslint.lintText(`${markdown}\nText.\n`, { filePath: 'docs.md' })
    expect(result?.messages).toEqual([])
    expect(parses.count).toBe(1)
  })
})
