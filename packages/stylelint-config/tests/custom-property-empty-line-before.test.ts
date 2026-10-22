import process from 'node:process'

import stylelint from 'stylelint'

import { toArray } from '@gpahal/std/arrays'

import { defineConfig } from '@/index'

import { fix, lintRules } from './helpers'

const RULE = '@gpahal/custom-property-empty-line-before'

const STOCK_RULE = 'custom-property-empty-line-before'

const config = await defineConfig({ root: process.cwd() })

describe.each(['a.html', 'a.astro'])('custom-property-empty-line-before in %s', (file) => {
  it.each([
    ['a single custom property', '<div style="--progress: 50%"></div>\n'],
    [
      'a custom property after a declaration in a multi-line attribute',
      '<div\n  style="\n    color: red;\n    --progress: 50%;\n  "\n></div>\n',
    ],
  ])('leaves %s in a style attribute alone', async (_case, html) => {
    expect(await lintRules(html, config, file)).toEqual([])
    expect(await fix(html, config, file)).toBe(html)
  })

  it('still reports and fixes a <style> block', async () => {
    const html = '<style>\n  a {\n    color: red;\n    --b: 2;\n  }\n</style>\n'
    expect(await lintRules(html, config, file)).toEqual([RULE])
    expect(await fix(html, config, file)).toBe(
      '<style>\n  a {\n    color: red;\n\n    --b: 2;\n  }\n</style>\n',
    )
  })
})

describe('@gpahal/custom-property-empty-line-before', () => {
  it('removes an empty line it rejects', async () => {
    const never = await defineConfig({ root: process.cwd(), rules: { [STOCK_RULE]: 'never' } })
    expect(await fix('a {\r\n  color: red;\r\n\r\n  --b: 2;\r\n}\r\n', never)).toBe(
      'a {\r\n  color: red;\r\n  --b: 2;\r\n}\r\n',
    )
  })
})

describe('defineConfig with custom-property-empty-line-before', () => {
  it('takes an override of several file types that sets it, split where it merges differently', async () => {
    // `never` drops the preset's exceptions, so it merges over Markdown's `null` alike
    const overridden = await defineConfig({
      root: process.cwd(),
      overrides: [{ files: 'src/**', rules: { [STOCK_RULE]: 'never' } }],
    })
    expect(overridden.overrides!.at(-1)!.rules).toEqual({ [RULE]: 'never' })
    // `always` keeps the preset's exceptions, which Markdown's `null` doesn't have
    const split = await defineConfig({
      root: process.cwd(),
      overrides: [{ files: 'src/**', rules: { [STOCK_RULE]: 'always' } }],
    })
    const rulesOf = (glob: string) =>
      split.overrides!.find(({ files }) => toArray(files).some((file) => file.endsWith(glob)))
        ?.rules
    expect(rulesOf('src/**/*.@(md|markdown)')).toEqual({ [RULE]: 'always' })
    expect(rulesOf('src/**/!(*.@(astro|html|md|markdown)|*.module.css)')).toEqual({
      [RULE]: ['always', expect.objectContaining({ except: expect.any(Array) as unknown })],
    })
  })
})

test("reports a warning of the stock rule whose text it doesn't know, without a fix", async () => {
  const stockRule = await stylelint.rules[STOCK_RULE]
  const { messages } = stockRule
  // As after an upgrade that changes the stock rule's messages
  stockRule.messages = { expected: 'Changed', rejected: 'Changed too' }
  try {
    const css = 'a {\n  color: red;\n  --b: 2;\n}\n'
    const { results } = await stylelint.lint({ code: css, config })
    expect(results[0]?.warnings).toEqual([
      expect.objectContaining({
        rule: RULE,
        text: `Expected empty line before custom property (${RULE})`,
      }),
    ])
    expect(await fix(css, config)).toBe(css)
  } finally {
    stockRule.messages = messages
  }
})
