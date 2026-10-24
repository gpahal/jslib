import path from 'node:path'
import { pathToFileURL } from 'node:url'

import json from '@eslint/json'
import type { Linter } from 'eslint'
import * as eslintPluginRegexp from 'eslint-plugin-regexp'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig, files, untyped, withoutFormattingRules } from '@/index'
import type { ConfigNames, TypedRules } from '@/index'

import { eslintWith, FIXTURES_DIR } from './helpers'

const root = path.join(FIXTURES_DIR, 'rules')

/**
 * An existing Tailwind CSS entry point, relative to `root`
 */
const entryPoint = '../tailwindcss/src/styles.css'

/**
 * `options` that the type would reject, to check what `defineConfig` does with them at runtime
 */
function build(options: Record<string, unknown>) {
  return () => defineConfig({ root, ...options })
}

type Composer = ReturnType<typeof defineConfig>

/**
 * The composer's methods as JavaScript callers can call them, with arguments the types reject
 */
type UntypedComposer = Record<string, (...args: Array<unknown>) => Composer>

function untypedComposer(): UntypedComposer {
  const composer: unknown = defineConfig({ root })
  return composer as UntypedComposer
}

/**
 * The glob of the JSON, YAML, TOML, Markdown and HTML files, which the JavaScript rules of a
 * config of yours skip
 */
const NON_CODE_FILES = '**/*.{json,jsonc,json5,yml,yaml,toml,md,markdown,html}'

const CODE_FILES = '**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'

/**
 * A plugin of one rule that runs only on JSON
 */
const jsonOnlyPlugin = {
  rules: { json: { meta: { languages: ['json/json'] }, create: () => ({}) } },
}

/**
 * A preset in a common shape: a config that registers the plugin, then configs of rules without
 * `plugins`
 */
const FORMATTING_RULES = [
  'react/jsx-indent',
  'react/jsx-curly-spacing',
  'react/jsx-max-props-per-line',
]

const reactPreset = [
  {
    name: 'react/base/setup',
    plugins: {
      react: {
        rules: Object.fromEntries(
          [...FORMATTING_RULES, 'react/no-danger'].map((rule) => [
            rule.slice('react/'.length),
            { create: () => ({}) },
          ]),
        ),
      },
    },
  },
  {
    name: 'react/recommended/rules',
    files: ['**/*.jsx'],
    rules: Object.fromEntries(
      [...FORMATTING_RULES, 'react/no-danger'].map((rule) => [rule, 'warn']),
    ),
  },
]

/**
 * A rule that no plugin has, which the types would reject
 */
const misspelled = untyped({ rules: { 'no-consol': 'off' } })

/**
 * A config of the presets whose project service options a change may not set
 */
const LANGUAGE_OPTIONS = 'gpahal/javascript/language-options'

/**
 * Every check that rejects options, a config of yours or a composer call, each through one way in.
 * The messages are in the snapshot, as `throws:` for a check when called and `rejects:` for one when
 * awaited. The test below checks that every way of adding a config of yours runs the checks of a
 * config
 */
