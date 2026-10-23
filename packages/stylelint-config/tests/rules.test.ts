import fs from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import stylelint, { type Config } from 'stylelint'
import recessOrderGroups from 'stylelint-config-recess-order/groups'

import { toArray } from '@gpahal/std/arrays'

import baseDefault, {
  defineConfig,
  replace,
  type StylelintConfigOptions,
  type StylelintRules,
} from '@/index'
import { BASE_RULES } from '@/internal/base-rules'
import { mergeRules } from '@/internal/rules'

import {
  readonlyArraysRoot,
  withReadonlyArrays,
  withUndefinedOptions,
} from './exact-optional/options'
import { fix, lintRules, topLevelRules } from './helpers'

// Vitest ends its workers without Node's `exit` event, so a handler there would leave the folder
afterAll(() => {
  fs.rmSync(readonlyArraysRoot, { recursive: true, force: true })
})

/**
 * Compares rule names
 */
const collator = new Intl.Collator('en')

/**
 * A prefixed property before the standard one, which `property-no-vendor-prefix`'s fix would turn
 * into a second `user-select`
 */
const VENDOR_PREFIX_CSS = 'a {\n  -webkit-user-select: none;\n  user-select: none;\n}\n'

test('keeps prototype-named rule entries as own properties so Stylelint can validate them', () => {
  const name = '__proto__'
  const setting = { polluted: true }
  // @ts-expect-error -- JavaScript callers can supply keys the rule types reject
  const rules = mergeRules({}, { [name]: setting })
  expect(Object.getPrototypeOf(rules)).toBe(Object.prototype)
  expect(Object.hasOwn(rules, name)).toBe(true)
  expect(Reflect.get(rules, name)).toBe(setting)
  expect(Reflect.get(rules, 'polluted')).toBeUndefined()
})

describe("your rule settings keep the preset's disableFix", () => {
  it.each<[string, StylelintRules['property-no-vendor-prefix']]>([
    ['with a severity', [true, { severity: 'warning' }]],
    ['as a primary option alone', true],
  ])('property-no-vendor-prefix %s', async (_case, setting) => {
    const config = await defineConfig({
      root: process.cwd(),
      rules: { 'property-no-vendor-prefix': setting },
    })
    expect(await lintRules(VENDOR_PREFIX_CSS, config)).toContain('property-no-vendor-prefix')
    expect(await fix(VENDOR_PREFIX_CSS, config)).toBe(VENDOR_PREFIX_CSS)
  })

  it('unless your setting turns the fix back on', async () => {
    const config = await defineConfig({
      root: process.cwd(),
      rules: { 'property-no-vendor-prefix': [true, { disableFix: false }] },
    })
    expect(await fix(VENDOR_PREFIX_CSS, config)).toBe(
      'a {\n  user-select: none;\n  user-select: none;\n}\n',
    )
  })
})

describe("an undefined primary option keeps the preset's", () => {
  it("in an override, keeps your top-level setting's primary option in its one-item forms", async () => {
    const config = await defineConfig({
      root: process.cwd(),
      rules: {
        'hue-degree-notation': ['angle'],
        'color-named': ['never'],
        'unit-allowed-list': ['px', 'rem'],
        'order/properties-order': replace([['color', 'display']]),
      },
      overrides: [
        {
          files: 'legacy/**',
          rules: {
            'hue-degree-notation': [undefined, { severity: 'warning' }],
            'color-named': [undefined, { severity: 'warning' }],
            'unit-allowed-list': [undefined, { severity: 'warning' }],
            'order/properties-order': [undefined, { disableFix: false }],
          },
        },
      ],
    })
    const resolved = await stylelint.resolveConfig('legacy/a.css', { config })
    expect(resolved?.rules?.['hue-degree-notation']).toEqual(['angle', { severity: 'warning' }])
    expect(resolved?.rules?.['color-named']).toEqual(['never', { severity: 'warning' }])
    expect(resolved?.rules?.['unit-allowed-list']).toEqual([['px', 'rem'], { severity: 'warning' }])
    expect(resolved?.rules?.['order/properties-order']).toEqual([
      ['color', 'display'],
      { disableFix: false },
    ])
  })

  it('in an override, leaves a rule you turned off at the top level off', async () => {
    const names = ['rule-empty-line-before', 'color-hex-length', 'order/properties-order']
    const config = await defineConfig({
      root: process.cwd(),
      rules: Object.fromEntries(names.map((name) => [name, null])),
      overrides: [
        {
          files: 'legacy/**',
          rules: Object.fromEntries(
            names.map((name) => [name, [undefined, { severity: 'warning' }]]),
          ),
        },
      ],
    })
    const resolved = await stylelint.resolveConfig('legacy/a.css', { config })
    for (const name of names) {
      expect(resolved?.rules?.[name], name).toBeNull()
    }
  })
})

