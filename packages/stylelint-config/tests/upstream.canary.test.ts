// Canaries for the upstream bugs this package works around. Each runs the stock behaviour, without
// the workaround, and fails once the bug is fixed, naming the workaround to remove

import fs from 'node:fs'
import path from 'node:path'

import postcssHtml from 'postcss-html'
import stylelint, { type Config } from 'stylelint'

import { runNodeOk, withTmpProject } from '@gpahal/internal/node/testing'

import { BASE_RULES } from '@/internal/base-rules'

import { fix, lintRules } from './helpers'

function fixed(bug: string, workaround: string): string {
  return `upstream fixed ${bug}: remove ${workaround}`
}

/**
 * A config of one of `stylelint-config-standard`'s rules, as it sets it
 */
function standardRule(name: string): Config {
  return { rules: { [name]: BASE_RULES[name] } }
}

describe('upstream workarounds', () => {
  it('masks a rejected awaited config export with a require error', async () => {
    await using project = await withTmpProject('stylelint-config-await-error', {
      'stylelint.config.mjs':
        "export default await Promise.reject(new Error('config validation failed'))",
    })
    await expect(
      stylelint.lint({
        code: 'a { color: red; }',
        configFile: path.join(project.dir, 'stylelint.config.mjs'),
      }),
      fixed(
        'cosmiconfig masking awaited export errors',
        "the README note on exporting without `await`, and the promise exports of the recipes and of consumer.test.ts's rejected-option fixtures",
      ),
    ).rejects.toMatchObject({ code: 'ERR_REQUIRE_ASYNC_MODULE' })
  })

  it("function-no-unknown: reports `@font-face`'s `tech()`", async () => {
    const { results } = await stylelint.lint({
      code: "@font-face {\n  src: url('a.woff2') tech(variations);\n}\n",
      config: { rules: { 'function-no-unknown': true } },
    })
    expect(
      results.flatMap((result) => result.warnings.map((warning) => warning.text)),
      fixed(
        "function-no-unknown's unknown `tech()`",
        "`ignoreFunctions: ['tech']` in src/internal/preset-rules.ts",
      ),
    ).toEqual(['Unknown function "tech" (function-no-unknown)'])
  })

  it.each([
    ['property-no-vendor-prefix', 'a {\n  -webkit-user-select: none;\n  user-select: none;\n}\n'],
    ['value-no-vendor-prefix', 'a {\n  display: -webkit-flex;\n  display: flex;\n}\n'],
  ])('%s: the fix duplicates the unprefixed declaration', async (rule, css) => {
    const fixedCss = await fix(css, standardRule(rule))
    expect(
      fixedCss.split('\n').filter((line) => line === css.split('\n').at(-3)),
      fixed(`${rule}'s duplicate`, `its disableFix in src/internal/preset-rules.ts`),
    ).toHaveLength(2)
  })

  it.each([
    [
      'font-family-name-quotes',
      'always-unless-keyword',
      'a {\n  font-family: Inter Variable;\n}\n',
    ],
    ['function-url-quotes', 'always', 'a {\n  background: url(a.png);\n}\n'],
    ['import-notation', 'string', '@import url(a.css);\n'],
  ])('%s: the fix writes double quotes', async (rule, primary, css) => {
    expect(
      await fix(css, { rules: { [rule]: primary } }),
      fixed(
        `${rule}'s double quotes`,
        `@gpahal/${rule} and its QUOTE_OWN_RULES entry in src/internal/quote-rules.ts`,
      ),
    ).toContain('"')
  })

  it('font-family-name-quotes: the fix ends a double-quoted style attribute early', async () => {
    const config: Config = {
      rules: { 'font-family-name-quotes': 'always-unless-keyword' },
      customSyntax: postcssHtml,
    }
    expect(
      await fix('<div style="font-family: Inter Variable"></div>\n', config, 'a.html'),
      fixed(
        "postcss-html's unescaped quotes in style attributes",
        'the own quote rules of QUOTE_OWN_RULES in src/internal/quote-rules.ts',
      ),
    ).toBe('<div style="font-family: "Inter Variable""></div>\n')
  })

  it("media-feature-range-notation: the fix leaves the operator's spacing", async () => {
    expect(
      await fix('@media (max-width:1023.98px) {}\n', standardRule('media-feature-range-notation')),
      fixed(
        "media-feature-range-notation's spacing",
        'the wait for it in src/internal/media-range-spacing.ts',
      ),
    ).toBe('@media (width <=1023.98px) {}\n')
  })

  it('custom-property-empty-line-before: the fix deletes the blank lines in @theme', async () => {
    expect(
      await fix(
        '@theme {\n  --font-sans: sans-serif;\n\n  --shadow-xs: 0 1px 2px;\n}\n',
        standardRule('custom-property-empty-line-before'),
      ),
      fixed(
        "custom-property-empty-line-before's fix in @theme",
        'turning it off in src/internal/tailwindcss.ts',
      ),
    ).toBe('@theme {\n  --font-sans: sans-serif;\n  --shadow-xs: 0 1px 2px;\n}\n')
  })

  it('custom-property-empty-line-before: reports the custom property of a style attribute', async () => {
    const config: Config = {
      ...standardRule('custom-property-empty-line-before'),
      customSyntax: postcssHtml,
    }
    expect(
      await lintRules('<div style="--progress: 50%"></div>\n', config, 'a.html'),
      fixed(
        "custom-property-empty-line-before's report in style attributes",
        'src/internal/custom-property-empty-line-before.ts and its wiring in src/internal/define.ts',
      ),
    ).toEqual(['custom-property-empty-line-before'])
  })

  it('overrides: an override applies when any of its globs matches, so a `!` glob matches the rest', async () => {
    const config: Config = {
      rules: { 'color-no-invalid-hex': true },
      overrides: [{ files: ['src/**', '!src/legacy/**'], rules: { 'color-named': 'never' } }],
    }
    const css = 'a {\n  color: red;\n}\n'
    expect(
      await lintRules(css, config, path.join(process.cwd(), 'src/legacy/a.css')),
      fixed(
        "the any-of matching of an override's globs",
        'the `!` glob check in checkOverrides in src/internal/options.ts',
      ),
    ).toEqual(['color-named'])
  })

  it('postcss-markdown: loads postcss-html by name from the working directory', async () => {
    // A `postcss-html` that only the working directory sees, which marks where it was loaded from
    await using project = await withTmpProject('stylelint-config-md', {
      'node_modules/postcss-html/package.json': JSON.stringify({
        name: 'postcss-html',
        main: 'index.cjs',
      }),
      'node_modules/postcss-html/index.cjs':
        "module.exports = { parse() { throw new Error('fake postcss-html') }, stringify() {} }\n",
    })
    const script = [
      `const { default: postcssMarkdown } = await import(${JSON.stringify(import.meta.resolve('postcss-markdown'))})`,
      'try {',
      String.raw`  postcssMarkdown().parse('<style>\na {}\n</style>\n', { from: 'a.md' })`,
      "  console.log('real')",
      '} catch (error) {',
      '  console.log(error.message)',
      '}',
    ].join('\n')
    const stdout = await runNodeOk(['--input-type=module', '--eval', script], {
      cwd: project.dir,
    })
    expect(
      stdout.trim(),
      fixed(
        "postcss-markdown's loading by name",
        'MARKDOWN_SYNTAXES in src/internal/file-types.ts',
      ),
    ).toBe('fake postcss-html')
  })

  it("fs.promises.glob: a wildcard segment doesn't match through a symlinked folder", async () => {
    await using project = await withTmpProject('stylelint-config-glob-links', {
      'only/o.css': 'a {}\n',
    })
    fs.mkdirSync(path.join(project.dir, 'deep'))
    fs.symlinkSync('../only', path.join(project.dir, 'deep/l'))
    // Not `Array.fromAsync`, which is newer than the ES2024 lib
    const iterator = fs.promises.glob('deep/*/o.css', { cwd: project.dir })[Symbol.asyncIterator]()
    const matches: Array<string> = []
    for (let step = await iterator.next(); step.done !== true; step = await iterator.next()) {
      matches.push(step.value)
    }
    expect(
      matches,
      fixed(
        "fs.promises.glob's skipping of symlinked folders",
        'matchesThroughFolderLinks and walkFolder in src/internal/paths.ts, and the README note on the walk',
      ),
    ).toEqual([])
  })

  it('declaration-property-value-no-unknown: reports sibling-index() and sibling-count()', async () => {
    const { results } = await stylelint.lint({
      code: '.a {\n  z-index: sibling-index();\n  order: sibling-count();\n}\n',
      config: { rules: { 'declaration-property-value-no-unknown': true } },
    })
    expect(
      results.flatMap((result) => result.warnings.map((warning) => warning.rule)),
      fixed(
        "css-tree's missing sibling-index() and sibling-count()",
        'the README note on sibling-index() and sibling-count()',
      ),
    ).toEqual(['declaration-property-value-no-unknown', 'declaration-property-value-no-unknown'])
  })
})

describe('upstream contracts', () => {
  it('plugin rules: the stock rules are built-ins, and a plugin rule name without `/` is rejected', async () => {
    // So the own rules that replace custom-property-empty-line-before and
    // declaration-empty-line-before take names of their own, and honor disable comments that name
    // the stock rules through src/internal/stock-disables.ts
    const workaround = 'isDisabledByStockRule in src/internal/stock-disables.ts'
    expect(
      stylelint.rules,
      fixed("custom-property-empty-line-before's built-in name", workaround),
    ).toHaveProperty('custom-property-empty-line-before')
    expect(
      stylelint.rules,
      fixed("declaration-empty-line-before's built-in name", workaround),
    ).toHaveProperty('declaration-empty-line-before')
    const plugin = stylelint.createPlugin(
      'declaration-empty-line-before',
      await stylelint.rules['declaration-empty-line-before'],
    )
    await expect(
      stylelint.lint({
        code: 'a {}\n',
        config: { plugins: [plugin], rules: { 'declaration-empty-line-before': 'always' } },
      }),
      fixed('the namespace requirement of plugin rule names', workaround),
    ).rejects.toThrow('stylelint requires plugin rules to be namespaced')
  })
})
