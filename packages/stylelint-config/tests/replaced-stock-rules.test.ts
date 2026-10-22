import process from 'node:process'

import stylelint, { type Config } from 'stylelint'

import { defineConfig } from '@/index'

import { fix, lintRules, lintTexts, topLevelRules } from './helpers'

// The own rules that replace stock rules, under the stock names that configure them

const config = await defineConfig({ root: process.cwd() })

/**
 * `config` with `rules` set as under `extends`, where a rule you set replaces the preset's
 */
function extend(rules: Record<string, unknown>): Config {
  return { ...config, rules: { ...config.rules, ...rules } }
}

describe.each([
  [
    'font-family-name-quotes',
    ['always-unless-keyword'],
    'a {\n  font-family: Helvetica, serif;\n}\n',
    'a {\n  font-family: "Helvetica", serif;\n}\n',
  ],
  [
    'function-url-quotes',
    ['always', { except: ['empty'] }],
    'a {\n  background: url(a.png);\n}\n',
    'a {\n  background: url("a.png");\n}\n',
  ],
  ['import-notation', ['string'], '@import url("a.css");\n', '@import "a.css";\n'],
  [
    'declaration-empty-line-before',
    [
      'always',
      {
        except: ['after-declaration', 'first-nested'],
        ignore: ['after-comment', 'inside-single-line-block'],
      },
    ],
    'a {\n  b {\n    color: red;\n  }\n  color: red;\n}\n',
    'a {\n  b {\n    color: red;\n  }\n\n  color: red;\n}\n',
  ],
  [
    'custom-property-empty-line-before',
    ['always', { except: ['first-nested'] }],
    'a {\n  color: red;\n  --b: 2;\n}\n',
    'a {\n  color: red;\n\n  --b: 2;\n}\n',
  ],
] as const)('@gpahal/%s', (stock, options, css, fixed) => {
  const own = `@gpahal/${stock}`

  it('reports through the own rule by default', async () => {
    expect(await lintRules(css, config, 'a.css')).toEqual([own])
  })

  it('reports an invalid option under its own name, and checks nothing', async () => {
    const invalid = await defineConfig({ root: process.cwd(), rules: { [stock]: 'bogus' } })
    const { errored, results } = await stylelint.lint({ code: css, config: invalid })
    expect(errored).toBe(true)
    expect(results[0]?.invalidOptionWarnings).toEqual([
      { text: `Invalid option value "bogus" for rule "${own}"` },
    ])
    expect(results[0]?.warnings).toEqual([])
  })

  it('steps aside when you set the stock rule to options, which report once', async () => {
    const withStock = extend({ [stock]: options })
    expect(await lintRules(css, withStock, 'a.css')).toEqual([stock])
    expect(await fix(css, withStock, 'a.css')).toBe(fixed)
  })

  it('turns off when you set the own rule to null', async () => {
    const off = extend({ [own]: null })
    expect(await lintRules(css, off, 'a.css')).toEqual([])
    expect(await fix(css, off, 'a.css')).toBe(css)
  })

  /**
   * `css` with `comment` at the end of the line the own rule reports
   */
  async function withLineComment(comment: string): Promise<string> {
    const { results } = await stylelint.lint({ code: css, config })
    const line = results[0]!.warnings[0]!.line
    return css
      .split('\n')
      .map((text, index) => (index === line - 1 ? `${text} ${comment}` : text))
      .join('\n')
  }

  it.each([
    ['a line', stock],
    ['a block', stock],
    ['a block', own],
  ])('honors %s disable that names %s, without fixing', async (kind, name) => {
    const code =
      kind === 'a line'
        ? await withLineComment(`/* stylelint-disable-line ${name} -- why */`)
        : `/* stylelint-disable ${name} -- why */\n${css}/* stylelint-enable ${name} */\n`
    expect(await lintTexts(code, config)).toEqual([])
    expect(await fix(code, config)).toBe(code)
  })

  it('reports an unused disable that names the stock rule as needless', async () => {
    const code = `/* stylelint-disable-next-line ${stock} -- why */\n${fixed}`
    expect(await lintTexts(code, config)).toEqual([`Needless disable for "${stock}"`])
  })

  it('counts a disable that names both rules as used for each', async () => {
    const code = await withLineComment(`/* stylelint-disable-line ${stock}, ${own} -- why */`)
    expect(await lintTexts(code, config)).toEqual([])
    expect(await fix(code, config)).toBe(code)
  })

  // The row's options with a severity of `warning`
  const warned: [string, Record<string, unknown>] = [
    options[0],
    { ...options[1], severity: 'warning' },
  ]

  it('takes your setting of the stock rule, its severity included, and turns the stock rule off', async () => {
    const withStock = await defineConfig({ root: process.cwd(), rules: { [stock]: warned } })
    expect(topLevelRules(withStock)[stock]).toBeNull()
    const { results } = await stylelint.lint({ code: css, config: withStock })
    expect(results[0]?.warnings.map(({ rule, severity }) => ({ rule, severity }))).toEqual([
      { rule: own, severity: 'warning' },
    ])
  })

  it('moves an override setting of the stock rule to the own rule, where yours wins', async () => {
    const moved = topLevelRules(
      await defineConfig({ root: process.cwd(), rules: { [stock]: warned } }),
    )[own]
    const overridden = await defineConfig({
      root: process.cwd(),
      overrides: [
        { files: '*.css', rules: { [stock]: warned } },
        { files: '*.css', rules: { [stock]: warned, [own]: null } },
      ],
    })
    expect(overridden.overrides!.slice(-2).map(({ rules }) => rules)).toEqual([
      { [own]: moved },
      { [own]: null },
    ])
  })

  it('leaves an undefined own setting unset and keeps an explicit null', async () => {
    const moved = topLevelRules(
      await defineConfig({ root: process.cwd(), rules: { [stock]: warned } }),
    )[own]
    for (const setting of [undefined, null]) {
      const rules = { [stock]: warned, [own]: setting }
      const withBoth = await defineConfig({
        root: process.cwd(),
        rules,
        overrides: [{ files: '*.css', rules }],
      })
      const expected = setting === null ? null : moved
      expect(withBoth.rules?.[own], String(setting)).toEqual(expected)
      expect(withBoth.overrides!.at(-1)!.rules?.[own], String(setting)).toEqual(expected)
    }
  })
})
