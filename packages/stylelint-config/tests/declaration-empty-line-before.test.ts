import process from 'node:process'

import postcss, { type Root } from 'postcss'
import postcssHtml from 'postcss-html'
import stylelint, { type Config, type CustomSyntax } from 'stylelint'

import { defineConfig } from '@/index'
import { declarationEmptyLineBefore } from '@/internal/declaration-empty-line-before'

import { fix, lintRules } from './helpers'

const RULE = '@gpahal/declaration-empty-line-before'

const STOCK_RULE = 'declaration-empty-line-before'

/**
 * stylelint-config-standard's setting of `declaration-empty-line-before`
 */
const STANDARD_SETTING = [
  'always',
  {
    except: ['after-declaration', 'first-nested'],
    ignore: ['after-comment', 'inside-single-line-block'],
  },
]

/**
 * Cases from the stock rule's own tests, which the rule must report and fix as the stock rule does
 */
const CASES = [
  'a { color: pink; top: 0; }',
  'a {\n\n  color: pink;\n}',
  'a {\n  color: pink;\n  top: 0;\n}',
  'a {\n  color: pink;\n\n\n  top: 0;\n}',
  'a {\r\n  color: pink;\r\n\r\n  top: 0;\r\n}',
  'a {\n  --custom: pink;\n  top: 0;\n}',
  'a {\n  /* comment */\n\n  top: 0;\n}',
  'a {\n  color: pink; /* comment */\n\n  top: 0;\n}',
  'a {\n  b {\n    color: pink;\n  }\n  top: 0;\n}',
  'a {\n  @media screen {\n\n    color: pink;\n  }\n\n  top: 0;\n}',
  'a {\n  $var: 1;\n  top: 0;\n}',
  'color: pink;\n\ntop: 0;',
]

/**
 * Settings from the stock rule's own tests
 */
const SETTINGS: ReadonlyArray<unknown> = [
  'never',
  STANDARD_SETTING,
  ['always', { except: ['after-block', 'after-comment'] }],
  ['never', { except: ['after-declaration'], ignore: ['first-nested', 'after-comment'] }],
]

/**
 * A syntax that parses CSS into the nodes postcss-less gives a Less map, `@map: { ... }`, and an
 * `&:extend(...)`, which the rule must skip as the stock rule does
 */
const LESS_LIKE_SYNTAX: CustomSyntax = {
  parse: (css, options) => {
    const root: Root = postcss.parse(css, options)
    root.walkAtRules((atRule) => {
      if (!atRule.name.endsWith(':')) {
        return
      }

      atRule.name = atRule.name.slice(0, -1)
      atRule.raws.afterName = ':'
    })
    root.walkDecls('&', (decl) => {
      Object.assign(decl, { extend: true })
    })
    return root
  },
  stringify: postcss.stringify,
}

/**
 * Code with declarations that aren't standard syntax: Sass nested properties, a Less namespace
 * mixin, a Less map and a Less `&:extend(...)`
 */
const NON_STANDARD_CASES = [
  'a {\n  color: pink;\n  border: {\n    style: solid;\n\n    color: red;\n  }\n  top: 0;\n}',
  '#ns() {\n  color: pink;\n\n  top: 0;\n}\n#ns() {\n\n  color: pink;\n}',
  '@map: {\n  color: pink;\n\n  top: 0;\n}\na {\n  @map: {\n\n    color: pink;\n  }\n}',
  'a {\n  color: pink;\n\n  &:extend(.b);\n\n  top: 0;\n}',
]

/**
 * The reports and the fixed code of `rule` with `setting`, with its name left out of the messages
 */
async function run(rule: string, setting: unknown, code: string, customSyntax?: CustomSyntax) {
  const config: Config = {
    plugins: [declarationEmptyLineBefore],
    rules: { [rule]: setting },
    ...(customSyntax !== undefined && { customSyntax }),
  }
  const { results } = await stylelint.lint({ code, config })
  const warnings = results.flatMap((result) =>
    result.warnings.map(({ line, column, endLine, endColumn, text }) => ({
      line,
      column,
      endLine,
      endColumn,
      text: text.replace(` (${rule})`, ''),
    })),
  )
  const invalid = results.flatMap((result) =>
    result.invalidOptionWarnings.map(({ text }) => text.replaceAll(rule, '<rule>')),
  )
  const { code: fixed } = await stylelint.lint({ code, config, fix: true })
  return { warnings, invalid, fixed }
}

