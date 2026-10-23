import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { getDefaultSelectors } from 'eslint-plugin-better-tailwindcss/defaults'
import { SelectorKind } from 'eslint-plugin-better-tailwindcss/types'
import { resolveConfig, type Plugin } from 'prettier'

import { PATH_OR_FILE_URL_EXPECTED } from '@gpahal/internal/node/paths'
import { runNodeOk, withTmpProject } from '@gpahal/internal/node/testing'

import defaultConfig, { defineConfig, mergeConfigs, type Config } from '@/index'
import { MARKDOWN_FILES } from '@/internal/defaults'
import { SORTER_OPTION_NAMES } from '@/internal/options'
import {
  DEFAULT_PLUGIN_ENVIRONMENT,
  PEER_RANGES,
  resolvePeerPlugin,
  resolveSortImportsPlugin,
  resolveTailwindPlugin,
  warnOfPrettierVersion,
  type PluginEnvironment,
} from '@/internal/plugins'

const ROOT = path.resolve(import.meta.dirname, '..')

const baseConfig = defineConfig({ root: ROOT })

/**
 * The absolute path of a package's entry, as `defineConfig` with `root` resolves a plugin's name
 */
function modulePath(id: string): string {
  return fileURLToPath(import.meta.resolve(id))
}

/**
 * The config names the plugins of other packages by absolute path
 */
const [SORT_IMPORTS_PLUGIN, TAILWIND_PLUGIN, ASTRO_PLUGIN, PACKAGE_JSON_PLUGIN] = [
  '@ianvs/prettier-plugin-sort-imports',
  'prettier-plugin-tailwindcss',
  'prettier-plugin-astro',
  'prettier-plugin-packagejson',
].map((id) => fileURLToPath(import.meta.resolve(id)))

/**
 * The start of every error message
 */
const PREFIX = '@gpahal/prettier-config'

/**
 * The config names the GitHub alerts plugin by its path, so Prettier loads it only when it's on.
 * The tests import the source, which gives the source module's path
 */
const GITHUB_ALERTS_PLUGIN = path.join(import.meta.dirname, '../src/internal/github-alerts.ts')

/**
 * Without the Tailwind plugin, the config names the import sorter by the path of its wrapper, which
 * leaves out the sorter's Vue and Ember parsers, and its parsers whose plugins don't resolve
 */
const SORT_IMPORTS_WRAPPER = path.join(import.meta.dirname, '../src/internal/sort-imports.ts')

const TAILWINDCSS = { entryPoint: 'tests/fixtures/tailwind.css' }

/**
 * The callee names that eslint-plugin-better-tailwindcss checks by default, from its `^name$`
 * patterns and in its order, which the preset's defaults must match
 */
const TAILWIND_FUNCTIONS = [
  ...new Set(
    getDefaultSelectors().flatMap((selector) =>
      selector.kind === SelectorKind.Callee && 'name' in selector
        ? selector.name.replace(/^\^(.*)\$$/, '$1')
        : [],
    ),
  ),
]

/**
 * TypeScript's `.mts` and `.cts` files allow `<T>x` assertions, which the sorter can't parse as JSX
 */
const MODULE_OVERRIDE = {
  files: ['*.mts', '*.cts'],
  options: {
    importOrderParserPlugins: [
      'typescript',
      'decorators',
      'decoratorAutoAccessors',
      'deferredImportEvaluation',
      'sourcePhaseImports',
    ],
  },
}

const ASTRO_OVERRIDE = { files: '*.astro', options: { parser: 'astro' } }

describe('defineConfig', () => {
  it('has the base plugins without options', () => {
    expect(baseConfig.plugins).toEqual([
      SORT_IMPORTS_WRAPPER,
      GITHUB_ALERTS_PLUGIN,
      PACKAGE_JSON_PLUGIN,
    ])
    expect(baseConfig).not.toHaveProperty('tailwindFunctions')
  })

  // format.test.ts checks the files these overrides leave alone with the static config only
  it('gives the static config the overrides of defineConfig', () => {
    expect(defaultConfig.overrides).toEqual(defineConfig({}).overrides)
  })

  // A drift test: the preset's list is a copy of the plugin's defaults
  it("has eslint-plugin-better-tailwindcss's default callees as its tailwind functions", () => {
    expect(TAILWIND_FUNCTIONS).toContain('cn')
    expect(defineConfig({ root: ROOT, tailwindcss: true }).tailwindFunctions).toEqual(
      TAILWIND_FUNCTIONS,
    )
  })

  it('sets the entry point, resolved from the root, as the stylesheet', () => {
    const config = defineConfig({
      root: ROOT,
      tailwindcss: { entryPoint: 'tests/fixtures/tailwind.css' },
    })
    expect(config.tailwindStylesheet).toBe(path.join(ROOT, 'tests/fixtures/tailwind.css'))
  })

  it('adds the astro override first and the tailwind plugin last', () => {
    const config = defineConfig({ root: ROOT, astro: true, tailwindcss: TAILWINDCSS })
    expect(config.plugins).toEqual([
      resolveSortImportsPlugin(TAILWIND_PLUGIN!).entry,
      GITHUB_ALERTS_PLUGIN,
      ASTRO_PLUGIN,
      PACKAGE_JSON_PLUGIN,
      TAILWIND_PLUGIN,
    ])
    expect(config.overrides).toEqual([ASTRO_OVERRIDE, ...(baseConfig.overrides ?? [])])
  })

  // Prettier applies an override's `plugins` in place of the config's
  it("adds an override's plugins to the preset's, once each, with the tailwind plugin last", () => {
    const config = defineConfig({
      root: ROOT,
      tailwindcss: true,
      // In `options.plugins` rather than from the preset, which rejects a second copy of its own
      packageJson: false,
      overrides: [
        { files: 'special/**', options: { plugins: [ASTRO_PLUGIN!, PACKAGE_JSON_PLUGIN!] } },
      ],
      options: {
        plugins: [PACKAGE_JSON_PLUGIN!],
        overrides: [{ files: 'other/**', options: { plugins: [ASTRO_PLUGIN!] } }],
      },
    })
    const plugins = [
      config.plugins?.[0],
      GITHUB_ALERTS_PLUGIN,
      PACKAGE_JSON_PLUGIN,
      ASTRO_PLUGIN,
      TAILWIND_PLUGIN,
    ]
    expect(config.overrides?.at(-2)).toEqual({ files: 'special/**', options: { plugins } })
    expect(config.overrides?.at(-1)).toEqual({ files: 'other/**', options: { plugins } })
  })
})

