import process from 'node:process'

import stylelint, { type Config } from 'stylelint'

import { defineConfig } from '@/index'

import { fix, lintRules } from './helpers'

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
})
