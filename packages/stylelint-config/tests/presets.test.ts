import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import stylelint from 'stylelint'
import type { Config } from 'stylelint'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'

import { fix, lintRules } from './helpers'

const baseConfig = await defineConfig({ root: process.cwd() })
const tailwindcssConfig = await defineConfig({ root: process.cwd(), tailwindcss: true })

async function lint(code: string, config: Config = tailwindcssConfig) {
  const { results } = await stylelint.lint({ code, config })
  return results.flatMap((result) => [
    ...result.warnings.map((warning) => `${warning.rule}: ${warning.text}`),
    ...result.invalidOptionWarnings.map((warning) => `invalid option: ${warning.text}`),
  ])
}

/**
 * The path of a file of the installed `tailwindcss` package
 */
function tailwindcssFile(name: string) {
  const packageJson = fileURLToPath(import.meta.resolve('tailwindcss/package.json'))
  return path.join(path.dirname(packageJson), name)
}

test.each(['theme.css', 'preflight.css', 'utilities.css'])(
  "the tailwindcss preset accepts Tailwind's own %s",
  async (name) => {
    // Turns off the rules about code style, whose choices Tailwind's files don't share, such as the
    // property order and comment layout. The rest must accept Tailwind's syntax and conventions
    const config = await defineConfig({
      root: process.cwd(),
      tailwindcss: true,
      rules: {
        '@gpahal/comment-layout': null,
        'order/properties-order': null,
        'declaration-empty-line-before': null,
        'property-no-vendor-prefix': null,
        'declaration-property-value-keyword-no-deprecated': null,
      },
    })
    // Without the file's name, which Stylelint would ignore for being in `node_modules`
    const { results } = await stylelint.lint({
      code: await fs.readFile(tailwindcssFile(name), 'utf8'),
      config,
    })
    expect(results[0]!.ignored).toBeFalsy()
    expect(
      results[0]!.warnings
        .filter((warning) => warning.severity === 'error')
        .map((warning) => warning.text),
    ).toEqual([])
  },
)

test.each([
  ['--text-tiny--line-height', true],
  ['--color-*', true],
  [String.raw`--spacing-1\.5--line-height`, true],
  ['--colorRed', false],
  ['--color---red', false],
])('takes the custom property %s as kebab-case: %j', async (name, valid) => {
  expect(await lintRules(`:root {\n  ${name}: initial;\n}\n`, tailwindcssConfig)).toEqual(
    valid ? [] : ['custom-property-pattern'],
  )
})

test.each([
  // Where `declaration-property-value-no-unknown` doesn't look: custom properties, `@theme` and
  // values with a Tailwind function
  [':root {\n  --brand: #ff00zz;\n}\n', 'color-no-invalid-hex'],
  ['a {\n  margin: --spacing(4) 10pxx;\n}\n', 'unit-no-unknown'],
])('reports invalid values that the value check skips: %s', async (css, rule) => {
  expect(await lintRules(css, tailwindcssConfig)).toEqual([rule])
})

/**
 * Whether `code` errors with the base preset, and the rules it reports, with or without `--quiet`
 */
async function lintQuiet(code: string, quiet: boolean) {
  const { errored, results } = await stylelint.lint({ code, config: baseConfig, quiet })
  return {
    errored,
    rules: results.flatMap((result) => result.warnings.map((warning) => warning.rule)),
  }
}

test('reports disable comments without a reason, that disable nothing or a rule that is off', async () => {
  const config = await defineConfig({ root: process.cwd(), rules: { 'color-named': 'never' } })
  expect(
    await lint('/* stylelint-disable-next-line color-named */\na { color: red; }\n', config),
  ).toEqual([
    '--report-descriptionless-disables: Disable for "color-named" is missing a description',
  ])
  expect(
    await lint(
      '/* stylelint-disable-next-line color-named -- reason */\na { color: red; }\n',
      config,
    ),
  ).toEqual([])
  expect(
    await lint(
      '/* stylelint-disable-next-line color-no-hex -- reason */\na {\n  color: #fff;\n}\n',
      config,
    ),
  ).toEqual([
    expect.stringMatching(/^--report-needless-disables: /),
    expect.stringMatching(/^--report-invalid-scope-disables: /),
  ])
  // A needless disable stays an error under `--quiet`, except one of plugin/use-baseline, whose
  // warnings `--quiet` leaves out
  const needless =
    'a {\n  /* stylelint-disable-next-line color-hex-length -- Brand color */\n  color: #f00;\n}\n'
  const useBaseline =
    'a {\n  /* stylelint-disable-next-line plugin/use-baseline -- Progressive enhancement */\n  reading-flow: grid-order;\n}\n'
  for (const quiet of [true, false]) {
    expect(await lintQuiet(needless, quiet), String(quiet)).toEqual({
      errored: true,
      rules: ['--report-needless-disables'],
    })
    expect(await lintQuiet(useBaseline, quiet), String(quiet)).toEqual({
      errored: false,
      rules: [],
    })
  }
})