describe('defineConfig options', () => {
  it('keeps a plugin once when relative and absolute paths resolve to the same file', () => {
    const plugin = path.join(ROOT, 'plugin.mjs')
    const config = defineConfig({ root: ROOT, options: { plugins: ['./plugin.mjs', plugin] } })
    expect(config.plugins?.filter((entry) => entry === plugin)).toHaveLength(1)
  })

  it('turns off import sorting, GitHub alerts and package.json sorting', () => {
    const config = defineConfig({
      root: ROOT,
      sortImports: false,
      githubAlerts: false,
      packageJson: false,
    })
    expect(config.plugins).toEqual([])
    expect(config).not.toHaveProperty('importOrder')
    expect(config.overrides).not.toContainEqual(MODULE_OVERRIDE)
  })

  it('takes an import order, or a function of the default one', () => {
    const importOrder = ['^[./]'] as const
    expect(defineConfig({ root: ROOT, sortImports: { importOrder } }).importOrder).toEqual([
      '^[./]',
    ])
    const config = defineConfig({
      root: ROOT,
      sortImports: { importOrder: (defaults) => ['^@acme/(.*)$', '', ...defaults] },
    })
    expect(config.importOrder).toEqual(['^@acme/(.*)$', '', ...baseConfig.importOrder!])
  })

  it('takes the tailwind functions and attributes as functions of the defaults', () => {
    const added = defineConfig({
      root: ROOT,
      tailwindcss: {
        ...TAILWINDCSS,
        functions: (defaults) => [...defaults, 'classes'],
        attributes: (defaults) => [...defaults, 'tw'],
      },
    })
    expect(added.tailwindFunctions).toEqual([...TAILWIND_FUNCTIONS, 'classes'])
    expect(added.tailwindAttributes).toEqual(['tw'])
  })

  it('merges the astro, markdown and file options into its overrides, before yours', async () => {
    const userOverride = { files: '*.md', options: { proseWrap: 'preserve' as const } }
    const config = defineConfig({
      root: ROOT,
      astro: { printWidth: 120 },
      markdown: { printWidth: 80 },
      options: { proseWrap: 'always', printWidth: 60, astroAllowShorthand: true, plugins: ['a'] },
      overrides: [userOverride],
    })
    // The preset's overrides take from `options` only the keys they set
    expect(config.overrides).toEqual([
      { ...ASTRO_OVERRIDE, options: { ...ASTRO_OVERRIDE.options, printWidth: 120 } },
      { files: MARKDOWN_FILES, options: { proseWrap: 'always', printWidth: 80 } },
      ...(baseConfig.overrides ?? []).slice(1),
      userOverride,
    ])
    // `astro` and `markdown` win over `options`, which win over the preset's
    expect(await optionsFor(config, 'a.astro')).toMatchObject({
      proseWrap: 'always',
      printWidth: 120,
      astroAllowShorthand: true,
    })
    expect(await optionsFor(config, 'a.markdown')).toMatchObject({
      proseWrap: 'always',
      printWidth: 80,
    })
    expect(await optionsFor(config, 'a.md')).toMatchObject({ proseWrap: 'preserve' })
  })

  it('lets your options win and adds their plugins before the tailwind plugin', () => {
    const config = defineConfig({
      root: ROOT,
      tailwindcss: TAILWINDCSS,
      options: { printWidth: 80, plugins: ['prettier-plugin-other'] },
    })
    expect(config.printWidth).toBe(80)
    expect(config.plugins).toEqual([
      SORT_IMPORTS_PLUGIN,
      GITHUB_ALERTS_PLUGIN,
      PACKAGE_JSON_PLUGIN,
      'prettier-plugin-other',
      TAILWIND_PLUGIN,
    ])
  })
})

describe('undefined options', () => {
  it('keep the preset value', () => {
    const config = defineConfig({
      root: ROOT,
      astro: { astroAllowShorthand: undefined },
      markdown: { proseWrap: undefined },
      options: { printWidth: undefined },
    })
    expect(config.printWidth).toBe(100)
    expect(config).toStrictEqual(defineConfig({ root: ROOT, astro: true }))
  })

  it('are left out when merging configs', () => {
    const merged = mergeConfigs(
      { semi: false, overrides: [{ files: 'a', options: { semi: true } }] },
      { semi: undefined, overrides: [{ files: 'b', options: { semi: undefined } }] },
    )
    expect(merged).toStrictEqual({
      semi: false,
      overrides: [
        { files: 'a', options: { semi: true } },
        { files: 'b', options: {} },
      ],
    })
  })
})

/**
 * The options Prettier resolves for `filename` from a config file exporting `config`: `overrides`
 * apply only through a config file. Without the plugins, since JSON can't hold the GitHub alerts
 * plugin object
 */
async function optionsFor({ plugins: _plugins, ...config }: Config, filename: string) {
  await using project = await withTmpProject('prettier-config-options', {
    '.prettierrc.json': JSON.stringify(config),
  })
  return await resolveConfig(path.join(project.dir, filename), {
    config: path.join(project.dir, '.prettierrc.json'),
  })
}

