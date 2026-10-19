import process from 'node:process'

import stylelint from 'stylelint'

import { toArray } from '@gpahal/std/arrays'

import { defineConfig } from '@/index'
import { BASE_RULES } from '@/internal/base-rules'

import { fix, lintRules, lintTexts, topLevelRules } from './helpers'

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
  it('reports under its own name, with its severity, and keeps its disable comments', async () => {
    const css = 'a {\n  color: red;\n  --b: 2;\n}\n'
    const warned = await defineConfig({
      root: process.cwd(),
      rules: { [STOCK_RULE]: ['always', { severity: 'warning' }] },
    })
    const { results } = await stylelint.lint({ code: css, config: warned })
    expect(results[0]?.warnings).toEqual([
      expect.objectContaining({
        rule: RULE,
        severity: 'warning',
        text: `Expected empty line before custom property (${RULE})`,
      }),
    ])
    const disabled = `/* stylelint-disable ${RULE} -- shows the layout */\n${css}`
    expect(await lintRules(disabled, config)).toEqual([])
    expect(await fix(disabled, config)).toBe(disabled)
  })

  it('removes an empty line it rejects', async () => {
    const never = await defineConfig({ root: process.cwd(), rules: { [STOCK_RULE]: 'never' } })
    expect(await fix('a {\r\n  color: red;\r\n\r\n  --b: 2;\r\n}\r\n', never)).toBe(
      'a {\r\n  color: red;\r\n  --b: 2;\r\n}\r\n',
    )
  })
})

describe('@gpahal/custom-property-empty-line-before with stock-name disable comments', () => {
  const css = 'a {\n  color: red;\n  --b: 2;\n}\n'

  it.each([
    [
      'next line',
      `a {\n  color: red; /* stylelint-disable-next-line ${STOCK_RULE} -- why */\n  --b: 2;\n}\n`,
    ],
    [
      'block',
      `/* stylelint-disable ${STOCK_RULE} -- why */\n${css}/* stylelint-enable ${STOCK_RULE} */\n`,
    ],
  ])('honors a %s disable that names the stock rule', async (_case, code) => {
    expect(await lintRules(css, config)).toEqual([RULE])
    expect(await lintTexts(code, config)).toEqual([])
    expect(await fix(code, config)).toBe(code)
  })

  it('reports an unused stock-name disable as needless', async () => {
    const code = `/* stylelint-disable-next-line ${STOCK_RULE} -- why */\na {\n  color: red;\n}\n`
    expect(await lintTexts(code, config)).toEqual([`Needless disable for "${STOCK_RULE}"`])
  })

  it('counts a disable that names both rules as used for each', async () => {
    const code = `a {\n  color: red; /* stylelint-disable-next-line ${STOCK_RULE}, ${RULE} -- why */\n  --b: 2;\n}\n`
    expect(await lintTexts(code, config)).toEqual([])
    expect(await fix(code, config)).toBe(code)
  })
})

describe('defineConfig with custom-property-empty-line-before', () => {
  it("gives the own rule stylelint-config-standard's setting of the stock rule", () => {
    expect(topLevelRules(config)).toMatchObject({
      [STOCK_RULE]: null,
      [RULE]: BASE_RULES[STOCK_RULE],
    })
  })

  it('turns the stock rule off for the own rule, which takes your setting of it', async () => {
    const withNever = await defineConfig({ root: process.cwd(), rules: { [STOCK_RULE]: 'never' } })
    expect(topLevelRules(withNever)).toMatchObject({ [STOCK_RULE]: null, [RULE]: 'never' })
    const css = 'a {\n  color: red;\n\n  --b: 2;\n}\n'
    expect(await lintRules(css, withNever, 'a.css')).toEqual([RULE])
    expect(await lintRules(css, config, 'a.css')).toEqual([])
  })

  it('moves an override setting of the stock rule to the own rule, where yours wins', async () => {
    const overridden = await defineConfig({
      root: process.cwd(),
      overrides: [
        { files: '*.css', rules: { [STOCK_RULE]: 'never' } },
        { files: '*.css', rules: { [STOCK_RULE]: 'never', [RULE]: null } },
      ],
    })
    expect(overridden.overrides!.slice(-2).map(({ rules }) => rules)).toEqual([
      { [RULE]: 'never' },
      { [RULE]: null },
    ])
  })

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