const GUARD_RAILS: Array<[string, () => unknown]> = [
  // The options
  ['an unknown option', build({ typescript: { typeAwre: false } })],
  ['a relative `root`', build({ root: 'packages/a' })],
  ['`ignores` as a string', build({ ignores: 'dist' })],
  ['`typescript: false`', build({ typescript: false })],
  ['an unknown `typescript.exhaustiveSwitch`', build({ typescript: { exhaustiveSwitch: 'all' } })],
  ['`nextjs` with `react: false`', build({ nextjs: true, react: false })],
  ['a `nextjs.rootDir` outside `root`', build({ nextjs: { rootDir: '../react' } })],
  // Checked before the folders are looked up
  ['an absolute `nextjs.rootDir`', build({ nextjs: { rootDir: '/apps/web' } })],
  ['a glob in `nextjs.rootDir`', build({ nextjs: { rootDir: 'apps/*/' } })],
  ['a `testFiles` glob of no code file', build({ testFiles: ['**/*.test.md'] })],
  [
    'a `tailwindcss.scope` glob of no code or `.astro` file',
    build({ astro: true, tailwindcss: { scope: ['apps/**/*.html'], entryPoint } }),
  ],
  ['an empty `vitest.files`', build({ vitest: { files: [] } })],
  ['only negated globs in `testFiles`', build({ testFiles: () => ['!**/fixtures/**'] })],
  ['only negated globs in `server.files`', build({ server: { files: ['!src/client/**'] } })],
  ['only negated globs in `node.scope`', build({ node: { scope: ['!apps/x/**'] } })],
  ['a `commonjs.files` glob of no `.js` file', build({ commonjs: { files: ['src/**/*.ts'] } })],
  ['an absolute `typeAware.ignores` glob', build({ typeAware: { ignores: ['/abs/**'] } })],
  ['a `typeAware.ignores` glob of no code file', build({ typeAware: { ignores: ['src/*.css'] } })],
  ['`typeAware.ignores` as a string', build({ typeAware: { ignores: 'src/**' } })],
  ['`browser` as an array', build({ browser: ['src/client/**'] })],
  [
    'a `typeAware.allowDefaultProject` glob with `**`',
    build({ typeAware: { allowDefaultProject: () => ['**/*.config.ts'] } }),
  ],
  [
    'a `typeAware.allowDefaultProject` glob of every root file',
    build({ typeAware: { allowDefaultProject: ['*.config.ts', './*'] } }),
  ],
  [
    'a negated `typeAware.allowDefaultProject` glob',
    build({ typeAware: { allowDefaultProject: ['!x.ts'] } }),
  ],
  [
    '`typescript.rulesTypeAware` with `typeAware: false`',
    build({ typeAware: false, typescript: { rulesTypeAware: { 'no-console': 'off' } } }),
  ],
  [
    '`antislop.cognitiveComplexity` with `antislop.sonarjs: false`',
    build({ antislop: { sonarjs: false, cognitiveComplexity: 10 } }),
  ],
  ['no `tailwindcss.entryPoint`', build({ tailwindcss: {} })],
  ['`tailwindcss.settings.entryPoint`', build({ tailwindcss: { settings: { entryPoint } } })],
  ['a rule of another area', build({ markdown: { rules: { 'unicorn/no-null': 'off' } } })],
  [
    'an `allowFormattingRules` rule eslint-config-prettier keeps',
    build({ allowFormattingRules: ['no-console'] }),
  ],
  [
    'an `allowFormattingRules` rule this package keeps on',
    build({ allowFormattingRules: ['no-unexpected-multiline'] }),
  ],
  [
    '`antislop` sub-options that turn off every rule',
    build({ antislop: { slop: false, sonarjs: false } }),
  ],
  [
    '`antislop` sub-options that turn off every rule, with `rules` turning one off',
    build({
      antislop: { slop: false, sonarjs: false, rules: { 'sonarjs/no-commented-code': 'off' } },
    }),
  ],
  [
    '`e18e` sub-options that turn off every rule',
    build({
      e18e: { modernization: false, moduleReplacements: false, performanceImprovements: false },
    }),
  ],
  [
    '`e18e` sub-options that turn off every rule, with `rules` turning one off',
    build({
      e18e: {
        modernization: false,
        moduleReplacements: false,
        performanceImprovements: false,
        rules: { 'e18e/prefer-timer-args': 'off' },
      },
    }),
  ],
  // @ts-expect-error -- Values the type rejects, to check what `defineConfig` does at runtime
  ['`undefined` as the options', () => defineConfig(undefined)],
  // @ts-expect-error -- As above
  ['`null` as the options', () => defineConfig(null)],
  // @ts-expect-error -- As above
  ['a string as the options', () => defineConfig('tsconfig.json')],
  // @ts-expect-error -- As above
  ['an array as the options', () => defineConfig(['react'])],

  // Globs and paths, which every glob option checks with `checkRelativeGlobsAt`, as the tests of
  // each option below show
  ['an empty glob', build({ testFiles: [''] })],
  ['a `!` glob', build({ testFiles: ['!'] })],
  ['a negated glob that starts with `/`', build({ testFiles: ['src/**', '!/lib/**'] })],
  ['a glob that starts with `..`', build({ testFiles: ['./../x/*.ts'] })],
  ['a glob with `\\` separators', build({ testFiles: [String.raw`src\**\*.ts`] })],
  ['an absolute `gitignore.files` path', build({ gitignore: { files: ['/abs'] } })],
  ['a `gitignore.files` path with `..`', build({ gitignore: { files: ['a/../../x'] } })],
  ['brace alternatives of no code file', build({ testFiles: ['src/{a.css,{b,c}/d.css}'] })],
  ['too many brace alternatives', build({ node: { scope: ['src/{1..5000}.ts'] } })],
  [
    'an AND entry of brace patterns with too many combinations',
    build({
      typeAware: false,
      configs: [
        {
          files: [
            ['env', 'region', 'component', 'version', 'name'].map(
              (key) =>
                `**/*{${[
                  'dev',
                  'test',
                  'stage',
                  'prod',
                  'local',
                  'qa',
                  'uat',
                  'demo',
                  'perf',
                  'canary',
                ]
                  .map((value) => `${key}-${value}`)
                  .join(',')}}*.json`,
            ),
          ],
          language: 'json/json',
        },
      ],
    }),
  ],
  [
    'a glob with `..` in the `files` of a nested config of yours',
    build({ configs: [[{ files: [['src/**', '../src/**']], rules: { 'no-console': 'off' } }]] }),
  ],
  [
    'a glob with `..` in the `ignores` of an `.override()`',
    () => defineConfig({ root }).override('gpahal/javascript/rules', { ignores: ['../src/**'] }),
  ],
  [
    'an absolute glob in an `.override()` of a split config of yours',
    () =>
      defineConfig({
        root,
        configs: [{ name: 'user/split', rules: { 'no-console': 'off', eqeqeq: 'error' } }],
      }).override('user/split' as ConfigNames, {
        files: [`${root.split(path.sep).join('/')}/src/**`],
      }),
  ],

  // Formatting rules
  [
    "the `html` preset plugin's layout rule",
    build({ typeAware: false, html: { rules: { '@html-eslint/indent': 'error' } } }),
  ],
  [
    "the `astro` preset plugin's layout rule",
    build({ typeAware: false, astro: { rules: { 'astro/semi': 'error' } } }),
  ],
  ["a plugin's preset with formatting rules", build({ configs: reactPreset })],
  [
    'formatting rules that a config of yours extends',
    build({ configs: [{ extends: [{ rules: { curly: 'error', semi: 'error' } }] }] }),
  ],
  [
    '`.overrideRules()` of a formatting rule',
    () => defineConfig({ root }).overrideRules({ curly: 'error' }),
  ],

  // Rule names and plugins
  [
    'a rule that no plugin has, turned off in an area',
    build({ unicorn: { rules: { 'unicorn/no-nul': 'off' } } }),
  ],
  [
    'a rule that ESLint lacks, turned off in a config of yours',
    build({ configs: [{}, untyped({ name: 'user/x', rules: { 'no-consol': 'off' } })] }),
  ],
  [
    'a rule of a plugin no config registers',
    build({ configs: [[{}, { files: ['**/*.ts'], rules: { 'some/rule': 'off' } }]] }),
  ],
  [
    'a rule that ESLint lacks, in an `.override()`',
    () =>
      defineConfig({ root }).override('gpahal/javascript/rules', (config) => ({
        ...config,
        rules: { ...config.rules, ...misspelled.rules },
      })),
  ],
  [
    'a rule that no plugin has, in `.removeRules()`',
    () => defineConfig({ root }).removeRules('unicorn/no-nul' as keyof TypedRules),
  ],
  [
    'a rule that ESLint lacks, in `.disableRulesFix()`',
    // @ts-expect-error -- No preset turns on a rule of this name
    () => defineConfig({ root }).disableRulesFix('prefer-konst'),
  ],
  [
    'a rule of a plugin that `antislop.slop: false` turns off',
    build({ antislop: { slop: false }, configs: [{ rules: { 'slop/no-em-dash': 'off' } }] }),
  ],
  [
    'a rule of a plugin that two options turn off',
    build({
      antislop: { sonarjs: false, rules: { 'sonarjs/no-commented-code': 'off' } },
      sonarjs: false,
    }),
  ],
  [
    'a rule of a plugin that `unicorn: false` turns off',
    build({
      unicorn: false,
      configs: [{ files: ['**/*.ts'], rules: { 'unicorn/no-null': 'error' } }],
    }),
  ],
  [
    'another plugin under a preset plugin name, in a nested config of yours',
    () =>
      defineConfig({
        root: path.join(FIXTURES_DIR, 'markdown'),
        configs: [[{}, { plugins: { 'package-json': { rules: {} } } }]],
      }),
  ],
  [
    'another plugin under the `@gpahal` name',
    () =>
      defineConfig({
        root: path.join(FIXTURES_DIR, 'markdown'),
        configs: [{ plugins: { '@gpahal': { rules: {} } } }],
      }),
  ],
  [
    'a `.remove()` of the config of a plugin whose rules other configs turn on',
    () =>
      defineConfig({
        root,
        typeAware: false,
        configs: [
          { name: 'user/plugin', plugins: { mine: { rules: { always: { create: () => ({}) } } } } },
          untyped({ name: 'user/rules', files: ['**/*.js'], rules: { 'mine/always': 'error' } }),
        ],
      }).remove('user/plugin' as ConfigNames),
  ],

  // Where the rules of a config of yours can run
  [
    'a `package.json` rule in a config of yours without `files`',
    build({ configs: [{ name: 'user/x', rules: { 'package-json/require-license': 'error' } }] }),
  ],
  [
    'a YAML rule in a config of yours without `files`',
    build({ configs: [{ name: 'user/x', rules: { 'yml/no-empty-key': 'error' } }] }),
  ],
  [
    'a Markdown rule in a config of yours without `files`',
    build({ configs: [{ name: 'user/x', rules: { 'markdown/no-html': 'error' } }] }),
  ],
  [
    'an HTML rule in a config of yours without `files`',
    build({ configs: [{ name: 'user/x', rules: { '@html-eslint/require-img-alt': 'error' } }] }),
  ],
  // Turned off beside a code rule, it goes to a part for every file, unless the config's
  // `languageOptions` keep it with the code rules
  [
    'a YAML rule turned off beside a code rule in a config of yours with `languageOptions`',
    build({
      configs: [
        {
          languageOptions: { globals: {} },
          rules: { 'yml/no-empty-key': 'off', 'no-console': 'error' },
        },
      ],
    }),
  ],
  [
    "a config of yours whose `files` match only files where a rule can't run",
    // `\{a,b}.json` is the name `{a,b}.json`, not `a.json` or `b.json`
    build({
      configs: [
        untyped({
          files: [['**/a.json', String.raw`!**/\{a,b}.json`]],
          rules: { 'unicorn/no-null': 'error' },
        }),
      ],
    }),
  ],
  [
    'a JSON rule in a config of yours for code files',
    build({
      configs: [untyped({ files: ['src/**'], rules: { 'json/no-duplicate-keys': 'error' } })],
    }),
  ],
  [
    'a Markdown rule in a config of yours for code files',
    build({
      configs: [untyped({ files: ['**/*.tsx'], rules: { 'markdown/no-bare-urls': 'error' } })],
    }),
  ],
  [
    'a `package.json` rule in a config of yours for every JSON file',
    build({
      configs: [
        untyped({ files: ['**/*.json'], rules: { 'package-json/require-version': 'error' } }),
      ],
    }),
  ],
  [
    'a rule whose `meta.languages` leaves out `js/js` in a config of yours for code files',
    build({
      configs: [
        {
          files: ['**/*.ts'],
          plugins: { local: jsonOnlyPlugin },
          rules: { 'local/json': 'error' },
        },
      ],
    }),
  ],
  // The check of the configs that `scopeUserConfig` returns rejects these two
  [
    'a rule whose `meta.languages` leaves out `js/js` in a config of yours without `files`',
    build({ configs: [{ plugins: { local: jsonOnlyPlugin }, rules: { 'local/json': 'error' } }] }),
  ],
  [
    "a rule its language can't run in a config of yours with `language`",
    build({
      configs: [
        { files: ['**/*.json'], language: 'json/json', rules: { 'unicorn/no-null': 'error' } },
      ],
    }),
  ],
  [
    "an `.override()` without `files` that turns on a rule some files can't run",
    () =>
      defineConfig({ root }).override('gpahal/setup', (config) => ({
        ...config,
        rules: { 'unicorn/no-null': 'error' },
      })),
  ],
  [
    "an `.override()` of the code blocks config that turns on a rule JSON code blocks can't run",
    () =>
      defineConfig({ root }).override('gpahal/markdown/code-blocks', {
        rules: { 'unicorn/no-null': 'error' },
      }),
  ],
  [
    "an `.override()` of a config with `language` that turns on a rule it can't run",
    () =>
      defineConfig({ root, typeAware: false }).override('gpahal/json/json', {
        rules: { 'unicorn/no-null': 'error' },
      }),
  ],
  [
    "an `.override()` of a YAML config without `language` that turns on a rule YAML can't run",
    () =>
      defineConfig({ root, typeAware: false }).override('gpahal/yaml/rules', {
        rules: { 'unicorn/no-null': 'error' },
      }),
  ],
  [
    'an `.override()` function that drops the `files` of a config for code files only',
    () =>
      defineConfig({ root }).override('gpahal/unicorn/rules', ({ files: _files, ...rest }) => rest),
  ],
  [
    'an `.override()` that widens a config for code files only to every file',
    () =>
      defineConfig({ root, typeAware: false }).override('gpahal/unicorn/rules', {
        files: ['**/*'],
      }),
  ],
  // A negated glob matches every file but those it names, JSON and YAML files included
  [
    'an `.override()` that widens a config for code files only with a negated glob',
    () =>
      defineConfig({ root, typeAware: false }).override('gpahal/unicorn/rules', {
        files: ['!**/*.md'],
      }),
  ],
  [
    'an `.override()` that adds a JSON rule to a config for code files only',
    () =>
      defineConfig({ root }).override('gpahal/javascript/rules', {
        rules: { 'json/no-duplicate-keys': 'error' },
      }),
  ],
  [
    '`languageOptions.math` in a config of yours that can match Markdown files',
    build({ configs: [{ files: ['docs/*.{md,ts}'], languageOptions: { math: true } }] }),
  ],
  [
    'an `.override()` that changes `languageOptions.math` of a Markdown config',
    () =>
      defineConfig({ root, markdown: true }).override('gpahal/markdown/rules', {
        languageOptions: { math: true },
      }),
  ],
  [
    'an `.onResolved()` callback that changes `languageOptions.math` of a Markdown config in place',
    () =>
      defineConfig({ root, markdown: true }).onResolved((configs) => {
        const config = configs.find((found) => found.name === 'gpahal/markdown/rules')
        Reflect.set(config?.languageOptions ?? {}, 'math', true)
      }),
  ],
  [
    'the project service in a config of yours',
    build({
      configs: [
        untyped({
          files: ['**/*.ts'],
          languageOptions: { parserOptions: { projectService: false } },
        }),
      ],
    }),
  ],
  [
    '`tsconfigRootDir` in a config of yours',
    build({
      configs: [untyped({ languageOptions: { parserOptions: { tsconfigRootDir: root } } })],
    }),
  ],
  [
    'an `.override()` that sets the project service',
    () =>
      defineConfig({ root }).override(LANGUAGE_OPTIONS, {
        languageOptions: { parserOptions: { projectService: { allowDefaultProject: ['x.ts'] } } },
      }),
  ],
  [
    'an `.onResolved()` callback that deletes `tsconfigRootDir` in place',
    () =>
      defineConfig({ root }).onResolved((configs) => {
        const config = configs.find((found) => found.name === LANGUAGE_OPTIONS)
        Reflect.deleteProperty(config?.languageOptions?.['parserOptions'] ?? {}, 'tsconfigRootDir')
      }),
  ],

  // The shape of a config of yours
  ['`undefined` in `configs`', build({ configs: [{}, undefined] })],
  ['a string in a nested array of `configs`', build({ configs: [[{}, ['foo']]] })],
  ['a `basePath` that is no string', build({ configs: [{ basePath: 1 }] })],
  ['`files` that is no array', build({ configs: [{ files: '**/*.md' }] })],
  ['`settings` that is no object', build({ configs: [{ settings: [] }] })],
  [
    'a string in `extends` of no registered plugin',
    build({ configs: [{ extends: ['js/recommended'] }] }),
  ],
  [
    'a string in `extends` of a missing config',
    build({
      configs: [
        {
          plugins: { local: { configs: {}, rules: { demo: { create: () => ({}) } } } },
          extends: ['local/missing'],
        },
      ],
    }),
  ],
  ['a nested `extends`', build({ configs: [{ extends: [{ extends: [{ rules: {} }] }] }] })],

  // The composer's methods
  [
    'an `.override()` function that returns `undefined`',
    () => untypedComposer()['override']!('gpahal/javascript/rules', () => undefined),
  ],
  [
    'an `.onResolved()` callback that returns `null` in its array',
    () => untypedComposer()['onResolved']!(() => [{}, null]),
  ],
  ['`.overrideRules()` of an array', () => untypedComposer()['overrideRules']!(['no-console'])],
  ['`.override()` of no name', () => untypedComposer()['override']!(undefined, {})],
  [
    '`.overrideRules()` of an unknown severity',
    () => untypedComposer()['overrideRules']!({ 'no-console': 'warning' }),
  ],
  [
    '`.overrideRules()` of an unknown severity in an array',
    () => untypedComposer()['overrideRules']!({ 'no-console': ['warning'] }),
  ],
  [
    '`.overrideRules()` that turns on a rule no config turns on',
    () => defineConfig({ root }).overrideRules({ 'no-plusplus': 'error' }),
  ],
  [
    '`.disableRulesFix()` of no rule name',
    // @ts-expect-error -- A rule name is a string
    () => defineConfig({ root }).disableRulesFix('prefer-const', 1),
  ],
  ['`.remove()` of no name', () => defineConfig({ root }).remove()],
  [
    '`.remove()` of a name twice',
    () => defineConfig({ root }).remove('gpahal/jsdoc/rules', 'gpahal/jsdoc/rules'),
  ],
  [
    '`.override()` of a config of an option that is off',
    () => defineConfig({ root }).override('gpahal/react/rules', {}),
  ],
  [
    '`.remove()` of a config of an option that is off',
    () => defineConfig({ root }).remove('gpahal/react/rules'),
  ],
  [
    '`.insertBefore()` of a config of an option that is off',
    () => defineConfig({ root }).insertBefore('gpahal/react/rules', {}),
  ],
  [
    '`.insertAfter()` of a config of an option that is off',
    () => defineConfig({ root }).insertAfter('gpahal/react/rules', {}),
  ],
  [
    '`.remove()` of a config of an option that is on, without the setting that adds it',
    () => defineConfig({ root }).remove('gpahal/typescript/library'),
  ],
  [
    "`.remove()` of an area's user rules, without its `rules`",
    () => defineConfig({ root }).remove('gpahal/unicorn/user-rules'),
  ],
  [
    '`.remove()` of a type-aware config with `typeAware: false`',
    () => defineConfig({ root, typeAware: false }).remove('gpahal/typescript/type-aware'),
  ],
  [
    '`.remove()` of a name no config of the package has',
    () => defineConfig({ root }).remove('gpahal/typescript/rulez' as ConfigNames),
  ],
  [
    '`.override()` of a config an earlier `.remove()` removed',
    () =>
      defineConfig({ root })
        .remove('gpahal/jsdoc/rules', 'gpahal/typescript/rules')
        .override('gpahal/typescript/rules', {}),
  ],
]