describe("your rule settings keep the ignore* options of every preset layer's setting", () => {
  it('reads the layers the preset extends as Stylelint does', async () => {
    const resolved = await stylelint.resolveConfig('a.css', {
      config: {
        extends: ['stylelint-config-standard', 'stylelint-config-recess-order'].map((name) =>
          fileURLToPath(import.meta.resolve(name)),
        ),
      },
    })
    expect(Object.keys(BASE_RULES).toSorted((a, b) => collator.compare(a, b))).toEqual(
      Object.keys(resolved?.rules ?? {}).toSorted((a, b) => collator.compare(a, b)),
    )
    // Stylelint wraps a setting that isn't an array, such as `true`, in one, and so the array of
    // groups that stylelint-config-recess-order sets `order/properties-order`'s primary option to
    expect(
      Object.fromEntries(
        Object.entries(BASE_RULES).map(([name, setting]) => [
          name,
          name !== 'order/properties-order' && Array.isArray(setting) ? setting : [setting],
        ]),
      ),
    ).toEqual(resolved?.rules)
  })

  it('of stylelint-config-recommended, which stylelint-config-standard extends, and of the Tailwind CSS preset', async () => {
    const config = await defineConfig({
      root: process.cwd(),
      tailwindcss: true,
      rules: {
        'at-rule-prelude-no-invalid': [true, { ignoreAtRules: ['x'] }],
        // A primary option alone keeps them too
        'string-no-newline': true,
        'at-rule-no-unknown': [true, { ignoreAtRules: ['my-rule'] }],
        'function-no-unknown': [true, { ignoreFunctions: ['brand'], severity: 'warning' }],
      },
    })
    expect(config.rules!['at-rule-prelude-no-invalid']).toEqual([
      true,
      { ignoreAtRules: ['media', 'x'] },
    ])
    expect(config.rules!['string-no-newline']).toEqual([
      true,
      { ignore: ['at-rule-preludes', 'declaration-values'] },
    ])
    expect(topLevelRules(config)['function-no-unknown']).toEqual([
      true,
      { ignoreFunctions: ['tech', 'theme', 'brand'], severity: 'warning' },
    ])
    const css =
      '@my-rule;\n\n@theme {\n  --color-x: red;\n}\n\na {\n  color: theme(--color-x);\n}\n'
    expect(await lintRules(css, config)).toEqual([])
  })
})

test("merges your secondary options over the preset's, keeping the severity and the options you leave out", async () => {
  const config = await defineConfig({
    root: process.cwd(),
    rules: {
      'plugin/use-baseline': [true, { ignoreProperties: { 'interpolate-size': ['/.*/'] } }],
    },
  })
  expect(config.rules!['plugin/use-baseline']).toEqual([
    true,
    {
      available: 'newly',
      severity: 'warning',
      ignoreProperties: { 'user-select': ['/^.+$/'], 'interpolate-size': ['/.*/'] },
    },
  ])
  const { results } = await stylelint.lint({
    code: 'a {\n  interpolate-size: allow-keywords;\n  reading-flow: grid-order;\n}\n',
    config,
  })
  expect(results[0]?.warnings.map(({ rule, severity }) => `${rule}: ${severity}`)).toEqual([
    'plugin/use-baseline: warning',
  ])
})