describe('mergeConfigs', () => {
  it("keeps the preset's overrides over a later config's options", async () => {
    const jsonc = mergeConfigs(defineConfig({ root: ROOT }), { trailingComma: 'es5' })
    expect(await optionsFor(jsonc, 'a.jsonc')).toMatchObject({ trailingComma: 'none' })
    const markdown = mergeConfigs(defineConfig({ root: ROOT, markdown: { printWidth: 40 } }), {
      printWidth: 120,
    })
    expect(await optionsFor(markdown, 'a.md')).toMatchObject({ printWidth: 40 })
  })

  // Prettier applies an override's `plugins` in place of the config's
  it("adds the merged plugins to an override's, including a later config's, once each, with the tailwind plugin last", () => {
    const first = {
      overrides: [{ files: 'a', options: { plugins: ['x', TAILWIND_PLUGIN!, 'a'] } }],
    }
    const second = {
      plugins: ['a', TAILWIND_PLUGIN!, 'b'],
      overrides: [
        { files: 'b', options: { plugins: [] } },
        { files: 'c', options: { semi: true } },
      ],
    }
    const merged = mergeConfigs(first, second)
    expect(merged).toEqual({
      plugins: ['a', 'b', TAILWIND_PLUGIN],
      overrides: [
        { files: 'a', options: { plugins: ['a', 'b', 'x', TAILWIND_PLUGIN] } },
        { files: 'b', options: { plugins: ['a', 'b', TAILWIND_PLUGIN] } },
        { files: 'c', options: { semi: true } },
      ],
    })
    expect(mergeConfigs(merged, {})).toEqual(merged)
  })

  it('puts the after-Tailwind plugins after it by node_modules path or file: URL', () => {
    const tailwind = '/p/node_modules/prettier-plugin-tailwindcss/dist/index.mjs'
    const classnames =
      '/p/node_modules/.pnpm/prettier-plugin-classnames@0.10.4/node_modules/prettier-plugin-classnames/dist/index.js'
    const merge = String.raw`C:\p\node_modules\prettier-plugin-merge\dist\index.js`
    expect(mergeConfigs({ plugins: [merge, classnames, tailwind, 'a'] }).plugins).toEqual([
      'a',
      tailwind,
      classnames,
      merge,
    ])
    const [mergeUrl, classnamesUrl, tailwindUrl] = [merge, classnames, tailwind].map(
      (file) => new URL(`file://${file.replaceAll('\\', '/')}`),
    )
    expect(mergeConfigs({ plugins: [mergeUrl!, classnamesUrl!, tailwindUrl!] }).plugins).toEqual([
      tailwindUrl,
      classnamesUrl,
      mergeUrl,
    ])
  })

  it('keeps a plugin once when one config names it and another has the path root resolved it to', () => {
    const merged = mergeConfigs(
      defineConfig({
        root: ROOT,
        sortImports: false,
        options: { plugins: ['prettier-plugin-merge'] },
      }),
      { plugins: ['prettier-plugin-merge'] },
    )
    expect(
      merged.plugins?.filter(
        (plugin) => typeof plugin === 'string' && plugin.includes('prettier-plugin-merge'),
      ),
    ).toEqual([modulePath('prettier-plugin-merge')])
  })

  it('names a plugin outside node_modules by its nearest package.json, stopping at an invalid one', async () => {
    await using project = await withTmpProject('prettier-config-linked', {
      'tailwind/package.json': `\u{FEFF}${JSON.stringify({ name: 'prettier-plugin-tailwindcss' })}`,
      'tailwind/dist/index.mjs': '',
      'classnames/package.json': JSON.stringify({ name: 'prettier-plugin-classnames' }),
      'classnames/broken/package.json': '{',
      'classnames/broken/index.js': '',
    })
    const tailwind = path.join(project.dir, 'tailwind/dist/index.mjs')
    const broken = path.join(project.dir, 'classnames/broken/index.js')
    expect(mergeConfigs({ plugins: [tailwind, broken, 'a'] }).plugins).toEqual([
      broken,
      'a',
      tailwind,
    ])
  })

  it.each([
    [
      [{}, { overrides: [{ files: '*.ts', options: { plugins: [1] } }] }],
      "config 2 given to `mergeConfigs`: `overrides[0].options.plugins[0]`: expected a plugin's name or path, a URL or a plugin object, received `1`",
    ],
    [
      [{}, undefined],
      'config 2 given to `mergeConfigs`: expected a plain object of Prettier options, received `undefined`',
    ],
  ])('throws on the configs %j', (configs, message) => {
    // @ts-expect-error - Untyped configs, as a JavaScript config passes them
    expect(() => mergeConfigs(...configs)).toThrow(new TypeError(`${PREFIX}: ${message}`))
  })

  // A module namespace has no prototype, so it would pass as a plain object, and its `default` key
  // would reach Prettier as an unknown option
  it('throws on a module namespace', async () => {
    await using project = await withTmpProject('prettier-config-namespace', {
      'team.mjs': 'export default { semi: true }\n',
    })
    const namespace: unknown = await import(
      /* @vite-ignore */ pathToFileURL(path.join(project.dir, 'team.mjs')).href
    )
    expect(() => mergeConfigs(baseConfig, namespace as Config)).toThrow(
      new TypeError(
        `${PREFIX}: config 2 given to \`mergeConfigs\`: expected a config, received a module namespace. Pass its default export`,
      ),
    )
  })
})

/**
 * prettier-plugin-tailwindcss's `resolveJsFrom(base, id)`, the resolver it finds a plugin's path with
 * before composing the plugin. It's in a bundled chunk that the package doesn't export
 */
async function loadTailwindResolver(): Promise<(base: string, id: string) => string> {
  const dist = path.dirname(TAILWIND_PLUGIN!)
  const chunkFiles = (await fs.readdir(dist)).filter((file) => /^resolve-.*\.mjs$/.test(file))
  const chunks = await Promise.all(
    chunkFiles.map(
      async (file) =>
        (await import(pathToFileURL(path.join(dist, file)).href)) as Record<string, unknown>,
    ),
  )
  const resolver = chunks
    .flatMap((chunk) => Object.values(chunk))
    .find(
      (value): value is (base: string, id: string) => string =>
        typeof value === 'function' && value.name === 'resolveJsFrom',
    )
  return (
    resolver ??
    expect.fail(
      `prettier-plugin-tailwindcss has no \`resolveJsFrom\` in a resolve chunk in ${dist}`,
    )
  )
}

/**
 * A project with prettier-plugin-tailwindcss of `version` installed, and an environment that
 * resolves the plugin there
 */
async function installTailwind(version: string | undefined) {
  const project = await withTmpProject('prettier-config', {
    'node_modules/prettier-plugin-tailwindcss/package.json': JSON.stringify({
      name: 'prettier-plugin-tailwindcss',
      version,
      main: 'index.mjs',
    }),
    'node_modules/prettier-plugin-tailwindcss/index.mjs': '',
  })
  const tailwindPath = path.join(project.dir, 'node_modules/prettier-plugin-tailwindcss/index.mjs')
  const environment: PluginEnvironment = {
    ...DEFAULT_PLUGIN_ENVIRONMENT,
    resolve: () => pathToFileURL(tailwindPath).href,
  }
  return {
    dir: project.dir,
    path: tailwindPath,
    environment,
    [Symbol.asyncDispose]: async () => project[Symbol.asyncDispose](),
  }
}