/**
 * How `run` fails, as `throws: <message>` or `rejects: <message>`, with paths under the fixtures
 * folder starting with `<fixtures>`
 *
 * @throws Error when it neither throws nor rejects.
 */
async function failureOf(run: () => unknown): Promise<string> {
  const messageOf = (error: unknown) =>
    (error instanceof Error ? error.message : String(error)).replaceAll(
      FIXTURES_DIR.split(path.sep).join('/'),
      '<fixtures>',
    )
  let result: unknown
  try {
    result = run()
  } catch (error) {
    return `throws: ${messageOf(error)}`
  }
  try {
    await result
  } catch (error) {
    return `rejects: ${messageOf(error)}`
  }
  throw new Error('expected it to throw or reject')
}

test('rejects what no options, config of yours or composer call may hold, with these messages', async () => {
  expect(new Set(GUARD_RAILS.map(([label]) => label)).size).toBe(GUARD_RAILS.length)
  const failures: Record<string, string> = {}
  for (const [label, run] of GUARD_RAILS) {
    failures[label] = await failureOf(run)
  }
  expect(failures).toMatchSnapshot()
})

/**
 * A config that each way of adding a config of yours must reject, as a config added as it is or as
 * the change of a config, its message after the subject, and whether `defineConfig` throws on it
 * in `configs` rather than rejecting when awaited
 */