test('wraps the array primary option of a merged setting whose secondary options all drop out, which Stylelint would read as the primary and secondary options', () => {
  expect(
    mergeRules(
      { 'order/properties-order': [['display', 'color'], { message: 'Order' }] },
      { 'order/properties-order': [['color', 'display']] },
    ),
  ).toEqual({ 'order/properties-order': [['color', 'display']] })
  // The primary option alone unless you give secondary options, even {}
  const preset: StylelintRules = { 'color-named': ['never', { message: 'No named colors' }] }
  expect(mergeRules(preset, { 'color-named': 'always-where-possible' })).toEqual({
    'color-named': 'always-where-possible',
  })
  expect(mergeRules(preset, { 'color-named': ['always-where-possible', {}] })).toEqual({
    'color-named': ['always-where-possible', {}],
  })
})

/**
 * The text of the problems `config` reports on a class that isn't all lowercase letters
 */
async function classPatternTexts(config: Awaited<ReturnType<typeof defineConfig>>) {
  const { results } = await stylelint.lint({ code: '.foo-bar {\n  color: red;\n}\n', config })
  return results[0]!.warnings.map(({ text }) => text)
}

test("the preset's message, url, except and ignore go when your primary option differs, since they describe the preset's", async () => {
  const config = await defineConfig({
    root: process.cwd(),
    rules: {
      'selector-class-pattern': '^[a-z]+$',
      'rule-empty-line-before': 'never',
      'at-rule-empty-line-before': ['never', { ignore: ['blockless-after-blockless'] }],
    },
  })
  expect(config.rules!['selector-class-pattern']).toBe('^[a-z]+$')
  expect(await classPatternTexts(config)).toEqual([
    'Expected ".foo-bar" to match pattern "^[a-z]+$" (selector-class-pattern)',
  ])
  expect(config.rules!['rule-empty-line-before']).toBe('never')
  expect(config.rules!['at-rule-empty-line-before']).toEqual([
    'never',
    { ignore: ['blockless-after-blockless'] },
  ])
  // The preset's `first-nested` exception would want an empty line before `b`
  expect(await fix('a {\n  color: red;\n}\n\nc {\n  b {\n    color: red;\n  }\n}\n', config)).toBe(
    'a {\n  color: red;\n}\nc {\n  b {\n    color: red;\n  }\n}\n',
  )
})

test('leaves an option or a rule setting that is undefined unset, under exactOptionalPropertyTypes', async () => {
  expect(withUndefinedOptions.rules).not.toHaveProperty('property-no-unknown')
  expect(withUndefinedOptions.rules).not.toHaveProperty('foo/bar')
  expect(topLevelRules(withUndefinedOptions)['plugin/use-baseline']).toEqual([
    true,
    { available: 'newly', ignoreProperties: { 'user-select': ['/^.+$/'] }, severity: 'warning' },
  ])
  expect(topLevelRules(withUndefinedOptions)['function-no-unknown']).toEqual(
    topLevelRules(await defineConfig({ root: process.cwd(), tailwindcss: true }))[
      'function-no-unknown'
    ],
  )
  expect(withUndefinedOptions.rules!['value-no-vendor-prefix']).toEqual([
    true,
    { ignoreValues: undefined },
  ])
  // `replace()` uses the setting as it's given
  expect(withUndefinedOptions.rules!['selector-no-deprecated']).toEqual([
    true,
    { severity: undefined, disableFix: undefined },
  ])
  expect(withUndefinedOptions.overrides!.at(-1)).toStrictEqual({
    files: '*.scss',
  })
  expect(withUndefinedOptions).not.toHaveProperty('quiet')
  expect(withUndefinedOptions).not.toHaveProperty('processors')
  expect(withUndefinedOptions.reportNeedlessDisables).toEqual([
    true,
    { except: ['plugin/use-baseline'] },
  ])
})