const BOM = String.fromCodePoint(0xfe_ff)

test("the preset's fixes keep CRLF line endings and a BOM, and settle in one pass", async () => {
  const code = `${BOM}/* CRLF\r\n   comment */\r\na {\r\n  color: red;\r\n\r\n  margin: 0;\r\n}\r\n\r\n@media (width>=1px) {\r\n  a {\r\n    --x: 1;\r\n\r\n    --y: 2;\r\n  }\r\n}\r\n`
  const once = await fix(code, baseConfig)
  expect(once.startsWith(BOM)).toBe(true)
  expect(/(?<!\r)\n/.test(once)).toBe(false)
  expect(once).toContain('/*\r\n * CRLF\r\n * comment\r\n */')
  expect(once).toContain('@media (width >= 1px)')
  expect(await fix(once, baseConfig)).toBe(once)
})

const COLLATOR = new Intl.Collator('en')

describe('quote fixes', () => {
  const css = [
    '@import url(b.css);',
    '',
    'a {',
    '  font-family: Helvetica, Arial;',
    '}',
    '',
    'b {',
    '  background: url(x.png);',
    '}',
    '',
  ].join('\n')

  const fixed = css
    .replace('url(b.css)', '"b.css"')
    .replace('Helvetica, Arial', '"Helvetica", "Arial"')
    .replace('url(x.png)', 'url("x.png")')

  it('apply in CSS files', async () => {
    expect(await fix(css, baseConfig, 'src/a.css')).toBe(fixed)
  })

  // `.astro` files parse with postcss-html, as `.html` files do
  it.each(['src/page.html', 'src/doc.md'])(
    'apply in a <style> block of %s, and only report in a style attribute, which double quotes can end',
    async (file) => {
      const attribute = '<p style="font-family: Helvetica; background: url(x.png)"></p>\n'
      const page = `${attribute}\n<style>\n${css}</style>\n`
      // The attribute's two problems, and the block's five
      expect(
        (await lintRules(page, baseConfig, file))
          .filter((rule) => /quotes|notation/.test(rule))
          .toSorted((a, b) => COLLATOR.compare(a, b)),
      ).toEqual([
        ...Array.from({ length: 3 }, () => '@gpahal/font-family-name-quotes'),
        ...Array.from({ length: 3 }, () => '@gpahal/function-url-quotes'),
        '@gpahal/import-notation',
      ])
      expect(await fix(page, baseConfig, file)).toBe(`${attribute}\n<style>\n${fixed}</style>\n`)
    },
  )
})

test.each([
  "@import 'tailwindcss' source(none) prefix(tw) important theme(static);",
  "@source not inline('{hover:,}bg-red-{50,{100..900..100},950}');",
  '@theme default inline reference prefix(tw) {\n  --color-x: red;\n}',
  '@utility tab-* {\n  color: --default(red);\n  tab-size: --value(--tab-size-*, integer);\n  opacity: --modifier(integer);\n}',
  // A name that starts with a digit, as breakpoints such as `3xl` do
  '@custom-variant 3xl (@media (width >= 120rem));',
  'a {\n  @variant hover:focus {\n    color: red;\n  }\n}',
  'a {\n  @apply font-bold! md:w-1/2 [&>*]:p-4;\n}',
  'a {\n  margin: theme(spacing[2.5]);\n  color: theme(colors.red.500);\n}',
  'a {\n  color: --alpha(var(--color-red-500) / 50%);\n  background: theme(--color-missing, red);\n}',
  '@media (width >= theme(--breakpoint-md)) {\n  a {\n    color: red;\n  }\n}',
  '@tailwind utilities source(none);',
  'a {\n  color: red;\n  @apply font-bold;\n}',
])('the tailwindcss preset accepts Tailwind syntax: %s', async (css) => {
  expect(await lint(`${css}\n`)).toEqual([])
})