const BAD_CONFIGS: Array<[string, Linter.Config, string, boolean]> = [
  [
    'a formatting rule',
    { rules: { curly: 'error' } },
    '`curly`: is a rule that eslint-config-prettier turns off',
    true,
  ],
  // A check that needs the presets' plugins, which load when the composer is awaited
  [
    'another plugin under a preset plugin name',
    { plugins: { unicorn: { rules: {} } } },
    'registers `unicorn` again with a different plugin',
    false,
  ],
]

/**
 * Each composer method that adds or changes a config of yours, with the subject of its errors
 */
const ADDERS: Array<[string, (config: Linter.Config) => unknown, string]> = [
  ['`configs`', (config) => defineConfig({ root, configs: [config] }), '`configs[0]`'],
  ['`.append()`', (config) => defineConfig({ root }).append(config), '`.append()`: item `[0]`'],
  [
    '`.insertBefore()`',
    (config) => defineConfig({ root }).insertBefore('gpahal/config-files/console', config),
    '`.insertBefore()`: item `[0]`',
  ],
  [
    '`.insertAfter()`',
    (config) => defineConfig({ root }).insertAfter('gpahal/config-files/console', config),
    '`.insertAfter()`: item `[0]`',
  ],
  [
    'an `.override()` object',
    (config) => defineConfig({ root }).override('gpahal/javascript/rules', config),
    "`.override('gpahal/javascript/rules')`",
  ],
  [
    'an `.override()` function',
    (config) =>
      defineConfig({ root }).override('gpahal/javascript/rules', (original) => ({
        ...original,
        rules: { ...original.rules, ...config.rules },
        plugins: { ...original.plugins, ...config.plugins },
      })),
    "`.override('gpahal/javascript/rules')`",
  ],
  [
    'a config an `.onResolved()` callback adds',
    (config) => defineConfig({ root }).onResolved((configs) => [...configs, config]),
    '`.onResolved()`',
  ],
  [
    'a change an `.onResolved()` callback makes in place',
    (config) =>
      defineConfig({ root }).onResolved((configs) => {
        const found = configs.find(({ name }) => name === 'gpahal/javascript/rules')
        if (found === undefined) {
          return
        }

        found.rules = { ...found.rules, ...config.rules }
        found.plugins = { ...found.plugins, ...config.plugins }
      }),
    '`.onResolved()` (`gpahal/javascript/rules`)',
  ],
]