test('takes readonly arrays, and gives Stylelint copies of them', () => {
  const globs = [`${readonlyArraysRoot}/legacy/**/*.css`]
  const modules = [`${process.cwd()}/local-plugin.mjs`]
  const configs = [{ rules: { 'color-named': null } }]
  expect(withReadonlyArrays.plugins).toContain(modules[0])
  expect(withReadonlyArrays.extends).toContainEqual(configs[0])
  expect(withReadonlyArrays.processors).toStrictEqual(modules)
  expect(withReadonlyArrays.referenceFiles).toStrictEqual([{ files: globs }])
  const override = withReadonlyArrays.overrides!.at(-1)!
  expect(override).toStrictEqual({
    files: globs,
    plugins: modules,
    extends: configs,
    ignoreFiles: globs,
    // The top-level reference files, then the override's
    referenceFiles: [{ files: globs }, `${readonlyArraysRoot}/tokens/*.css`, { files: globs }],
    rules: { 'color-named': 'never' },
  })
  expect(override.files).not.toBe(override.plugins)
})

describe('your overrides merge with the setting that applies to their files', () => {
  it("of the preset's file type override", async () => {
    const config = await defineConfig({
      root: process.cwd(),
      overrides: [
        {
          files: ['*.astro'],
          rules: { 'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep'] }] },
        },
      ],
    })
    expect(config.overrides!.at(-1)?.rules).toEqual({
      'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'deep'] }],
    })
    expect(
      await lintRules(
        '<style>\n  :global(a), :deep(b) {\n    color: red;\n  }\n</style>\n',
        config,
        'a.astro',
      ),
    ).toEqual([])
  })

  it('of the top-level rules, yours included, for other files', async () => {
    const config = await defineConfig({
      root: process.cwd(),
      rules: { 'value-no-vendor-prefix': [true, { ignoreValues: ['flex'] }] },
      overrides: [
        {
          files: ['legacy/**/*.css'],
          rules: {
            'plugin/use-baseline': [true, { available: 'widely' }],
            'value-no-vendor-prefix': [true, { ignoreValues: ['grid'] }],
            'at-rule-prelude-no-invalid': [true, { ignoreAtRules: ['x'] }],
            'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep'] }],
          },
        },
      ],
    })
    // CSS Modules among its files get an override of their own
    const [nonModules, modules] = config.overrides!.slice(-2)
    expect(nonModules?.files).toEqual([`${process.cwd()}/legacy/**/!(*.module).css`])
    expect(modules?.files).toEqual([`${process.cwd()}/legacy/**/*.module.css`])
    expect(modules?.rules?.['selector-pseudo-class-no-unknown']).toEqual([
      true,
      { ignorePseudoClasses: ['global', 'local', 'export', 'import', 'deep'] },
    ])
    expect(nonModules?.rules).toEqual({
      'plugin/use-baseline': [
        true,
        {
          available: 'widely',
          ignoreProperties: { 'user-select': ['/^.+$/'] },
          severity: 'warning',
        },
      ],
      'value-no-vendor-prefix': [
        true,
        { ignoreValues: ['box', 'inline-box', 'flex', 'grid'], disableFix: true },
      ],
      'at-rule-prelude-no-invalid': [true, { ignoreAtRules: ['media', 'x'] }],
      // `:global()` is the `.astro` files' only
      'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep'] }],
    })
  })

  it.each<[string, string | Array<string>]>([
    ['a folder', 'src/**'],
    ['a mixed array', ['**/*.astro', 'src/**']],
  ])(
    'of the top-level rules for files of two types, as with %s, keeping the .astro settings',
    async (_case, files) => {
      const config = await defineConfig({
        root: process.cwd(),
        overrides: [{ files, rules: { 'color-named': 'never' } }],
      })
      const astro = '<style>\n  :global(.a) {\n    color: red;\n  }\n</style>\n'
      expect(await lintRules(astro, config, 'src/page.astro')).toEqual(['color-named'])
      // A rule the `.astro` override sets merges over its settings for `.astro` files
      const merged = await defineConfig({
        root: process.cwd(),
        overrides: [
          {
            files,
            rules: { 'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['x'] }] },
          },
        ],
      })
      const xAstro = '<style>\n  :global(.a), :x(.b) {\n    color: red;\n  }\n</style>\n'
      expect(await lintRules(xAstro, merged, 'src/page.astro')).toEqual([])
      expect(await lintRules(xAstro, merged, 'src/page.html')).toEqual([
        'selector-pseudo-class-no-unknown',
      ])
    },
  )

  it.each([
    ['src/**/*.@(astro)', 'src/pages/index.astro'],
    ['src/{a/*.astro,b/{c,d}/*.astro}', 'src/b/d/p.astro'],
    ['*.astro', 'p.astro'],
  ])(
    'of the .astro override for %s, which matches only .astro files, such as %s',
    async (files, file) => {
      const config = await defineConfig({
        root: process.cwd(),
        overrides: [
          {
            files,
            rules: {
              'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep'] }],
            },
          },
        ],
      })
      const astro = '<style>\n  :global(body), :deep(a) {\n    color: red;\n  }\n</style>\n'
      expect(await lintRules(astro, config, file)).toEqual([])
    },
  )

  it.each<[string | Array<string>, string, string]>([
    ['**/components/**', 'x/components/a/p.astro', 'x/components/a/p.scss'],
    ['src/*.{css,astro}', 'src/p.astro', 'src/p.css'],
    [['*.scss', '*.astro'], 'x/p.astro', 'x/p.scss'],
  ])('splits %s, which matches files of two types, by type', async (files, astroFile, cssFile) => {
    const config = await defineConfig({
      root: process.cwd(),
      overrides: [{ files, rules: { 'selector-pseudo-class-no-unknown': true } }],
    })
    const css = ':global(.a) {\n  color: red;\n}\n'
    expect(await lintRules(`<style>\n${css}</style>\n`, config, astroFile)).toEqual([])
    expect(await lintRules(css, config, cssFile)).toEqual(['selector-pseudo-class-no-unknown'])
  })

  it.each(['src/*.css', 'src/**'])(
    'splits %s, which matches CSS files and CSS Modules, by type',
    async (files) => {
      const config = await defineConfig({
        root: process.cwd(),
        overrides: [{ files, rules: { 'selector-pseudo-class-no-unknown': true } }],
      })
      const css = ':global(.a) {\n  color: red;\n}\n'
      expect(await lintRules(css, config, 'src/ab.module.css')).toEqual([])
      expect(await lintRules(css, config, 'src/ab.css')).toEqual([
        'selector-pseudo-class-no-unknown',
      ])
    },
  )
})