test.each([
  ['a {\n  color: --alpha(red);\n}\n', 'declaration-property-value-no-unknown'],
  // Tailwind CSS v3's
  ['@tailwind base;\n', 'at-rule-prelude-no-invalid'],
])(
  'the tailwindcss preset checks the syntax of Tailwind functions and at-rules: %s',
  async (css, rule) => {
    expect(await lintRules(css, tailwindcssConfig)).toEqual([rule])
  },
)

test('a value with a Tailwind function skips value checks, so a typo in it passes', async () => {
  expect(await lint('a {\n  margin: --spacing(4) blargh;\n}\n')).toEqual([])
})

async function lintAstro(code: string) {
  return lintRules(code, tailwindcssConfig, 'src/page.astro')
}

test("the tailwindcss preset keeps the case of theme() paths and --theme() variables, which --fix doesn't lowercase", async () => {
  const css =
    '.a {\n  font-size: theme(fontSize.sm);\n  line-height: theme(lineHeight.tight);\n  width: --theme(--Width);\n}\n'
  for (const file of ['src/a.css', 'src/a.module.css']) {
    expect(await lintRules(css, tailwindcssConfig, file)).not.toContain('value-keyword-case')
    expect(await fix(css, tailwindcssConfig, file)).toBe(css)
    expect(await fix('.a {\n  color: currentColor;\n}\n', tailwindcssConfig, file)).toBe(
      '.a {\n  color: currentcolor;\n}\n',
    )
  }
  // CSS Modules' own exceptions stay
  const composes = ".a {\n  composes: fooBar from './x.module.css';\n}\n"
  expect(await fix(composes, tailwindcssConfig, 'src/a.module.css')).toBe(composes)
})

describe('.astro files', () => {
  it('lints <style> blocks and style attributes', async () => {
    const astro = [
      '---',
      "const color = 'red'",
      '---',
      '',
      '<p style="colr: red">{color}</p>',
      '',
      '<style define:vars={{ color }}>',
      '  a {',
      '    colr: var(--color);',
      '  }',
      '</style>',
      '',
    ].join('\n')
    expect(await lintAstro(astro)).toEqual(['property-no-unknown', 'property-no-unknown'])
  })
})

describe('CSS Modules', () => {
  it.each([
    [':export values', ':export {\n  themeName: darkMode;\n}\n'],
    ['composes class names', ".a {\n  composes: fooBar from './x.module.css';\n}\n"],
    ['@value references', '@value primaryColor: #f00;\n\n.a {\n  color: primaryColor;\n}\n'],
  ])(
    "keeps the case of camelCase names in %s, which --fix doesn't lowercase",
    async (_name, css) => {
      expect(await lintRules(css, baseConfig, 'src/b.module.css')).not.toContain(
        'value-keyword-case',
      )
      expect(await fix(css, baseConfig, 'src/b.module.css')).toBe(css)
      expect(await lintRules(css, baseConfig, 'src/b.css')).toContain('value-keyword-case')
    },
  )

  it('still lowercases a camelCase CSS keyword', async () => {
    const css = '.a {\n  color: currentColor;\n}\n'
    expect(await fix(css, baseConfig, 'src/b.module.css')).toBe('.a {\n  color: currentcolor;\n}\n')
  })
})

/**
 * The line and rule of each report on `code` as the file `codeFilename`
 */
async function lintFile(code: string, codeFilename: string, config: Config = baseConfig) {
  const { results } = await stylelint.lint({ code, codeFilename, config })
  return results.flatMap((result) =>
    result.warnings.map((warning) => `${warning.line}:${warning.rule}`),
  )
}

