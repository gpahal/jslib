import path from 'node:path'
import process from 'node:process'

import postcssHtml from 'postcss-html'
import stylelint, { type Config, type Rule } from 'stylelint'
import recessOrderGroups from 'stylelint-config-recess-order/groups'

import { withTmpProject } from '@gpahal/internal/node/testing'

import baseDefault, {
  defineConfig,
  replace,
  type StylelintConfigOptions,
  type StylelintOverride,
} from '@/index'
import { commentLayout } from '@/internal/comment-layout'
import tailwindcssDefault from '@/tailwindcss'

import { fix, lintRules, topLevelRules } from './helpers'

/**
 * The config with the preset's own settings, the first config object in `config`'s `extends`
 */
function presetLayerOf(config: Config): Config {
  const extended: Array<unknown> = [config.extends ?? []].flat()
  return extended.find((entry) => typeof entry === 'object') as Config
}

const baseConfig = await defineConfig({ root: process.cwd() })
const tailwindcssConfig = await defineConfig({ root: process.cwd(), tailwindcss: true })

/**
 * A local plugin's rule, which reports `red` values
 */
const noRedRule: Rule = (primary: unknown) => (root, result) => {
  if (primary !== true) {
    return
  }
  root.walkDecls((decl) => {
    if (decl.value === 'red') {
      stylelint.utils.report({
        ruleName: noRedRule.ruleName,
        result,
        node: decl,
        message: 'No red',
      })
    }
  })
}
noRedRule.ruleName = 'local/no-red'
noRedRule.messages = {}

const noRed = stylelint.createPlugin(noRedRule.ruleName, noRedRule)

function formatter(): string {
  return ''
}

