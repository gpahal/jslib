import type { ESLint } from 'eslint'

import { sharedESLint } from './helpers'

/**
 * The problems of `code` linted as `filePath` in the `toml` fixture, as `line:column rule`
 */
async function problemsOf(eslint: ESLint, filePath: string, code: string): Promise<Array<string>> {
  const results = await eslint.lintText(code, { filePath })
  return results.flatMap((result) =>
    result.messages.map(
      (message) =>
        `${String(message.line)}:${String(message.column)} ${message.ruleId ?? message.message}`,
    ),
  )
}

describe('the toml area', () => {
  it('lints a ```toml code block in Markdown', async () => {
    const eslint = await sharedESLint('toml')
    const block = ['```toml', 'name  =  "a"', '```']
    expect(await problemsOf(eslint, 'docs.md', ['# Title', '', ...block, ''].join('\n'))).toEqual([
      '4:5 toml/key-spacing',
      '4:7 toml/key-spacing',
    ])
  })

  it('lints no TOML file with `toml: false`', async () => {
    const eslint = await sharedESLint('toml', { toml: false })
    expect(await eslint.calculateConfigForFile('wrangler.toml')).toBeUndefined()
    expect(
      await problemsOf(
        eslint,
        'docs.md',
        ['# Title', '', '```toml', 'a  =  1', '```', ''].join('\n'),
      ),
    ).toEqual([])
  })
})