describe('.html and .md files', () => {
  const HTML = '<p>x</p>\n<style>\n  a {\n    color: RED;\n  }\n</style>\n'
  const MARKDOWN = '# Title\n\nText.\n\n```css\na {\n  color: RED;\n}\n```\n'

  it.each([
    ['<style> blocks', 'src/page.html', HTML, '4:value-keyword-case'],
    ['CSS code blocks', 'src/doc.md', MARKDOWN, '7:value-keyword-case'],
  ])('lints %s in %s', async (_blocks, codeFilename, code, report) => {
    expect(await lintFile(code, codeFilename)).toEqual([report])
  })

  it.each([
    ['astro', 'src/page.astro', '<style>\n  a {\n    colr: red;\n  }\n</style>\n'],
    ['html', 'src/page.html', HTML],
    ['markdown', 'src/doc.md', MARKDOWN],
  ])(
    'ignores the files that %s: false turns off, rather than parse them as CSS',
    async (option, codeFilename, code) => {
      const config = await defineConfig({ root: process.cwd(), [option]: false })
      const { results } = await stylelint.lint({ code, codeFilename, config })
      expect(results[0]?.ignored).toBe(true)
    },
  )

  it('allows an ignoreFiles negation to restore files that html: false excludes', async () => {
    const config = await defineConfig({
      root: process.cwd(),
      html: false,
      ignoreFiles: () => ['!**/*.html'],
    })
    const { results } = await stylelint.lint({ code: HTML, codeFilename: 'src/page.html', config })
    expect(results[0]?.ignored).not.toBe(true)
  })

  it('applies your rules after the .astro and .md overrides', async () => {
    const config = await defineConfig({
      root: process.cwd(),
      rules: {
        'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep'] }],
        'declaration-block-single-line-max-declarations': 1,
      },
    })
    const astro = '<style>\n  .a :global(p) :deep(b) {\n    color: red;\n  }\n</style>\n'
    expect(await lintFile(astro, 'src/page.astro', config)).toEqual([])
    // The .md override turns the rule off, which your top-level setting leaves off
    const markdown = '<style>\n  a { color: red; background: blue; }\n</style>\n'
    expect(await lintFile(markdown, 'src/doc.md', config)).toEqual([])
    expect(await lintFile(markdown, 'src/page.html', config)).toEqual([
      '2:declaration-block-single-line-max-declarations',
    ])
  })

  it("merges each of your overrides over the preset's settings, not over each other", async () => {
    const config = await defineConfig({
      root: process.cwd(),
      overrides: [
        {
          files: '**/*.astro',
          rules: { 'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep'] }] },
        },
        {
          files: '**/*.astro',
          rules: { 'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['slot'] }] },
        },
      ],
    })
    const astro = '<style>\n  .a :global(p) :deep(b) :slot(i) {\n    color: red;\n  }\n</style>\n'
    expect(await lintFile(astro, 'src/page.astro', config)).toEqual([
      '2:selector-pseudo-class-no-unknown',
    ])
    expect(config.overrides!.at(-1)!.rules).toEqual({
      'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'slot'] }],
    })
  })

  it('lints HTML <style> blocks in .md files', async () => {
    // Without the line: after Markdown text, postcss-markdown 2.0.0 misplaces a report inside a
    // value of an HTML `<style>` block, here on line 7
    const markdown = '# Title\n\n<style>\n  a {\n    color: RED;\n  }\n</style>\n'
    expect(await lintFile(markdown, 'src/doc.md')).toEqual([
      expect.stringMatching(/:value-keyword-case$/),
    ])
  })

  it('skips SCSS, Less and other style languages, whatever syntaxes are installed', async () => {
    // postcss-html and postcss-markdown load a syntax such as `postcss-scss` from the working
    // directory, so each of these packages parses as CSS there
    const postcss = fileURLToPath(import.meta.resolve('postcss'))
    const syntax = `module.exports = require(${JSON.stringify(postcss)})\n`
    await using project = await withTmpProject(
      'stylelint-config-syntaxes',
      Object.fromEntries(
        ['postcss-sass', 'postcss-scss', 'postcss-less', 'postcss-styl', 'sugarss'].map((name) => [
          `node_modules/${name}/index.js`,
          syntax,
        ]),
      ),
    )
    vi.spyOn(process, 'cwd').mockReturnValue(project.dir)
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    const scss = "@use 'tokens';\n\na {\n  colr: darken($c, 10%);\n}\n"
    const markdown = ['scss', 'sass', 'less', 'stylus', 'styl', 'sugarss']
      .map((lang) => `\`\`\`${lang}\n${scss}\`\`\`\n`)
      .join('\n')
    const page = `<p>x</p>\n<style lang="scss">\n${scss}</style>\n`
    expect(await lintFile(markdown, 'src/doc.md')).toEqual([])
    expect(await lintFile(page, 'src/doc.md')).toEqual([])
    expect(await lintFile(page, 'src/page.html')).toEqual([])
    expect(await lintFile(page, 'src/page.astro')).toEqual([])
    expect(await fix(page, baseConfig, 'src/page.astro')).toBe(page)
  })

  it('reports a top-level nesting selector in .css files only', async () => {
    const css = '& a {\n  color: red;\n}\n'
    expect(await lintFile(css, 'src/a.css')).toEqual(['1:nesting-selector-no-missing-scoping-root'])
    expect(await lintFile(`<style>\n${css}</style>\n`, 'src/page.html')).toEqual([])
    expect(await lintFile(`\`\`\`css\n${css}\`\`\`\n`, 'src/doc.md')).toEqual([])
  })
})