describe('plugin resolution', () => {
  it('throws when the Tailwind plugin cannot load the import sorter, which it would skip', async () => {
    await using project = await withTmpProject('prettier-config')
    const tailwindPath = path.join(
      project.dir,
      'node_modules/prettier-plugin-tailwindcss/index.mjs',
    )
    expect(() => resolveSortImportsPlugin(tailwindPath)).toThrow(
      new TypeError(
        `${PREFIX}: \`sortImports\`: \`prettier-plugin-tailwindcss\` can't load \`@ianvs/prettier-plugin-sort-imports\` from where it's installed, so imports would stay unsorted. Install it in your project, as in \`pnpm add -D @ianvs/prettier-plugin-sort-imports\`, or set \`sortImports: false\``,
      ),
    )
  })

  // The Tailwind plugin composes the sorter only at the exact path its own resolver gives
  it("resolves the installed sorter to the path the Tailwind plugin's resolver gives", async () => {
    const resolveJsFrom = await loadTailwindResolver()
    expect(resolveSortImportsPlugin(TAILWIND_PLUGIN!).entry).toBe(
      resolveJsFrom(TAILWIND_PLUGIN!, '@ianvs/prettier-plugin-sort-imports'),
    )
  })

  it('throws when the Tailwind plugin would load an import sorter older than 4.7', async () => {
    await using project = await withTmpProject('prettier-config', {
      'node_modules/@ianvs/prettier-plugin-sort-imports/package.json': JSON.stringify({
        name: '@ianvs/prettier-plugin-sort-imports',
        version: '3.7.2',
        main: 'index.js',
      }),
      'node_modules/@ianvs/prettier-plugin-sort-imports/index.js': '',
    })
    const tailwindPath = path.join(
      project.dir,
      'node_modules/prettier-plugin-tailwindcss/index.mjs',
    )
    expect(() => resolveSortImportsPlugin(tailwindPath)).toThrow(
      new TypeError(
        `${PREFIX}: \`sortImports\`: \`prettier-plugin-tailwindcss\` loads \`@ianvs/prettier-plugin-sort-imports\` from where it's installed, and \`@ianvs/prettier-plugin-sort-imports\` 3.7.2 is older than the 4.7 this config needs. Install a newer version, as in \`pnpm add -D @ianvs/prettier-plugin-sort-imports@^4.7\`, or set \`sortImports: false\``,
      ),
    )
  })

  it('throws when the Tailwind plugin is older than 0.8', async () => {
    await using tailwind = await installTailwind('0.7.2')
    expect(() => resolveTailwindPlugin(tailwind.environment)).toThrow(
      new TypeError(
        `${PREFIX}: \`tailwindcss\`: \`prettier-plugin-tailwindcss\` 0.7.2 is older than the 0.8 this config needs. Install a newer version, as in \`pnpm add -D prettier-plugin-tailwindcss@^0.8\``,
      ),
    )
  })

  it.each([
    ['0.9.0', true],
    ['0.0.0-insiders.5b27f94', false],
  ])(
    'warns once when the Tailwind plugin is %s, outside the tested range: %s',
    async (version, warns) => {
      await using tailwind = await installTailwind(version)
      using emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined)
      expect(resolveTailwindPlugin(tailwind.environment, tailwind.dir)).toBe(tailwind.path)
      expect(resolveTailwindPlugin(tailwind.environment, tailwind.dir)).toBe(tailwind.path)
      expect(emitWarning.mock.calls).toEqual(
        warns
          ? [
              [
                `${PREFIX}: \`tailwindcss\`: prettier-plugin-tailwindcss ${version} is outside the tested range >=0.8.0 <0.9.0, so classes or imports may stay unsorted. If they do, install a version in the range, as in \`pnpm add -D "prettier-plugin-tailwindcss@>=0.8.0 <0.9.0"\``,
                { code: 'GPAHAL_PRETTIER_UNTESTED_TAILWIND_PLUGIN' },
              ],
            ]
          : [],
      )
    },
  )

  it.each([
    ['3.8.9', true],
    ['3.9.0', false],
  ])('warns once when Prettier is %s, below 3.9: %s', (version, warns) => {
    const environment: PluginEnvironment = {
      ...DEFAULT_PLUGIN_ENVIRONMENT,
      findPackage: (name) =>
        name === 'prettier' ? { dir: '/p/node_modules/prettier', version } : undefined,
    }
    using emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined)
    warnOfPrettierVersion(environment, ROOT)
    warnOfPrettierVersion(environment, ROOT)
    expect(emitWarning.mock.calls).toEqual(
      warns
        ? [
            [
              `${PREFIX}: \`prettier\`: version ${version} is older than the 3.9 this config needs, so some files may be formatted wrongly without an error. Install a newer version, as in \`pnpm add -D prettier@^3.9\``,
              { code: 'GPAHAL_PRETTIER_OLD_PRETTIER' },
            ],
          ]
        : [],
    )
  })

  it("gives the install hint for Node's error when an optional plugin is missing, as an Error with it as the cause", () => {
    const name = 'prettier-plugin-missing'
    const notFound = Object.assign(
      new Error(`Cannot find package '${name}' imported from /p/plugins.ts`),
      { code: 'ERR_MODULE_NOT_FOUND' },
    )
    const environment: PluginEnvironment = {
      ...DEFAULT_PLUGIN_ENVIRONMENT,
      resolve: () => {
        throw notFound
      },
    }
    let error: unknown
    try {
      resolvePeerPlugin('astro', name, environment)
    } catch (error_) {
      error = error_
    }
    expect(error).not.toBeInstanceOf(TypeError)
    expect(error).toMatchObject({
      message: `${PREFIX}: \`astro\`: needs \`${name}\`, which isn't installed. Install it as a dev dependency, as in \`pnpm add -D ${name}\``,
      cause: notFound,
    })
  })
})

