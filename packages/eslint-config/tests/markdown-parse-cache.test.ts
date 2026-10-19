import type * as FromMarkdown from 'mdast-util-from-markdown'

import { sharedESLint } from './helpers'

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

describe('the Markdown parse', () => {
  it('runs once per file, shared by the processor and the language', async () => {
    const eslint = await sharedESLint('markdown')
    const markdown = '# Title\n\n```js\nconst a = 1\na()\n```\n'
    // The first lint loads the configs
    await eslint.lintText(markdown, { filePath: 'first.md' })
    parses.count = 0
    const [result] = await eslint.lintText(`${markdown}\nText.\n`, { filePath: 'docs.md' })
    expect(result?.messages).toEqual([])
    expect(parses.count).toBe(1)
  })
})