describe.each(BAD_CONFIGS)('rejects %s', (_, config, description, isSyncInConfigs) => {
  it.each(ADDERS)('through %s', async (name, add, subject) => {
    expect(await failureOf(() => add(config))).toMatch(
      new RegExp(
        // Without the subject's closing backtick, which a key such as `.plugins` may follow
        `^${name === '`configs`' && isSyncInConfigs ? 'throws' : 'rejects'}: @gpahal/eslint-config: ${RegExp.escape(subject.slice(0, -1))}.*: ${RegExp.escape(description)}`,
        'u',
      ),
    )
  })
})

test.each([
  [{ antislop: { cognitiveComplexity: false } }],
  [{ tailwindcss: { entryPoint: pathToFileURL(path.resolve(root, entryPoint)) } }],
  [{ tailwindcss: { entryPoint: pathToFileURL(path.resolve(root, entryPoint)).href } }],
  [{ vitest: { files: ['tests/**', '!**/*.snap'] } }],
  [{ testFiles: ['tests/????'] }],
  [{ testFiles: ['tests/!(fixtures)'] }],
  [{ astro: true, html: true, tailwindcss: { scope: ['apps/**/*.astro'], entryPoint } }],
  [{ isInEditor: undefined, markdown: undefined }],
])('accepts %j', async (options) => {
  // Awaited, so an option that fails while the configs are built fails the test
  await expect(build(options)()).resolves.toBeInstanceOf(Array)
})

/**
 * An area's options that turn `rule` off
 */
const off = (rule: string) => ({ rules: { [rule]: 'off' } }) as const

/**
 * The options that set each glob option to `globs`
 */
const GLOB_OPTIONS: Array<[string, (globs: Array<string>) => Record<string, unknown>]> = [
  ['testFiles', (globs) => ({ testFiles: () => globs })],
  ['vitest.files', (globs) => ({ vitest: { files: globs } })],
  ['browser.files', (globs) => ({ browser: { files: globs } })],
  ['react.scope', (globs) => ({ react: { scope: globs } })],
  ['tailwindcss.scope', (globs) => ({ tailwindcss: { scope: globs, entryPoint } })],
  ['ignores', (globs) => ({ ignores: (defaults: Array<string>) => [...defaults, ...globs] })],
  ['typeAware.allowDefaultProject', (globs) => ({ typeAware: { allowDefaultProject: globs } })],
]

// The guard rails above check each kind of malformed glob through `testFiles`
test.each(GLOB_OPTIONS)(
  'checks the globs of `%s` as relative to `root`, taking escaped punctuation',
  (name, optionsOf) => {
    const absolute = `${root.split(path.sep).join('/')}/src/**`
    // The guard rails above hold the whole message; the fix is relative to `root`
    expect(build(optionsOf([absolute]))).toThrow(
      new RegExp(
        `^@gpahal/eslint-config: \`${RegExp.escape(name)}\`: glob \`${RegExp.escape(absolute)}\` .* Write \`src/\\*\\*\`$`,
        'u',
      ),
    )
    // An escaped punctuation character, such as `\[`, `\,` or `\\`, matches it literally
    expect(
      build(
        optionsOf([
          String.raw`src/\[id\]/*.ts`,
          String.raw`src/a\\b*.ts`,
          String.raw`src/{a\,b,c}.ts`,
        ]),
      ),
    ).not.toThrow()
  },
)

// An option of its own and one of an area
test.each([GLOB_OPTIONS[0]!, GLOB_OPTIONS[2]!])(
  'takes a glob of `%s` that starts with `./`, which matches the files as without it',
  async (_, optionsOf) => {
    // Whether ESLint ignores a file of `src`, and the rules and globals it gets
    const settingsOf = async (glob: string) => {
      const eslint = eslintWith(
        root,
        await defineConfig({ root, typeAware: false, ...optionsOf([glob]) }),
      )
      const config = (await eslint.calculateConfigForFile('src/a.ts')) as Linter.Config | undefined
      return {
        isIgnored: await eslint.isPathIgnored('src/a.ts'),
        rules: config?.rules,
        globals: config?.languageOptions?.['globals'],
      }
    }
    const dotted = await settingsOf('./src/**')
    expect(dotted).toEqual(await settingsOf('src/**'))
    expect(dotted).not.toEqual(await settingsOf('other/**'))
  },
)

test('takes brace alternatives of which one matches code files', () => {
  expect(build({ testFiles: ['src/{styles.css,{client,server}/{a.css,b.ts}}'] })).not.toThrow()
})

function configNames(configs: Array<Linter.Config>): Array<string | undefined> {
  return configs.map((config) => config.name)
}

test('takes `browser: false` as leaving it out', async () => {
  expect(configNames(await build({ browser: false })())).toEqual(configNames(await build({})()))
})

test('accepts an empty root folder', async () => {
  await using project = await withTmpProject('eslint-config-root')
  expect(configNames(await defineConfig({ root: project.dir }))).toContain('gpahal/setup')
})