describe('replace()', () => {
  it('throws on undefined, which would leave the setting unclear, and on a wrapped setting', () => {
    expect(() => replace(undefined)).toThrow(
      new TypeError(
        '@gpahal/stylelint-config: `replace()`: expected a setting, received `undefined`. Use `null` to turn the rule off, or leave the key out to keep the setting of the preset or an extended config',
      ),
    )
    expect(() => replace(replace(true))).toThrow(
      new TypeError('@gpahal/stylelint-config: `replace()`: the setting is wrapped already'),
    )
  })

  it("uses a setting as it is, without the preset's", async () => {
    const config = await defineConfig({
      root: process.cwd(),
      rules: {
        'property-no-vendor-prefix': replace([true, { severity: 'warning' }]),
        'value-no-vendor-prefix': replace([true, { ignoreValues: ['flex'] }]),
        'order/properties-order': replace([recessOrderGroups, { severity: 'warning' }]),
      },
    })
    expect(config.rules).toMatchObject({
      'property-no-vendor-prefix': [true, { severity: 'warning' }],
      'value-no-vendor-prefix': [true, { ignoreValues: ['flex'] }],
      'order/properties-order': [recessOrderGroups, { severity: 'warning' }],
    })
  })

  it("unwraps in the file type overrides and in your own overrides' rules", async () => {
    const setting = [true, { ignorePseudoClasses: ['deep'] }]
    const config = await defineConfig({
      root: process.cwd(),
      rules: {
        'selector-pseudo-class-no-unknown': replace([true, { ignorePseudoClasses: ['deep'] }]),
      },
      overrides: [
        {
          files: '*.widget',
          rules: {
            'selector-pseudo-class-no-unknown': replace([true, { ignorePseudoClasses: ['deep'] }]),
          },
        },
      ],
    })
    expect(
      config.overrides!.map(
        (override): unknown => override.rules?.['selector-pseudo-class-no-unknown'],
      ),
    ).toEqual([
      // `.astro` files and CSS Modules lose their pseudo-classes
      setting,
      undefined,
      undefined,
      setting,
      setting,
    ])
  })
})

