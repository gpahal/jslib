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
  it('passes a typical file', async () => {
    const eslint = await sharedESLint('toml')
    const [result] = await eslint.lintFiles(['wrangler.toml'])
    expect(result?.messages).toEqual([])
  })

  it('reports the layout, which Prettier leaves', async () => {
    const eslint = await sharedESLint('toml')
    expect(
      await problemsOf(eslint, 'x.toml', '[ package ]\nname  =  "a"\nkeys = [ "a" ]\n[bin]\n'),
    ).toEqual([
      '1:2 toml/table-bracket-spacing',
      '1:10 toml/table-bracket-spacing',
      '2:5 toml/key-spacing',
      '2:7 toml/key-spacing',
      '3:9 toml/array-bracket-spacing',
      '3:13 toml/array-bracket-spacing',
      '4:2 toml/padding-line-between-tables',
    ])
  })

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

test('`slop/no-em-dash` leaves TOML files out by default, as their text is often quoted', async () => {
  expect(await problemsOf(await sharedESLint('toml'), 'x.toml', 'name = "a \u{2014} b"\n')).toEqual(
    [],
  )
})