test('resolves from root, whatever the working directory', async () => {
  await using project = await withTmpProject('eslint-config-root', {
    'app/.gitignore': 'out\n',
    'app/src/.gitignore': 'gen\n',
    'cwd/a.txt': '',
  })
  const options = { root: path.join(project.dir, 'app'), typeAware: false } as const
  const ignoreConfigs = async () =>
    (await defineConfig(options)).filter((config) => config.name?.includes('ignore') === true)
  const before = await ignoreConfigs()
  expect(before.flatMap((config) => config.ignores ?? [])).toEqual(
    expect.arrayContaining(['**/out', 'src/**/gen']),
  )
  const cwd = process.cwd()
  process.chdir(path.join(project.dir, 'cwd'))
  try {
    expect(await ignoreConfigs()).toEqual(before)
  } finally {
    process.chdir(cwd)
  }
})

test('accepts every documented option', async () => {
  const configs = await defineConfig({
    root,
    isInEditor: false,
    gitignore: { files: ['tsconfig.json'] },
    ignores: (defaults) => [...defaults, 'fixtures'],
    testFiles: (defaults) => [...defaults, '**/*.check.ts'],
    typeAware: { javascript: false, allowDefaultProject: (defaults) => defaults },
    javascript: off('no-console'),
    typescript: {
      rules: { 'no-console': 'off', '@typescript-eslint/array-type': 'off' },
      rulesTypeAware: { '@typescript-eslint/no-floating-promises': 'off' },
      library: true,
      exhaustiveSwitch: 'strict',
      strictBooleanExpressions: false,
    },
    imports: off('import-x/first'),
    unicorn: off('unicorn/no-null'),
    regexp: off('regexp/no-useless-flag'),
    commentLayout: off('@gpahal/comment-layout'),
    e18e: {
      ...off('e18e/prefer-timer-args'),
      modernization: true,
      moduleReplacements: true,
      performanceImprovements: true,
    },
    antislop: {
      ...off('sonarjs/no-commented-code'),
      slop: { cwd: root, inspection: { mode: 'recent-changes', tracebackCommits: 3 } },
      sonarjs: true,
      cognitiveComplexity: 20,
    },
    eslintComments: off('@eslint-community/eslint-comments/no-aggregating-enable'),
    jsdoc: off('jsdoc/check-access'),
    json: off('json/no-duplicate-keys'),
    yaml: off('yml/no-empty-key'),
    pnpm: off('pnpm/json-valid-catalog'),
    packageJson: off('package-json/require-description'),
    markdown: off('markdown/no-empty-links'),
    react: { ...off('react-hooks/rules-of-hooks'), scope: ['apps/web/**'], refresh: true },
    nextjs: { ...off('@next/next/no-img-element'), scope: ['apps/web/**'] },
    astro: off('astro/no-conflict-set-directives'),
    html: off('@html-eslint/require-img-alt'),
    tailwindcss: {
      ...off('better-tailwindcss/no-duplicate-classes'),
      scope: ['apps/web/**'],
      entryPoint,
      settings: { detectComponentClasses: true, rootFontSize: 16 },
    },
    node: { ...off('n/no-deprecated-api'), scope: ['scripts/**'] },
    turbo: off('turbo/no-undeclared-env-vars'),
    vitest: { ...off('vitest/no-focused-tests'), files: ['**/*.test.ts'] },
    browser: { files: ['src/client/**'] },
    server: { files: () => ['src/server/**'] },
    allowFormattingRules: ['curly'],
    configs: [{ rules: { 'no-console': 'off', curly: ['error', 'all'] } }],
  })
  expect(configs.length).toBeGreaterThan(0)
})

test.each([
  ['html', '@html-eslint/indent'],
  ['astro', 'astro/semi'],
] as const)(
  "takes the `%s` preset plugin's layout rule `%s` that `allowFormattingRules` lists",
  async (area, rule) => {
    const configs = await build({
      typeAware: false,
      allowFormattingRules: [rule],
      [area]: { rules: { [rule]: 'error' } },
    })()
    expect(configs.some((config) => config.rules?.[rule] === 'error')).toBe(true)
  },
)

test('takes a rule of a plugin that a config of yours registers', async () => {
  const plugin = { rules: { rule: { create: () => ({}) } } }
  await expect(
    build({ configs: [{ plugins: { some: plugin }, rules: { 'some/rule': 'error' } }] })(),
  ).resolves.toBeInstanceOf(Array)
})

test('takes a SonarJS rule with only `antislop.sonarjs: false`, as `sonarjs: true` registers the plugin', async () => {
  await expect(
    build({
      antislop: { sonarjs: false },
      configs: [{ rules: { 'sonarjs/no-commented-code': 'off' } }],
    })(),
  ).resolves.toBeInstanceOf(Array)
})

test.each<[string, keyof typeof files, boolean]>([
  ['package-json/require-license', 'json', false],
  ['yml/no-empty-key', 'yaml', true],
  ['markdown/no-html', 'markdown', true],
  ['@html-eslint/require-img-alt', 'html', true],
])(
  'takes `%s` in a config of yours with `files.%s`, or turned off without `files`',
  async (rule, kind, isFilesHint) => {
    const options = { html: rule.startsWith('@html-eslint/') }
    const ruleFiles = isFilesHint ? [...files[kind]] : ['**/package.json']
    await expect(
      build({ ...options, configs: [{ files: ruleFiles, rules: { [rule]: 'error' } }] })(),
    ).resolves.toBeInstanceOf(Array)
    await expect(build({ ...options, configs: [{ rules: { [rule]: 'off' } }] })()).resolves.toEqual(
      expect.arrayContaining([
        { name: 'user/configs[0]', basePath: root, rules: { [rule]: 'off' } },
      ]),
    )
  },
)

test('takes `languageOptions.math` in a config of yours that matches no Markdown file', async () => {
  await expect(
    build({ configs: [{ files: ['**/*.ts'], languageOptions: { math: true } }] })(),
  ).resolves.toBeInstanceOf(Array)
})

test.each([
  ['antislop', { slop: false, sonarjs: false }, { 'sonarjs/no-commented-code': 'error' }],
  [
    'e18e',
    { modernization: false, moduleReplacements: false, performanceImprovements: false },
    { 'e18e/prefer-timer-args': 'error' },
  ],
] as const)(
  'takes `%s` sub-options that turn off every rule when `rules` turns one on',
  async (area, subOptions, rules) => {
    await expect(build({ [area]: { ...subOptions, rules } })()).resolves.toBeInstanceOf(Array)
  },
)

test('splits a config of yours with `files` by the files where each rule can run', async () => {
  const configs = await build({
    configs: [
      {
        name: 'user/src',
        files: ['src/**'],
        rules: { '@typescript-eslint/no-floating-promises': 'error', 'no-console': 'error' },
      },
    ],
  })()
  expect(configs.filter((config) => config.name === 'user/src')).toEqual([
    {
      basePath: root,
      name: 'user/src',
      files: ['src/**'],
      ignores: [NON_CODE_FILES],
      rules: { 'no-console': 'error' },
    },
    {
      basePath: root,
      name: 'user/src',
      files: [['src/**', CODE_FILES]],
      rules: { '@typescript-eslint/no-floating-promises': 'error' },
    },
  ])
})