type Options = Omit<StylelintConfigOptions, 'root'>

/**
 * The settings of `names` for `file` under `config`, `null` for a rule that's off
 */
async function settingsOf(
  config: Config,
  file: string,
  names: ReadonlyArray<string>,
): Promise<Record<string, unknown>> {
  const resolved = await stylelint.resolveConfig(file, { config })
  const rules: Record<string, unknown> = resolved?.rules ?? {}
  return Object.fromEntries(names.map((name) => [name, rules[name] ?? null]))
}

describe("an override's extends and an extended config's overrides beat the preset's settings", () => {
  const scssConfig = { rules: { 'function-no-unknown': null, 'hue-degree-notation': 'number' } }
  const teamConfig = {
    overrides: [
      {
        files: ['*.scss'],
        rules: { 'function-no-unknown': null, 'hue-degree-notation': 'number' },
      },
    ],
  }
  const cases: Array<[string, Options, string, Array<string>]> = [
    [
      "an override's extends, as stylelint-config-standard-scss does",
      { overrides: [{ files: ['**/*.scss'], extends: [scssConfig] }] },
      'src/a.scss',
      ['function-no-unknown', 'hue-degree-notation'],
    ],
    [
      "an extended config's override",
      { extends: [teamConfig] },
      'src/a.scss',
      ['function-no-unknown', 'hue-degree-notation'],
    ],
  ]

  it.each(cases)('%s, as with the static preset', async (_name, options, file, names) => {
    const defined = await defineConfig({ root: process.cwd(), ...options })
    const { extends: extended = [], ...rest } = options
    const withStatic = { ...rest, extends: [baseDefault, ...toArray(extended)] } as Config
    const settings = await settingsOf(defined, file, names)
    expect(settings).toEqual(await settingsOf(withStatic, file, names))
    expect(settings).not.toEqual(await settingsOf(defined, 'src/a.css', names))
  })

  it('leaves your top-level rules over them, as in Stylelint', async () => {
    const config = await defineConfig({
      root: process.cwd(),
      rules: { 'function-no-unknown': [true, { severity: 'warning' }] },
      overrides: [{ files: ['**/*.scss'], extends: [scssConfig] }],
    })
    expect(await settingsOf(config, 'src/a.scss', ['function-no-unknown'])).toEqual({
      'function-no-unknown': [true, { ignoreFunctions: ['tech'], severity: 'warning' }],
    })
  })
})

describe('a secondary-only setting keeps a rule that an extended config turns off off', () => {
  const css = 'a {\n  color: #ggg;\n}\n'
  const off = { rules: { 'color-no-invalid-hex': null } }
  const warning: StylelintRules = { 'color-no-invalid-hex': [undefined, { severity: 'warning' }] }
  const cases: Array<[string, Options]> = [
    ['at the top level', { extends: [off], rules: warning }],
    [
      'in an override with its own extends',
      { overrides: [{ files: ['**/*.css'], extends: [off], rules: warning }] },
    ],
  ]

  it.each(cases)('%s', async (_name, options) => {
    const config = await defineConfig({ root: process.cwd(), ...options })
    expect(await lintRules(css, config, 'src/a.css')).not.toContain('color-no-invalid-hex')
  })
})