describe('@gpahal/declaration-empty-line-before', () => {
  describe('in a multi-line style attribute, as Prettier wraps a long one', () => {
    const html = '<div\n  style="\n    --progress: 50%;\n    color: red;\n  "\n></div>\n'

    // postcss-html parses the attribute as a root of its own, where a declaration after a custom
    // property is neither `after-declaration` nor `first-nested`
    it.each([false, true])(
      'gets no empty line before a declaration after a custom property with tailwindcss=%s',
      async (tailwindcss) => {
        const config = await defineConfig({ root: process.cwd(), tailwindcss })
        expect(await lintRules(html, config, 'a.html')).toEqual([])
        expect(await fix(html, config, 'a.html')).toBe(html)
      },
    )
  })

  it.each(SETTINGS)('reports and fixes as the stock rule does, with %j', async (setting) => {
    for (const code of CASES) {
      expect(await run(RULE, setting, code), code).toEqual(await run(STOCK_RULE, setting, code))
    }
  })

  it('reports and fixes as the stock rule does in HTML <style> blocks, and skips style attributes', async () => {
    const code =
      '<style>\n  a {\n    color: pink;\n\n    top: 0;\n  }\n</style>\n<style>color: pink;\ntop: 0;</style>\n'
    expect(await run(RULE, 'never', code, postcssHtml)).toEqual(
      await run(STOCK_RULE, 'never', code, postcssHtml),
    )
    const attributes =
      '<a style="color: pink;\n\ntop: 0"></a>\n<a style="color: pink;\ntop: 0"></a>\n'
    expect(await run(RULE, 'never', attributes, postcssHtml)).toEqual({
      warnings: [],
      invalid: [],
      fixed: attributes,
    })
  })

  it.each(SETTINGS)(
    'skips declarations that are not standard syntax as the stock rule does, with %j',
    async (setting) => {
      for (const code of NON_STANDARD_CASES) {
        expect(await run(RULE, setting, code, LESS_LIKE_SYNTAX), code).toEqual(
          await run(STOCK_RULE, setting, code, LESS_LIKE_SYNTAX),
        )
      }
    },
  )

  it('rejects an invalid option as the stock rule does', async () => {
    const setting = ['always', { except: ['after-apply'] }]
    const own = await run(RULE, setting, 'a {\n  color: pink;\n}')
    expect(own.invalid).not.toEqual([])
    expect(own).toEqual(await run(STOCK_RULE, setting, 'a {\n  color: pink;\n}'))
  })

  it('needs no empty line before a declaration after @apply, unlike the stock rule', async () => {
    const code = 'a {\n  @apply font-bold; /* Why */\n  color: red;\n}'
    expect((await run(RULE, STANDARD_SETTING, code)).warnings).toEqual([])
    expect((await run(STOCK_RULE, STANDARD_SETTING, code)).warnings).not.toEqual([])
  })

  it('treats a comment on its own line after @apply as the stock rule does', async () => {
    const setting = ['always', { except: ['after-declaration'] }]
    const code = 'a {\n  @apply font-bold;\n  /* Why */\n  color: red;\n}'
    const own = await run(RULE, setting, code)
    expect(own.warnings).not.toEqual([])
    expect(own).toEqual(await run(STOCK_RULE, setting, code))
  })
})

describe('defineConfig with declaration-empty-line-before', () => {
  const repro = 'a {\n  @apply font-bold;\n  color: red;\n}\n'

  it('exempts a declaration after @apply under Tailwind CSS', async () => {
    const config = await defineConfig({ root: process.cwd(), tailwindcss: true })
    expect(await lintRules(repro, config)).toEqual([])
    const afterBlock = 'a {\n  b {\n    color: red;\n  }\n  color: red;\n}\n'
    expect(await lintRules(afterBlock, config)).toEqual([RULE])
    expect(await fix(afterBlock, config)).toBe(
      'a {\n  b {\n    color: red;\n  }\n\n  color: red;\n}\n',
    )
  })

  it("gives an override back on the preset's always its exceptions, which your never drops", async () => {
    const config = await defineConfig({
      root: process.cwd(),
      tailwindcss: true,
      rules: { [STOCK_RULE]: 'never' },
      overrides: [
        { files: 'legacy/**', rules: { [STOCK_RULE]: ['always', { severity: 'warning' }] } },
      ],
    })
    expect(config.overrides!.at(-1)!.rules).toEqual({
      [RULE]: [
        'always',
        {
          except: ['after-declaration', 'first-nested'],
          ignore: ['after-comment', 'inside-single-line-block'],
          severity: 'warning',
        },
      ],
    })
  })
})