test('limits a rule that needs type information to code files and `.astro` files with `astro`', async () => {
  const configs = await build({
    astro: true,
    configs: [
      {
        name: 'user/src',
        files: ['src/**'],
        rules: { '@typescript-eslint/no-floating-promises': 'error' },
      },
    ],
  })()
  expect(
    configs.filter((config) => config.name === 'user/src').map((config) => config.files),
  ).toEqual([
    [
      ['src/**', CODE_FILES],
      ['src/**', '**/*.astro'],
    ],
  ])
})

test.each([
  ['**/*.ts?(x)', '**/*.ts?(x)'],
  ['**/*.@(ts|json)', ['**/*.@(ts|json)', CODE_FILES]],
  ['**/*.[!a]son', ['**/*.[!a]son', CODE_FILES]],
])(
  'limits a typed rule for %s to code files only when it can match others',
  async (glob, expected) => {
    const configs = await build({
      configs: [{ files: [glob], rules: { '@typescript-eslint/no-floating-promises': 'error' } }],
    })()
    expect(configs.find((config) => config.name === 'user/configs[0]')?.files).toEqual([expected])
  },
)

test('lints JSON files with a rule that has no `meta.languages` in a config of yours for every file', async () => {
  await using project = await withTmpProject('eslint-config', {
    'eslint.config.mjs': 'export default []\n',
    'data.json': '{ "a": 1 }\n',
    'a.js': 'export function f() {\n  return 1\n}\n',
  })
  const configs = await defineConfig({
    root: project.dir,
    configs: [{ files: ['**/*'], rules: { 'max-lines-per-function': ['error', { max: 1 }] } }],
  })
  const results = await eslintWith(project.dir, configs).lintFiles(['data.json', 'a.js'])
  expect(
    results.map((result) => [
      path.basename(result.filePath),
      result.messages.map((message) => message.ruleId ?? message.message),
    ]),
  ).toEqual([
    ['data.json', []],
    ['a.js', ['max-lines-per-function']],
  ])
})

test('limits a JavaScript-only rule for `files.codeBlock` to the JavaScript and TypeScript code blocks', async () => {
  await using project = await withTmpProject('eslint-config', {
    'README.md': '# Title\n\n```json\n{ "a": null }\n```\n\n```ts\nexport const a = null\n```\n',
  })
  const configs = await defineConfig({
    root: project.dir,
    typeAware: false,
    isInEditor: false,
    configs: [{ files: [...files.codeBlock], rules: { 'unicorn/no-null': 'error' } }],
  })
  const [result] = await eslintWith(project.dir, configs).lintFiles(['README.md'])
  expect(
    result?.messages.map((message) => `${String(message.line)}:${message.ruleId ?? ''}`),
  ).toEqual(['8:unicorn/no-null'])
})

test('keeps the JavaScript rules of a config of yours out of the files another config of yours gives a language', async () => {
  await using project = await withTmpProject('eslint-config', {
    'src/a.ts': 'export const a = null\n',
    'src/map.geojson': '{ "a": null }\n',
    'app.code-workspace': '{\n  // folders\n  "folders": [null]\n}\n',
  })
  for (const scope of [{}, { files: ['src/**'] }]) {
    const configs = await defineConfig({
      root: project.dir,
      typeAware: false,
      isInEditor: false,
      configs: [
        { files: ['**/*.code-workspace', '**/*.geojson'], language: 'json/jsonc' },
        { ...scope, rules: { 'unicorn/no-null': 'error' } },
      ],
    })
    const results = await eslintWith(project.dir, configs).lintFiles([
      'src/a.ts',
      'src/map.geojson',
      'app.code-workspace',
    ])
    expect(
      Object.fromEntries(
        results.map((result) => [
          path.relative(project.dir, result.filePath),
          result.messages.map((message) => message.ruleId),
        ]),
      ),
    ).toEqual({
      'app.code-workspace': [],
      [path.join('src', 'a.ts')]: ['unicorn/no-null'],
      [path.join('src', 'map.geojson')]: [],
    })
  }
})

test.each([['src/*'], ['src/!(legacy)']])(
  'keeps the JavaScript rules of a config of yours with `files: [%j]` out of JSON files',
  async (glob) => {
    await using project = await withTmpProject('eslint-config', {
      'src/a.ts': 'export const a = null\n',
      'src/data.json': '{ "a": null }\n',
    })
    const configs = await defineConfig({
      root: project.dir,
      typeAware: false,
      isInEditor: false,
      configs: [{ files: [glob], rules: { 'unicorn/no-null': 'error' } }],
    })
    const results = await eslintWith(project.dir, configs).lintFiles(['src/a.ts', 'src/data.json'])
    expect(results.map((result) => result.messages.map((message) => message.ruleId))).toEqual([
      ['unicorn/no-null'],
      [],
    ])
  },
)

test.each([{}, { files: ['cfg/**'] }])(
  'keeps the JavaScript rules of a config of yours with %j out of a folder another config of yours gives a language',
  async (scope) => {
    await using project = await withTmpProject('eslint-config', {
      'cfg/a.ts': 'export const a = null\n',
      'cfg/app.code-workspace': '{\n  // folders\n  "folders": [null]\n}\n',
    })
    const configs = await defineConfig({
      root: project.dir,
      typeAware: false,
      isInEditor: false,
      configs: [
        { files: ['cfg/*.code-workspace'], language: 'json/jsonc', plugins: { json } },
        { ...scope, rules: { 'unicorn/no-null': 'error' } },
      ],
    })
    const results = await eslintWith(project.dir, configs).lintFiles([
      'cfg/a.ts',
      'cfg/app.code-workspace',
    ])
    expect(results.map((result) => result.messages.map((message) => message.ruleId))).toEqual([
      ['unicorn/no-null'],
      [],
    ])
  },
)

test.each(['cfg/**', 'cfg/**/*', 'cfg/*'])(
  'keeps the JavaScript rules of a config of yours without `files` outside `%s`, which another config of yours gives a language',
  async (glob) => {
    await using project = await withTmpProject('eslint-config', {
      'src/a.ts': 'export const a = null\n',
      'cfg/app.code-workspace': '{\n  // folders\n  "folders": [null]\n}\n',
    })
    const configs = await defineConfig({
      root: project.dir,
      typeAware: false,
      isInEditor: false,
      configs: [
        { files: [glob], language: 'json/jsonc', plugins: { json } },
        { rules: { 'unicorn/no-null': 'error' } },
      ],
    })
    const [result] = await eslintWith(project.dir, configs).lintFiles(['src/a.ts'])
    expect(result?.messages.map((message) => message.ruleId)).toEqual(['unicorn/no-null'])
  },
)