describe('defineConfig', () => {
  it('turns off the file type overrides and the comment layout rule, whose plugin stays registered so you can set it', async () => {
    const config = await defineConfig({
      root: process.cwd(),
      astro: false,
      html: false,
      markdown: false,
      commentLayout: false,
    })
    expect(config.overrides?.map(({ files }) => files)).toEqual(['*.module.css'])
    expect(config.rules).not.toHaveProperty('@gpahal/comment-layout')
    expect(config.plugins).toContain(commentLayout)
    const withRule = await defineConfig({
      root: process.cwd(),
      commentLayout: false,
      rules: { '@gpahal/comment-layout': true },
    })
    expect(await lintRules('/* One\n   two. */\na {\n  color: red;\n}\n', withRule)).toEqual([
      '@gpahal/comment-layout',
    ])
  })

  it('prefers flow-relative properties, units and keywords with logical', async () => {
    const css = 'a {\n  float: left;\n  inline-size: 10vw;\n  margin-left: 0;\n}\n'
    const logical = await defineConfig({ root: process.cwd(), logical: true })
    expect(await lintRules(css, logical)).toEqual([
      'property-layout-mappings',
      'unit-layout-mappings',
      'value-keyword-layout-mappings',
    ])
    expect(await fix(css, logical)).toBe(
      'a {\n  float: inline-start;\n  inline-size: 10vi;\n  margin-inline-start: 0;\n}\n',
    )
    expect(await lintRules(css, baseConfig)).toEqual([])
  })

  it('ignores options and override keys inherited from a polluted `Object.prototype`', async () => {
    const options = { root: process.cwd(), overrides: [{ files: '**/*.widget' }] }
    const expected = await defineConfig(options)
    Reflect.set(Object.prototype, 'commentLayout', false)
    Reflect.set(Object.prototype, 'ignoreFiles', 'polluted')
    try {
      expect(await defineConfig(options)).toEqual(expected)
    } finally {
      Reflect.deleteProperty(Object.prototype, 'commentLayout')
      Reflect.deleteProperty(Object.prototype, 'ignoreFiles')
    }
  })

  it('adds your plugins after its own, with their rules in rules', async () => {
    const config = await defineConfig({
      root: process.cwd(),
      plugins: [noRed],
      rules: { 'local/no-red': true },
    })
    expect(config.plugins).toEqual([...[baseConfig.plugins].flat(), noRed])
    expect(await lintRules('a {\n  color: red;\n}\n', config)).toEqual(['local/no-red'])
  })

  it('puts your rules and overrides after its own', async () => {
    const override = {
      files: ['*.scss'],
      rules: { 'color-named': 'never' },
    } satisfies StylelintOverride
    const config = await defineConfig({
      root: process.cwd(),
      rules: { 'number-max-precision': 4 },
      overrides: [override],
    })
    expect(config.rules?.['number-max-precision']).toBe(4)
    expect(config.overrides).toEqual([...baseConfig.overrides!, override])
  })

  it('takes ignoreFiles as a glob, an array of globs or a function', async () => {
    const globs = ['legacy/**', '!legacy/keep.css']
    const expected = [`${process.cwd()}/legacy/**`, `!${process.cwd()}/legacy/keep.css`]
    for (const ignoreFiles of [globs, (defaults: Array<string>) => [...defaults, ...globs]]) {
      expect((await defineConfig({ root: process.cwd(), ignoreFiles })).ignoreFiles).toEqual(
        expected,
      )
    }
    expect(
      (await defineConfig({ root: process.cwd(), ignoreFiles: 'legacy/**' })).ignoreFiles,
    ).toEqual([`${process.cwd()}/legacy/**`])
  })

  it('takes the Tailwind CSS functions and at-rules as functions of the defaults, and lints with them', async () => {
    const added = await defineConfig({
      root: process.cwd(),
      tailwindcss: {
        functions: (defaults) => [...defaults, 'brand'],
        atRules: (defaults) => [...defaults, 'brand-rule'],
      },
    })
    expect(topLevelRules(added)['function-no-unknown']).toEqual([
      true,
      { ignoreFunctions: ['tech', 'theme', 'brand'] },
    ])
    const atRules = added.languageOptions?.syntax?.atRules
    expect(atRules?.['brand-rule']).toEqual({ prelude: '<any-value>?' })
    expect(atRules).toHaveProperty('theme')
    const css = '@brand-rule base;\n\na {\n  color: brand(primary);\n}\n'
    expect(await lintRules(css, added)).toEqual([])
    expect(await lintRules(css, tailwindcssConfig)).toEqual([
      'at-rule-no-unknown',
      'declaration-property-value-no-unknown',
      'function-no-unknown',
    ])
  })

  it('builds configs that share no rule values with each other or with your options', async () => {
    const options = {
      root: process.cwd(),
      rules: { 'color-named': ['never', { ignore: ['inside-function'] }] },
    } satisfies Parameters<typeof defineConfig>[0]
    const initialOptions = structuredClone(options)
    const initialGroups = structuredClone(recessOrderGroups)
    const first = await defineConfig(options)
    const [groups] = topLevelRules(first)['order/properties-order'] as [
      Array<{ properties: Array<string> }>,
    ]
    groups[0]!.properties.push('changed')
    const [, colorNamedOptions] = topLevelRules(first)['color-named'] as [
      string,
      { ignore: Array<string> },
    ]
    colorNamedOptions.ignore.push('changed')

    expect(recessOrderGroups).toEqual(initialGroups)
    expect(options).toEqual(initialOptions)
    for (const config of [
      await defineConfig({ root: process.cwd() }),
      baseDefault,
      tailwindcssDefault,
    ]) {
      expect(topLevelRules(config)['order/properties-order']).toEqual([
        initialGroups,
        { disableFix: true },
      ])
    }
  })
})