describe('peer ranges', () => {
  // The install command of a missing peer names its range, so it doesn't install a version outside it
  it("match the package's peerDependencies", async () => {
    const { peerDependencies } = JSON.parse(
      await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'),
    ) as { peerDependencies: Record<string, string> }
    const { prettier, ...peers } = peerDependencies
    expect(prettier).toBeTypeOf('string')
    expect(peers).toEqual(PEER_RANGES)
  })
})

describe('in an npm project', () => {
  it('reports every missing optional plugin at once', async () => {
    await using project = await withTmpProject('prettier-config', { 'package-lock.json': '{}\n' })
    const missing = new Set(['prettier-plugin-astro', 'prettier-plugin-tailwindcss'])
    const { resolve: resolveDefault } = DEFAULT_PLUGIN_ENVIRONMENT
    const resolve = vi
      .spyOn(DEFAULT_PLUGIN_ENVIRONMENT, 'resolve')
      .mockImplementation((specifier) => {
        if (missing.has(specifier)) {
          throw Object.assign(
            new Error(`Cannot find package '${specifier}' imported from /p/plugins.ts`),
            { code: 'ERR_MODULE_NOT_FOUND' },
          )
        }
        return resolveDefault(specifier)
      })
    try {
      let error: unknown
      try {
        defineConfig({ root: project.dir, astro: true, tailwindcss: true })
      } catch (error_) {
        error = error_
      }
      expect(error).toBeInstanceOf(AggregateError)
      expect(error).toMatchObject({
        message: [
          `${PREFIX}: options: 2 issues`,
          '  `astro`: needs `prettier-plugin-astro`, which isn\'t installed. Install it as a dev dependency, as in `npm install -D "prettier-plugin-astro@^1.1"`',
          '  `tailwindcss`: needs `prettier-plugin-tailwindcss`, which isn\'t installed. Install it as a dev dependency, as in `npm install -D "prettier-plugin-tailwindcss@>=0.8.0 <0.9.0"`',
        ].join('\n'),
        errors: [expect.any(Error), expect.any(Error)],
      })
    } finally {
      resolve.mockRestore()
    }
  })
})

/**
 * A deep copy of a config, keeping its plugin objects
 */
function snapshot({ plugins, ...config }: Config): Config {
  return { plugins: [...(plugins ?? [])], ...structuredClone(config) }
}

describe('independence', () => {
  it('shares no list or override with other configs', () => {
    const baseSnapshot = snapshot(baseConfig)
    const options = { root: ROOT, astro: true, tailwindcss: TAILWINDCSS }
    const configSnapshot = snapshot(defineConfig(options))

    // A callback that changes the defaults it's given, and changes to the results
    const results = [
      defineConfig({
        ...options,
        sortImports: {
          importOrder: (defaults) => {
            defaults.unshift('^x$')
            return defaults
          },
        },
      }),
      defineConfig(options),
      defineConfig({ ...options, options: { printWidth: 80 } }),
      mergeConfigs(baseConfig),
    ]
    for (const result of results) {
      result.importOrder?.push('^y$')
      result.tailwindFunctions?.push('y')
      result.plugins?.push('y')
      const overrides = result.overrides ?? []
      for (const override of overrides) {
        if (Array.isArray(override.files)) {
          override.files.push('y')
        }
        Object.assign(override.options ?? {}, { printWidth: 1 })
      }
      overrides.push({ files: 'y' })
    }

    expect(snapshot(baseConfig)).toEqual(baseSnapshot)
    expect(snapshot(defineConfig({ root: ROOT }))).toEqual(baseSnapshot)
    expect(snapshot(defineConfig(options))).toEqual(configSnapshot)
  })
})

/**
 * `options` that the types would reject, to check what `defineConfig` does with them at run time
 */
function build(options: unknown) {
  const input =
    typeof options === 'object' && options !== null && !Array.isArray(options)
      ? { root: ROOT, ...options }
      : options
  // @ts-expect-error - Untyped options, as a JavaScript config passes them
  return () => defineConfig(input)
}

const TAILWIND_PLUGIN_TAKEN =
  "`prettier-plugin-tailwindcss` isn't taken in `options` or overrides. Turn it on with `tailwindcss`, which checks that it can load the import sorter"

const NESTED_OVERRIDES =
  "isn't taken, since Prettier ignores an override's own overrides. Add them to the list this override is in"

const KNOWN_OPTIONS =
  'unknown option. Known options: `root`, `astro`, `tailwindcss`, `sortImports`, `githubAlerts`, `packageJson`, `markdown`, `overrides`, `options`'

const OVERRIDE_FILES =
  'expected a non-empty string or a non-empty array of non-empty strings, received'