test('keeps JSONC with trailing commas for `tsconfig.json` under a config of yours with `json/json`', async () => {
  await using project = await withTmpProject('eslint-config', {
    'tsconfig.json': '{\n  // options\n  "compilerOptions": { "strict": true, },\n}\n',
    'data.json': '{ "a": 1, "a": 2 }\n',
  })
  const configs = await defineConfig({
    root: project.dir,
    typeAware: false,
    isInEditor: false,
    // @eslint/json's README example
    configs: [
      { files: ['**/*.json'], language: 'json/json', rules: { 'json/no-duplicate-keys': 'error' } },
    ],
  })
  const results = await eslintWith(project.dir, configs).lintFiles(['tsconfig.json', 'data.json'])
  expect(
    Object.fromEntries(
      results.map((result) => [
        path.relative(project.dir, result.filePath),
        result.messages.map((message) => message.ruleId),
      ]),
    ),
  ).toEqual({ 'data.json': ['json/no-duplicate-keys'], 'tsconfig.json': [] })
})

test('accepts a rule without `meta.languages` in a config with `language`, as ESLint runs it', async () => {
  const plugin = { rules: { any: { create: () => ({}) } } }
  const configs = await defineConfig({
    root,
    typeAware: false,
    configs: [
      {
        name: 'user/json',
        files: ['**/*.json'],
        language: 'json/json',
        plugins: { local: plugin },
        rules: { 'local/any': 'error' },
      },
    ],
  })
  expect(configs.find(({ name }) => name === 'user/json')?.rules).toEqual({ 'local/any': 'error' })
})

test.each<[Record<string, unknown>, Linter.Config]>([
  [{}, { files: ['src/**/*.{ts,tsx}'], rules: { 'unicorn/no-null': 'error' } }],
  [{}, { files: ['src/**/*.jsonc'], rules: { 'unicorn/expiring-todo-comments': 'error' } }],
  [
    { json: false, yaml: false, markdown: false, packageJson: false, pnpm: false },
    { files: ['src/**'], rules: { '@typescript-eslint/no-floating-promises': 'error' } },
  ],
])(
  'accepts a config of yours whose rules can run on what `files` matches: %j %j',
  async (options, config) => {
    await expect(build({ ...options, configs: [untyped(config)] })()).resolves.toBeInstanceOf(Array)
  },
)

test('takes an html-eslint rule in a config for code files, which lints HTML in template literals', async () => {
  const config: Linter.Config = {
    files: ['src/**/*.ts'],
    rules: { '@html-eslint/require-img-alt': 'error' },
  }
  const configs = await build({ typeAware: false, html: true, configs: [config] })()
  const messages = await eslintWith(root, configs).lintText(
    'const html = String.raw\nexport const image = html`<img src="a.png">`\n',
    { filePath: path.join(root, 'src/image.ts') },
  )
  expect(messages.flatMap((result) => result.messages.map((message) => message.ruleId))).toContain(
    '@html-eslint/require-img-alt',
  )
})

test('takes `.overrideRules()` that turns off or removes a rule no config turns on', async () => {
  // Off and `null` entries that match nothing change nothing either, as asked
  await expect(
    defineConfig({ root }).overrideRules({ 'no-plusplus': 'off', 'no-eval': null }),
  ).resolves.toBeInstanceOf(Array)
})

test('takes `.overrideRules()` of a formatting rule that `allowFormattingRules` lists', async () => {
  const configs = await defineConfig({
    root,
    allowFormattingRules: ['unicorn/empty-brace-spaces'],
  }).overrideRules({ 'unicorn/empty-brace-spaces': 'warn' })
  const config = (await eslintWith(root, configs).calculateConfigForFile('src/a.ts')) as
    Linter.Config | undefined
  expect(config?.rules?.['unicorn/empty-brace-spaces']).toEqual([1])
})

test('takes `undefined` from an `.onResolved()` callback for the configs unchanged', async () => {
  const configs = await defineConfig({ root })
  const unchanged = await defineConfig({ root }).onResolved(() => undefined)
  expect(configNames(unchanged)).toEqual(configNames(configs))
})

test.each([
  { constructor: true },
  JSON.parse('{"__proto__": true}') as object,
  { [Symbol('unknown')]: true },
  { tailwindcss: new Map() },
])('rejects unknown or non-plain options %j', (options) => {
  const input: unknown = { root, ...options }
  // @ts-expect-error - Values JavaScript callers can pass
  expect(() => defineConfig(input)).toThrow(TypeError)
})

test('removes formatting rules with `withoutFormattingRules`, from extended configs too, without changing the preset', async () => {
  const configs = await defineConfig({
    root,
    typeAware: false,
    configs: [
      withoutFormattingRules(reactPreset),
      withoutFormattingRules({ name: 'user/react', files: ['**/*.jsx'], extends: [reactPreset] }),
    ],
  })
  for (const name of ['react/recommended/rules', 'user/react > react/recommended/rules']) {
    const rules = configs.find((config) => config.name === name)?.rules
    expect(Object.keys(rules ?? {})).toEqual(['react/no-danger'])
  }
  expect(reactPreset[1]?.rules).toHaveProperty('react/jsx-indent')
})

test('accepts a string in `extends` naming a config of a plugin the config registers, imported as a module namespace too', async () => {
  const plugin = {
    configs: { base: { rules: { 'local/demo': 'error' as const } } },
    rules: { demo: { create: () => ({}) } },
  }
  const configs = await build({
    typeAware: false,
    regexp: false,
    configs: [
      { files: ['src/**/*.ts'], plugins: { local: plugin }, extends: ['local/base'] },
      {
        files: ['src/**/*.ts'],
        plugins: { regexp: eslintPluginRegexp },
        extends: ['regexp/recommended'],
      },
    ],
  })()
  expect(configs.some((config) => config.rules?.['local/demo'] === 'error')).toBe(true)
  expect(configs.some((config) => config.rules?.['regexp/no-empty-group'] === 'error')).toBe(true)
})

test('accepts a change that keeps the project service options, as a function override that spreads the config does', async () => {
  const configs = await build({})().override(LANGUAGE_OPTIONS, (config) => ({
    ...config,
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...(config.languageOptions?.['parserOptions'] as Linter.ParserOptions),
        ecmaVersion: 2024,
      },
    },
  }))
  expect(configs.length).toBeGreaterThan(0)
})