describe("defineConfig's Stylelint options", () => {
  it("appends extends after the preset's, whose rules beat the preset's", async () => {
    await using project = await withTmpProject('stylelint-config-define', {
      'extended.mjs':
        "export default { rules: { 'color-hex-length': 'long', 'number-max-precision': 2 } }\n",
    })
    const config = await defineConfig({
      root: process.cwd(),
      extends: path.join(project.dir, 'extended.mjs'),
    })
    expect(config.extends).toEqual([
      ...[baseConfig.extends].flat(),
      { rules: { 'color-hex-length': 'long', 'number-max-precision': 2 } },
    ])
    expect(await lintRules('a {\n  width: 1.123px;\n  color: #fff;\n}\n', config)).toEqual([
      'color-hex-length',
      'number-max-precision',
    ])
  })

  it("merges top-level and override languageOptions into the preset's, keeping the Tailwind CSS syntax", async () => {
    const config = await defineConfig({
      root: process.cwd(),
      tailwindcss: true,
      languageOptions: { syntax: { atRules: { brand: { prelude: '<ident>' } } } },
      overrides: [
        {
          files: ['src/**/*.css'],
          languageOptions: { syntax: { properties: { 'brand-size': '<length>' } } },
        },
      ],
    })
    expect(
      await lintRules('@theme inline {\n  --color-x: red;\n}\n\n@brand primary;\n', config),
    ).toEqual([])
    expect(await lintRules('@brand 1px;\n', config)).toEqual(['at-rule-prelude-no-invalid'])
    expect(config.overrides!.at(-1)!.languageOptions).toEqual({
      syntax: { ...config.languageOptions!.syntax, properties: { 'brand-size': '<length>' } },
    })
    expect(await lintRules('a {\n  brand-size: red;\n}\n', config, 'src/a.css')).toEqual([
      'declaration-property-value-no-unknown',
    ])
  })

  it('passes defaultSeverity and customSyntax through', async () => {
    const config = await defineConfig({
      root: process.cwd(),
      defaultSeverity: 'warning',
      customSyntax: postcssHtml,
    })
    const { errored, results } = await stylelint.lint({
      code: '<style>\n  a {\n    color: #ffffff;\n  }\n</style>\n',
      config,
    })
    expect(errored).toBe(false)
    expect(results[0]!.warnings.map(({ rule, severity }) => ({ rule, severity }))).toEqual([
      { rule: 'color-hex-length', severity: 'warning' },
    ])
  })

  it("passes Stylelint's own config keys through, in place of the preset's", async () => {
    const keys: Omit<StylelintConfigOptions, 'root'> = {
      quiet: true,
      formatter,
      ignoreDisables: true,
      reportNeedlessDisables: false,
      reportInvalidScopeDisables: [true, { severity: 'warning' }],
      reportDescriptionlessDisables: null,
      reportUnscopedDisables: [true, { except: ['color-named', /^order\//] }],
      maxWarnings: 0,
      computeEditInfo: true,
      configurationComment: 'lint',
      processors: [`${process.cwd()}/a-processor.mjs`],
      allowEmptyInput: true,
      cache: false,
    }
    const config = await defineConfig({ root: process.cwd(), ...keys })
    expect(config).toMatchObject(keys)
    expect(config.formatter).toBe(formatter)
  })

  it.each([
    [false, 0],
    [true, 1],
  ])(
    "checks rule options with an override's validate: %j",
    async (validate, invalidOptionCount) => {
      const config = await defineConfig({
        root: process.cwd(),
        // @ts-expect-error - An unknown secondary option, which Stylelint reports when it validates
        rules: { 'block-no-empty': [true, { bogus: true }] },
        overrides: [{ files: '**/*.css', validate }],
      })
      const { results } = await stylelint.lint({
        code: 'a {\n  color: red;\n}\n',
        codeFilename: path.join(import.meta.dirname, 'a.css'),
        config,
      })
      expect(results[0]!.invalidOptionWarnings).toHaveLength(invalidOptionCount)
    },
  )
})

/**
 * `options` that the types would reject, to check what `defineConfig` does with them at run time
 */
function build(options: unknown) {
  return async () =>
    defineConfig(
      // @ts-expect-error - Untyped options, as a JavaScript config passes them
      options !== null && typeof options === 'object' && !Array.isArray(options)
        ? { root: process.cwd(), ...options }
        : options,
    )
}

const PREFIX = '@gpahal/stylelint-config'

const KNOWN_OPTIONS =
  '`root`, `tailwindcss`, `astro`, `html`, `markdown`, `commentLayout`, `logical`, `plugins`, `rules`, `overrides`, `ignoreFiles`, `referenceFiles`, `extends`, `languageOptions`, `defaultSeverity`, `customSyntax`, `quiet`, `formatter`, `ignoreDisables`, `reportNeedlessDisables`, `reportInvalidScopeDisables`, `reportDescriptionlessDisables`, `reportUnscopedDisables`, `maxWarnings`, `computeEditInfo`, `configurationComment`, `processors`, `allowEmptyInput`, `cache`'

describe('defineConfig validation', () => {
  it.each([
    [{ tailwind: true }, `\`tailwind\`: unknown option. Known options: ${KNOWN_OPTIONS}`],
    [
      { tailwindcss: { functions: () => ['a.b'] } },
      "`tailwindcss.functions`: `a.b` isn't a CSS function name",
    ],
    // An added name gets a prelude of any value, which would replace Stylelint's syntax of it
    [
      { tailwindcss: { atRules: () => ['MEDIA'] } },
      '`tailwindcss.atRules`: `MEDIA` is a CSS at-rule, which Stylelint already knows',
    ],
    ['all', 'options: expected an object of options, received `"all"`'],
    [
      { tailwindcss: 'false' },
      '`tailwindcss`: expected a boolean or an object, received `"false"`',
    ],
    [
      { overrides: { files: '*.css' } },
      '`overrides`: expected an array of overrides, received an object',
    ],
    [
      { ignoreFiles: () => [1] },
      '`ignoreFiles`: expected the function to return an array of strings, received an array with `1`',
    ],
    [
      { root: 'apps/web' },
      '`root`: expected an absolute path, such as `import.meta.dirname`, received `"apps/web"`',
    ],
    [{ plugins: [[[noRed]]] }, '`plugins[0][0]`: expected a plugin or a path, received an array'],
    [
      { extends: ['stylelint-config-standard', 5] },
      '`extends[1]`: expected a config or a path or package name, received `5`',
    ],
    [
      { overrides: [{ rules: {} }] },
      '`overrides[0].files`: expected a string or an array of strings, received `undefined`',
    ],
    // Stylelint applies an override when any of its globs matches, so a `!` glob doesn't exclude
    [
      { overrides: [{ files: ['src/**', '!src/legacy/**'] }] },
      '`overrides[0].files[1]`: `!src/legacy/**` matches every other file, since Stylelint applies an override when any of its globs matches. Exclude files with `ignoreFiles`, or list positive globs',
    ],
    [
      {
        overrides: [
          {
            files: 'src/a*',
            rules: { 'color-named': 'never', 'selector-pseudo-class-no-unknown': true },
          },
        ],
      },
      "`overrides[0].files`: matches files of types with different settings of `selector-pseudo-class-no-unknown`, and no glob matches just one type's files of it. Split this override into one per file type: `src/a*.astro`, `src/a*.html`, `src/a*.{md,markdown}`, `src/a*.@(css|pcss|postcss)`, `src/a*.module.css`, or wrap the setting with `replace()`",
    ],
    // Stylelint applies a config's fixes in memory and drops their warnings, but writes them only
    // with the run's `fix`
    [
      { overrides: [{ files: '*.css', fix: true }] },
      "`overrides[0].fix`: isn't taken, since it hides problems without writing fixes. Pass `--fix`",
    ],
    [
      { validate: false },
      "`validate`: isn't taken at the top level, where the run's `validate`, `true` by default, replaces it. Pass `--no-validate`, or set it in an override",
    ],
    [
      { reportUnscopedDisables: [true, { except: 'color-named' }] },
      '`reportUnscopedDisables`: expected a boolean, or a boolean and an object of `except` and `severity`, received an array',
    ],
  ])('throws a TypeError on %j', async (options, message) => {
    await expect(build(options)).rejects.toThrow(new TypeError(`${PREFIX}: ${message}`))
  })

  it('keeps a valid override as it is', async () => {
    const override = {
      files: ['legacy/**/*.css'],
      name: 'legacy',
      extends: { rules: { 'color-named': null } },
      plugins: [`${process.cwd()}/stylelint-plugin-legacy.mjs`, commentLayout],
      ignoreFiles: 'legacy/vendor/**',
      rules: { 'color-named': null },
      computeEditInfo: true,
    }
    // `ignoreFiles` joins the top-level list
    expect(
      (await defineConfig({ root: process.cwd(), overrides: [override] })).overrides!.at(-1),
    ).toEqual({
      ...override,
      files: [`${process.cwd()}/legacy/**/*.css`],
      extends: [{ rules: { 'color-named': null } }],
      ignoreFiles: [`${process.cwd()}/legacy/vendor/**`],
    })
  })

  it("accepts an override of files of two types that sets a rule to a setting that doesn't merge", async () => {
    const nullInArray: unknown = [null]
    const pseudoClasses: [true, { ignorePseudoClasses: Array<string> }] = [
      true,
      { ignorePseudoClasses: ['custom'] },
    ]
    const config = await defineConfig({
      root: process.cwd(),
      overrides: [
        { files: 'src/**', rules: { 'selector-pseudo-class-no-unknown': null } },
        { files: 'src/**', rules: { 'selector-pseudo-class-no-unknown': replace(pseudoClasses) } },
        // Stylelint reads `[null]` as `null`, though its types leave it out
        { files: 'src/**', rules: { 'selector-pseudo-class-no-unknown': nullInArray as null } },
      ],
    })
    expect(config.overrides!.slice(-3).map(({ rules }) => rules)).toEqual([
      { 'selector-pseudo-class-no-unknown': null },
      { 'selector-pseudo-class-no-unknown': pseudoClasses },
      { 'selector-pseudo-class-no-unknown': [null] },
    ])
  })
})

describe("an override's referenceFiles", () => {
  const css = 'a {\n  color: var(--brand);\n  background: var(--nope);\n}\n'

  async function lint(config: Config, dir: string, file: string, code = css) {
    const { results } = await stylelint.lint({
      code,
      codeFilename: path.join(dir, file),
      config,
      configBasedir: dir,
    })
    return results.flatMap((result) => result.warnings.map((warning) => warning.rule))
  }

  it('turns the reference rules on for its files, with the preset settings', async () => {
    await using project = await withTmpProject('stylelint-config-override-reference', {
      'tokens.css': ':root {\n  --brand: red;\n}\n',
    })
    const config = await defineConfig({
      root: project.dir,
      overrides: [{ files: 'src/**/*.css', referenceFiles: 'tokens.css' }],
    })
    expect(config.overrides!.at(-1)).toEqual({
      files: `${project.dir}/src/**/*.css`,
      referenceFiles: [`${project.dir}/tokens.css`],
    })
    // The rules go with the preset's settings, which your rules and extends beat
    expect(presetLayerOf(config).overrides!.at(-1)).toEqual({
      files: `${project.dir}/src/**/*.css`,
      rules: {
        'no-unknown-custom-properties': true,
        'no-unknown-custom-media': true,
        'no-unknown-animations': true,
      },
    })
    expect(await lint(config, project.dir, 'src/a.css')).toEqual(['no-unknown-custom-properties'])
    expect(await lint(config, project.dir, 'a.css')).toEqual([])
  })

  it('leaves them off in Markdown files when its files are of several types, keeping earlier settings', async () => {
    await using project = await withTmpProject('stylelint-config-override-reference', {
      'tokens.css': ':root {\n  --brand: red;\n}\n',
    })
    const config = await defineConfig({
      root: project.dir,
      overrides: [
        { files: 'src/b.md', rules: { 'no-unknown-custom-media': true } },
        { files: 'src/**', referenceFiles: 'tokens.css' },
      ],
    })
    expect(await lint(config, project.dir, 'src/a.css')).toEqual(['no-unknown-custom-properties'])
    expect(await lint(config, project.dir, 'src/a.md', `# A\n\n\`\`\`css\n${css}\`\`\`\n`)).toEqual(
      [],
    )
    expect(
      await lint(
        config,
        project.dir,
        'src/b.md',
        '# A\n\n```css\n@media (--nope) {\n  a {\n    color: red;\n  }\n}\n```\n',
      ),
    ).toEqual(['no-unknown-custom-media'])
  })

  it('keeps your settings of the reference rules, and leaves them off with an empty list', async () => {
    await using project = await withTmpProject('stylelint-config-define', { 'tokens/a.css': '' })
    const config = await defineConfig({
      root: project.dir,
      rules: { 'no-unknown-custom-media': null },
      overrides: [
        {
          files: 'src/**/*.css',
          referenceFiles: ['tokens/*.css'],
          rules: { 'no-unknown-custom-properties': [true, { severity: 'warning' }] },
        },
        { files: 'lib/**/*.css', referenceFiles: [] },
      ],
    })
    expect(config.overrides!.at(-2)!.rules).toEqual({
      'no-unknown-custom-properties': [true, { severity: 'warning' }],
    })
    expect(config.overrides!.at(-1)).not.toHaveProperty('rules')
  })
})

test("adds an override's ignoreFiles to the top-level list, after the globs of the file types that are off", async () => {
  await using project = await withTmpProject('stylelint-config-override-ignore')
  const config = await defineConfig({
    root: project.dir,
    astro: false,
    ignoreFiles: () => ['src/c.css'],
    overrides: [{ files: ['src/**'], ignoreFiles: ['src/legacy/**'] }],
  })
  expect(config.overrides!.at(-1)!.ignoreFiles).toEqual([
    `${project.dir}/**/*.astro`,
    `${project.dir}/src/c.css`,
    `${project.dir}/src/legacy/**`,
  ])
  const isIgnored = async (file: string) => {
    const { results } = await stylelint.lint({
      code: 'a { color: #ff00zz; }\n',
      codeFilename: path.join(project.dir, file),
      config,
      configBasedir: project.dir,
    })
    return results[0]!.ignored === true
  }
  expect(await isIgnored('src/legacy/d.css')).toBe(true)
  expect(await isIgnored('src/e.css')).toBe(false)
})