describe('defineConfig validation', () => {
  it('keeps filesystem failures as the cause of an option-specific error', async () => {
    await using project = await withTmpProject('prettier-config-stat', { 'package.json': '{}' })
    const loop = path.join(project.dir, 'loop')
    await fs.symlink('loop', loop)
    expect(build({ root: project.dir, tailwindcss: { entryPoint: 'loop' } })).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          `${PREFIX}: \`tailwindcss.entryPoint\`: reading \`${loop}\` failed: `,
        ) as unknown,
        cause: expect.objectContaining({ code: 'ELOOP' }) as unknown,
      }),
    )
  })

  it('rejects markdown: false with a pointer to .prettierignore', () => {
    expect(build({ markdown: false })).toThrow(
      new TypeError(
        `${PREFIX}: \`markdown\`: expected an object of Prettier options, received \`false\`. To leave Markdown files unformatted, list them in \`.prettierignore\``,
      ),
    )
  })

  it('rejects unknown sorter options and suggests a close option name', () => {
    expect(build({ sortImports: { importOrderCaseSensitve: true } })).toThrow(
      `${PREFIX}: \`sortImports.importOrderCaseSensitve\`: unknown option. Did you mean \`importOrderCaseSensitive\`?`,
    )
  })

  it("lists the sorter's option names, which it checks without loading the sorter", () => {
    const require = createRequire(import.meta.url)
    const { options } = require(SORT_IMPORTS_PLUGIN!) as { options: object }
    expect(SORTER_OPTION_NAMES).toEqual(Object.keys(options))
    const tailwindSorter = resolveSortImportsPlugin(TAILWIND_PLUGIN!).path
    const { options: tailwindOptions } = require(tailwindSorter) as { options: object }
    expect(SORTER_OPTION_NAMES).toEqual(Object.keys(tailwindOptions))
  })

  // With `tailwindcss`, Prettier loads the sorter that the Tailwind plugin finds, which can be newer
  it('checks sorter options against the sorter that the Tailwind plugin loads', async () => {
    const sorterDir = 'node_modules/@ianvs/prettier-plugin-sort-imports'
    await using project = await withTmpProject('prettier-config', {
      [`${sorterDir}/package.json`]: JSON.stringify({
        name: '@ianvs/prettier-plugin-sort-imports',
        version: '4.8.0',
        main: 'index.js',
      }),
      [`${sorterDir}/index.js`]:
        'module.exports = { options: { importOrder: {}, importOrderFoo: {} } }',
    })
    const resolveFrom = vi
      .spyOn(DEFAULT_PLUGIN_ENVIRONMENT, 'resolveFrom')
      .mockReturnValue({ path: path.join(project.dir, sorterDir, 'index.js'), version: '4.8.0' })
    try {
      const options = { sortImports: { importOrderFoo: true } }
      expect(build({ ...options, tailwindcss: true })()).toMatchObject({ importOrderFoo: true })
      expect(build(options)).toThrow(`${PREFIX}: \`sortImports.importOrderFoo\`: unknown option`)
    } finally {
      resolveFrom.mockRestore()
    }
  })

  it('rejects a missing stylesheet, a folder or a URL other than `file:` as its entry point', () => {
    for (const entryPoint of ['tests/fixtures/missing.css', 'tests/fixtures']) {
      expect(build({ tailwindcss: { entryPoint } })).toThrow(
        `${PREFIX}: \`tailwindcss.entryPoint\`: path \`${path.join(ROOT, entryPoint)}\` isn't a file`,
      )
    }
    expect(build({ tailwindcss: { entryPoint: new URL('https://example.com/a.css') } })).toThrow(
      `${PREFIX}: \`tailwindcss.entryPoint\`: expected ${PATH_OR_FILE_URL_EXPECTED}, received \`https://example.com/a.css\``,
    )
  })

  it('requires an absolute root', () => {
    expect(build({ root: '.' })).toThrow(
      `${PREFIX}: \`root\`: expected an absolute path, such as \`import.meta.dirname\``,
    )
  })

  it('leaves relative paths for Prettier and the Tailwind plugin to resolve without root', () => {
    expect(defineConfig({})).toEqual(defineConfig({ root: undefined }))
    expect(defineConfig({ sortImports: false }).plugins).not.toContain(SORT_IMPORTS_WRAPPER)
    expect(defineConfig({ tailwindcss: { entryPoint: 'src/styles.css' } }).tailwindStylesheet).toBe(
      'src/styles.css',
    )
    const plugin: Plugin = {}
    const config = defineConfig({
      options: { plugins: ['./plugin.mjs', plugin] },
      overrides: [{ files: '*.md', options: { plugins: ['../other.mjs'] } }],
    })
    expect(config.plugins).toEqual(expect.arrayContaining(['./plugin.mjs', plugin]))
    expect(config.overrides?.at(-1)?.options?.plugins).toContain('../other.mjs')
  })

  it('reports unknown options with the other issues', () => {
    expect(build({ semi: false, tailwindcsss: true, githubAlerts: 1 })).toThrow(
      new TypeError(
        [
          `${PREFIX}: options: 3 issues`,
          '  `semi`: unknown option. Prettier options go under `options`',
          '  `tailwindcsss`: unknown option. Did you mean `tailwindcss`?',
          '  `githubAlerts`: expected a boolean, received `1`',
        ].join('\n'),
      ),
    )
  })

  it.each([
    // The plugins' own keys, which the preset's options set
    [{ importOrder: [] }, '`importOrder`: unknown option. Pass `sortImports: { importOrder }`'],
    ['all', 'options: expected an object of options, received `"all"`'],
    [
      { tailwindcss: { entryPoint: '' } },
      '`tailwindcss.entryPoint`: expected a non-empty string or a URL, received `""`',
    ],
    [
      { tailwindcss: { ...TAILWINDCSS, attributes: () => ['a', 1] } },
      '`tailwindcss.attributes`: expected the function to return an array of strings, received an array with `1`',
    ],
    [
      { tailwindcss: { functions: ['tw', 1] } },
      '`tailwindcss.functions[1]`: expected a string, received `1`',
    ],
    [
      { markdown: { plugins: ['x'] } },
      "`markdown.plugins`: isn't taken, since `markdown` takes options for the preset's files. Pass plugins in `options` and options for other files in `overrides`",
    ],
    // `sortImports` sets them for every file, so an override is the fix for the preset's files
    [
      { markdown: { importOrder: ['^a'] } },
      "`markdown.importOrder`: isn't taken. To set it in Markdown files only, pass `overrides: [{ files: '*.md', options: { importOrder } }]`",
    ],
    [
      { options: { tailwindFunctions: ['tw'] } },
      "`options.tailwindFunctions`: isn't taken. Pass `tailwindcss: { functions }`",
    ],
    [
      { options: { importOrder: ['^a'] } },
      "`options.importOrder`: isn't taken. Pass `sortImports: { importOrder }`",
    ],
    [
      { options: { plugins: ['prettier-plugin-other', 'prettier-plugin-tailwindcss'] } },
      `\`options.plugins[1]\`: ${TAILWIND_PLUGIN_TAKEN}`,
    ],
    [{ overrides: [1] }, '`overrides[0]`: expected an object with `files`, received `1`'],
    // An empty glob or list matches no file, so the override would do nothing
    [{ overrides: [{ files: [] }] }, `\`overrides[0]\`: \`files\`: ${OVERRIDE_FILES} an array`],
    [
      { overrides: [{ files: '*.ts', options: { overrides: [] } }] },
      `\`overrides[0].options.overrides\`: ${NESTED_OVERRIDES}`,
    ],
    // A string would be read as a list of characters
    [
      { options: { plugins: 'prettier-plugin-example' } },
      '`options.plugins`: expected an array of plugins, received `"prettier-plugin-example"`',
    ],
    [
      { overrides: [{ files: '*.ts', options: { plugins: [1] } }] },
      "`overrides[0].options.plugins[0]`: expected a plugin's name or path, a URL or a plugin object, received `1`",
    ],
    // Prettier ignores unknown options, so a preset option nested there would do nothing in editors
    [
      { options: { overrides: [{ files: '*.ts', options: { root: '/a' } }] } },
      "`options.overrides[0].options.root`: isn't taken. Pass it at the top level",
    ],
    [
      { markdown: { githubAlerts: false } },
      "`markdown.githubAlerts`: isn't taken. Pass it at the top level",
    ],
    [{ unknown: undefined }, `\`unknown\`: ${KNOWN_OPTIONS}`],
    [
      { tailwindcss: new Map() },
      '`tailwindcss`: expected a boolean or an object, received an instance of `Map`',
    ],
  ])('throws on %j', (options, message) => {
    expect(build(options)).toThrow(new TypeError(`${PREFIX}: ${message}`))
  })

  // A second copy of a preset plugin fails under pnpm, which doesn't hoist it, or under npm takes
  // over the wrapper's parsers, and the Astro plugin would load twice
  it('throws on a preset plugin in options.plugins and overrides', () => {
    const message = '`prettier-plugin-astro` is added by the preset. Remove it'
    const plugin = pathToFileURL(ASTRO_PLUGIN!).href
    expect(build({ astro: {}, options: { plugins: ['prettier-plugin-other', plugin] } })).toThrow(
      new TypeError(`${PREFIX}: \`options.plugins[1]\`: ${message}`),
    )
    expect(
      build({
        astro: {},
        options: { overrides: [{ files: '*.ts', options: { plugins: [plugin] } }] },
      }),
    ).toThrow(new TypeError(`${PREFIX}: \`options.overrides[0].options.plugins[0]\`: ${message}`))
  })

  // Prettier formats with the parser of the last plugin that defines it, so these replace the
  // sorter's parsers, and imports stay unsorted without an error
  it.each(['prettier-plugin-jsdoc', '@prettier/plugin-oxc'])(
    'throws on %s while sortImports is on',
    (plugin) => {
      const oxcFix =
        plugin === '@prettier/plugin-oxc'
          ? "leave it out of `plugins` and set `parser: 'oxc-ts'` in an override for the sorter to load it, "
          : ''
      const lead = `\`${plugin}\` replaces the import sorter's parsers, so imports would stay unsorted.`
      const description = `${lead} To use it, ${oxcFix}add \`prettier-plugin-merge\` after it to run both${oxcFix === '' ? '' : ','} or set \`sortImports: false\``
      const override = { overrides: [{ files: '*.ts', options: { plugins: [plugin] } }] }
      expect(build(override)).toThrow(
        new TypeError(`${PREFIX}: \`overrides[0].options.plugins[0]\`: ${description}`),
      )
      expect(build({ ...override, sortImports: false })).not.toThrow()
      // The Tailwind plugin loads the sorter itself, which prettier-plugin-merge fails with
      expect(build({ tailwindcss: true, options: { plugins: [plugin] } })).toThrow(
        new TypeError(
          `${PREFIX}: \`options.plugins[0]\`: ${lead} ${oxcFix === '' ? 'Set `sortImports: false` to use it' : `To use it, ${oxcFix.slice(0, -2)} or set \`sortImports: false\``}`,
        ),
      )
      expect(() => mergeConfigs(baseConfig, { plugins: [plugin] })).toThrow(
        new TypeError(
          `${PREFIX}: config 2 given to \`mergeConfigs\`: \`plugins[0]\`: ${description}`,
        ),
      )
    },
  )

  // prettier-plugin-merge formats with each plugin as a range, which prettier-plugin-organize-imports
  // skips; see the canary in upstream.test.ts
  it('throws on prettier-plugin-organize-imports while sortImports is on or before prettier-plugin-merge', () => {
    const name = 'prettier-plugin-organize-imports'
    const lead = `\`${name}\` replaces the import sorter's parsers, so imports would stay unsorted.`
    const fix = `Set \`sortImports: false\` to use \`${name}\``
    expect(build({ options: { plugins: ['a', name] } })).toThrow(
      new TypeError(`${PREFIX}: \`options.plugins[1]\`: ${lead} ${fix}`),
    )
    expect(build({ options: { plugins: [name, 'prettier-plugin-merge'] } })).toThrow(
      new TypeError(
        `${PREFIX}: \`options.plugins[0]\`: ${lead} ${fix}, without \`prettier-plugin-merge\` after it, which keeps it from running`,
      ),
    )
    expect(
      build({ sortImports: false, options: { plugins: [name, 'prettier-plugin-merge'] } }),
    ).toThrow(
      new TypeError(
        `${PREFIX}: \`options.plugins[0]\`: \`prettier-plugin-merge\`, after it, formats with it as a range, which it skips, so imports would stay as they are. Remove \`prettier-plugin-merge\` to use \`${name}\``,
      ),
    )
    expect(
      build({ sortImports: false, options: { plugins: ['prettier-plugin-merge', name] } }),
    ).not.toThrow()
  })

  // prettier-plugin-merge runs the sorter and then the plugin, with the wrapper's parsers
  it('takes a plugin with its own parsers before prettier-plugin-merge while sortImports is on', () => {
    const plugins = ['prettier-plugin-jsdoc', 'prettier-plugin-merge']
    expect(build({ options: { plugins } })).not.toThrow()
    expect(build({ options: { plugins: plugins.toReversed() } })).toThrow(
      `${PREFIX}: \`options.plugins[1]\`: \`prettier-plugin-jsdoc\` replaces`,
    )
  })

  // A shared config can be built by another installed copy of this package
  it("reads another copy's import sorter wrapper as the wrapper", () => {
    const wrapper = 'file:///p/node_modules/@gpahal/prettier-config/build/internal/sort-imports.js'
    expect(() =>
      mergeConfigs({ plugins: [wrapper] }, { plugins: ['prettier-plugin-jsdoc'] }),
    ).toThrow(
      `${PREFIX}: config 2 given to \`mergeConfigs\`: \`plugins[0]\`: \`prettier-plugin-jsdoc\` replaces the import sorter`,
    )
  })

  it('throws on the Tailwind plugin merged with a config whose import sorter is the wrapper', () => {
    expect(() =>
      mergeConfigs(baseConfig, defineConfig({ root: ROOT, tailwindcss: true, sortImports: false })),
    ).toThrow(
      new TypeError(
        `${PREFIX}: config 2 given to \`mergeConfigs\`: \`plugins[2]\`: \`prettier-plugin-tailwindcss\` can't compose the import sorter's wrapper of config 1, which \`defineConfig\` built without \`tailwindcss\`, so imports would stay unsorted. Turn the Tailwind plugin on with \`tailwindcss\` in the \`defineConfig\` call that sorts imports`,
      ),
    )
  })

  // prettier-plugin-classnames goes after the Tailwind plugin, and replaces its parsers
  it('throws on prettier-plugin-classnames with tailwindcss but without prettier-plugin-merge', () => {
    const options = { tailwindcss: true, sortImports: false }
    expect(build({ ...options, options: { plugins: ['prettier-plugin-classnames'] } })).toThrow(
      new TypeError(
        `${PREFIX}: \`options.plugins[0]\`: \`prettier-plugin-classnames\` replaces \`prettier-plugin-tailwindcss\`'s parsers, so classes would stay unsorted. Add \`prettier-plugin-merge\`, which runs both`,
      ),
    )
    // An override's plugins add to those of `options`
    expect(
      build({
        ...options,
        options: { plugins: ['prettier-plugin-merge'] },
        overrides: [{ files: '*.tsx', options: { plugins: ['prettier-plugin-classnames'] } }],
      }),
    ).not.toThrow()
  })

  // It reads every parser of the sorter that the Tailwind plugin loads, which fail without their
  // optional plugins. The wrapper without the Tailwind plugin leaves those parsers out
  it('throws on prettier-plugin-merge with tailwindcss while sortImports is on', () => {
    const options = { options: { plugins: ['prettier-plugin-merge'] } }
    expect(build({ tailwindcss: true, ...options })).toThrow(
      new TypeError(
        `${PREFIX}: \`options.plugins[0]\`: \`prettier-plugin-merge\` fails with the import sorter that \`prettier-plugin-tailwindcss\` loads, which has parsers for plugins that may not be installed. Set \`sortImports: false\` to use it`,
      ),
    )
    expect(build({ tailwindcss: true, sortImports: false, ...options })).not.toThrow()
    expect(build(options)).not.toThrow()
  })

  it("passes the sorter's other options through, without JSX in .mts and .cts files", () => {
    const config = defineConfig({
      root: ROOT,
      sortImports: {
        importOrderSafeSideEffects: ['^server-only$'],
        importOrderParserPlugins: ['typescript', 'jsx'],
      },
    })
    expect(config.importOrderSafeSideEffects).toEqual(['^server-only$'])
    expect(config.importOrderParserPlugins).toEqual(['typescript', 'jsx'])
    expect(config.overrides).toContainEqual({
      files: ['*.mts', '*.cts'],
      options: { importOrderParserPlugins: ['typescript'] },
    })
  })

  it('takes plugins, plugin keys and overrides in options, and undefined keys', () => {
    const config = build({
      astro: { astroSkipFrontmatter: true },
      markdown: { tailwindPreserveDuplicates: true, importOrder: undefined },
      overrides: [{ files: '*.ts', options: { importOrderParserPlugins: ['typescript'] } }],
      options: {
        plugins: ['prettier-plugin-other'],
        astroAllowShorthand: true,
        packageSortOrder: ['name'],
        importOrder: undefined,
        tailwindFunctions: undefined,
        tailwindPreserveDuplicates: true,
        overrides: [{ files: '*.js', options: { semi: true } }],
      },
    })()
    // The overrides in `options` go after the `overrides` option's
    expect(config.overrides?.slice(-2)).toEqual([
      { files: '*.ts', options: { importOrderParserPlugins: ['typescript'] } },
      { files: '*.js', options: { semi: true } },
    ])
    expect(config.plugins?.at(-1)).toBe('prettier-plugin-other')
    expect(config).toMatchObject({
      astroAllowShorthand: true,
      packageSortOrder: ['name'],
      tailwindPreserveDuplicates: true,
      importOrder: baseConfig.importOrder,
    })
    expect(config).not.toHaveProperty('tailwindFunctions')
    expect(config.overrides).toContainEqual({
      files: '*.astro',
      options: { parser: 'astro', astroSkipFrontmatter: true },
    })
  })
})

describe('the import sorter wrapper', () => {
  // The sorter's `oxc` parser needs `@prettier/plugin-oxc`. The Vue and Ember parsers stay out
  // with their plugins installed
  it.each([
    [
      [
        '@prettier/plugin-oxc',
        'prettier-plugin-ember-template-tag',
        'content-tag',
        '@vue/compiler-sfc',
      ],
      ['babel', 'oxc'],
    ],
    [['prettier-plugin-ember-template-tag', 'content-tag', '@vue/compiler-sfc'], ['babel']],
  ])('with %j installed, keeps the parsers %j', async (installed, parsers) => {
    const stub = (name: string) => ({
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, main: 'index.cjs' }),
      [`node_modules/${name}/index.cjs`]: '',
    })
    await using project = await withTmpProject('prettier-config-wrapper', {
      'wrapper.ts': await fs.readFile(SORT_IMPORTS_WRAPPER, 'utf8'),
      ...stub('@ianvs/prettier-plugin-sort-imports'),
      'node_modules/@ianvs/prettier-plugin-sort-imports/index.cjs': [
        'const parser = (name) => ({ get [name]() { return {} } })',
        "module.exports = { parsers: { ...parser('babel'), ...parser('ember-template-tag'), ...parser('oxc'), ...parser('vue') } }",
      ].join('\n'),
      ...Object.fromEntries(installed.flatMap((name) => Object.entries(stub(name)))),
    })
    const stdout = await runNodeOk(
      [
        '--input-type=module',
        '--eval',
        "const { parsers } = await import('./wrapper.ts'); console.log(JSON.stringify(Object.keys(parsers)))",
      ],
      { cwd: project.dir },
    )
    expect(JSON.parse(stdout)).toEqual(parsers)
  })
})
