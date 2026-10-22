import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Linter } from 'eslint'
import * as eslintPluginRegexp from 'eslint-plugin-regexp'

import { countWork, withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig, files, untyped, withoutFormattingRules, type TypedRules } from '@/index'
import { getLanguageSources } from '@/internal/preset-languages'

import { eslintWith } from './helpers'

const root = path.join(import.meta.dirname, 'fixtures', 'rules')

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

const ENTRY_POINT_EXPECTED =
  "expected an absolute path or one relative to `root`, or a `file:` URL or URL string with an absolute path, such as `import.meta.resolve('./src/styles/global.css')`"

/**
 * The message for a glob option of `name` that lists only negated globs
 */
function onlyNegated(name: string): string {
  return `@gpahal/eslint-config: \`${name}\`: lists only negated globs, so it would match no file. Add the globs of the files to match, as in \`['src/**', '!src/legacy/**']\``
}

test.each([
  [
    { typescript: { typeAwre: false } },
    '@gpahal/eslint-config: `typescript.typeAwre`: unknown option. Known options: `rules`, `rulesTypeAware`, `library`, `exhaustiveSwitch`, `strictBooleanExpressions`',
  ],
  [
    { root: 'packages/a' },
    '@gpahal/eslint-config: `root`: expected an absolute path, such as `import.meta.dirname`, received `"packages/a"`',
  ],
  [
    { ignores: 'dist' },
    '@gpahal/eslint-config: `ignores`: expected an array of globs or a function of the defaults, received `"dist"`',
  ],
  [
    { typescript: false },
    "@gpahal/eslint-config: `typescript`: expected an object, received `false`. TypeScript's rules can't be turned off; `typeAware: false` lints without type information",
  ],
  [
    { typescript: { exhaustiveSwitch: 'all' } },
    '@gpahal/eslint-config: `typescript.exhaustiveSwitch`: expected `"default"` or `"strict"`, received `"all"`',
  ],
  [
    { nextjs: true, react: false },
    '@gpahal/eslint-config: `nextjs`: needs the `react` preset, which `react: false` turns off. Remove `react: false`',
  ],
  [
    { nextjs: { rootDir: '../react' } },
    "@gpahal/eslint-config: `nextjs.rootDir`: path `../react` isn't a folder under `root`",
  ],
  // Checked before the folders are looked up
  [
    { nextjs: { rootDir: '/apps/web' } },
    '@gpahal/eslint-config: `nextjs.rootDir`: path `/apps/web` is absolute. Make it relative to `root`',
  ],
  [
    { nextjs: { rootDir: 'apps/*/' } },
    "@gpahal/eslint-config: `nextjs.rootDir`: path `apps/*/` is a glob, but this option lists folders, not globs. List each app, as in `['apps/web', 'apps/docs']`",
  ],
  [
    { testFiles: ['**/*.test.md'] },
    '@gpahal/eslint-config: `testFiles`: glob `**/*.test.md` matches no JavaScript or TypeScript file. End it in `*` or an extension of one, as in `**/*.test.ts`',
  ],
  [
    { astro: true, tailwindcss: { scope: ['apps/**/*.html'], entryPoint } },
    '@gpahal/eslint-config: `tailwindcss.scope`: glob `apps/**/*.html` matches no JavaScript, TypeScript or `.astro` file. End it in `*` or an extension of one, as in `apps/**/*.ts`',
  ],
  [
    { vitest: { files: [] } },
    '@gpahal/eslint-config: `vitest.files`: lists no globs, so it would match no file. Leave it out for the default',
  ],
  [{ testFiles: () => ['!**/fixtures/**'] }, onlyNegated('testFiles')],
  [{ server: { files: ['!src/client/**'] } }, onlyNegated('server.files')],
  [{ node: { scope: ['!apps/x/**'] } }, onlyNegated('node.scope')],
  [
    { commonjs: { files: ['src/**/*.ts'] } },
    '@gpahal/eslint-config: `commonjs.files`: glob `src/**/*.ts` matches no `.js` file. End it in `*` or an extension of one, as in `src/**/*.js`',
  ],
  [
    { typeAware: { ignores: ['/abs/**'] } },
    '@gpahal/eslint-config: `typeAware.ignores`: glob `/abs/**` starts with `/`, but globs are relative to `root`. Write `abs/**`',
  ],
  [
    { typeAware: { ignores: ['src/*.css'] } },
    '@gpahal/eslint-config: `typeAware.ignores`: glob `src/*.css` matches no JavaScript or TypeScript file',
  ],
  [
    { typeAware: { ignores: 'src/**' } },
    '@gpahal/eslint-config: `typeAware.ignores`: expected an array of globs or a function',
  ],
  [
    { browser: ['src/client/**'] },
    '@gpahal/eslint-config: `browser`: expected an object with `files`, or `false`, received an array',
  ],
  [
    { typeAware: { allowDefaultProject: () => ['**/*.config.ts'] } },
    '@gpahal/eslint-config: `typeAware.allowDefaultProject`: glob `**/*.config.ts` has `**`, which typescript-eslint rejects, since it would let the default project take too many files. List the files, as in `*.config.ts`',
  ],
  [
    { typeAware: false, typescript: { rulesTypeAware: { 'no-console': 'off' } } },
    '@gpahal/eslint-config: `typescript.rulesTypeAware`: is for the files linted with type information, and `typeAware: false` lints without it. Remove one of them',
  ],
  [
    { antislop: { sonarjs: false, cognitiveComplexity: 10 } },
    '@gpahal/eslint-config: `antislop.cognitiveComplexity`: is for the eslint-plugin-sonarjs rules, and `antislop.sonarjs: false` turns them off. Remove one of them',
  ],
  [
    { tailwindcss: {} },
    `@gpahal/eslint-config: \`tailwindcss.entryPoint\`: ${ENTRY_POINT_EXPECTED}, received \`undefined\`. Set it, as in \`{ entryPoint: 'src/styles.css' }\``,
  ],
  [
    { tailwindcss: { settings: { entryPoint } } },
    '@gpahal/eslint-config: `tailwindcss.settings.entryPoint`: is set from `tailwindcss.entryPoint`, so `tailwindcss.settings` may not hold it. Set `tailwindcss.entryPoint` instead',
  ],
  [
    { markdown: { rules: { 'unicorn/no-null': 'off' } } },
    "@gpahal/eslint-config: `markdown.rules`: `unicorn/no-null`: isn't a rule of the `markdown` area, which takes `markdown/`, `@gpahal/markdown/` and `markdown-preferences/`. Put it in `unicorn.rules`",
  ],
  [
    { allowFormattingRules: ['no-console'] },
    "@gpahal/eslint-config: `allowFormattingRules`: `no-console`: eslint-config-prettier doesn't turn this rule off",
  ],
  [
    { allowFormattingRules: ['no-unexpected-multiline'] },
    '@gpahal/eslint-config: `allowFormattingRules`: `no-unexpected-multiline`: stays on already; this package keeps it on',
  ],
])('throws on %j', (options, message) => {
  expect(build(options)).toThrow(message)
})

test.each([undefined, null, 'tsconfig.json', ['react']])(
  'throws on %j as the options',
  (options) => {
    // @ts-expect-error -- A value the type rejects, to check what `defineConfig` does at runtime
    expect(() => defineConfig(options)).toThrow(
      /^@gpahal\/eslint-config: options: expected an object of options, received (?:`undefined`|`null`|`"tsconfig\.json"`|an array)$/,
    )
  },
)

test.each([
  [{ antislop: { cognitiveComplexity: false } }],
  [{ nextjs: true }],
  [{ tailwindcss: { entryPoint: pathToFileURL(path.resolve(root, entryPoint)) } }],
  [{ tailwindcss: { entryPoint: pathToFileURL(path.resolve(root, entryPoint)).href } }],
  [{ vitest: { files: ['tests/**', '!**/*.snap'] } }],
  [{ testFiles: ['tests/????'] }],
  [{ astro: true, html: true, tailwindcss: { scope: ['apps/**/*.astro'], entryPoint } }],
  [{ isInEditor: undefined, markdown: undefined }],
])('accepts %j', async (options) => {
  // Awaited, so an option that fails while the configs are built fails the test
  await expect(build(options)()).resolves.toBeInstanceOf(Array)
})

/**
 * A rule of each area, for its `rules`
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

test.each(GLOB_OPTIONS)('throws on a malformed glob of `%s`', (name, optionsOf) => {
  for (const [globs, glob, problem] of [
    [[''], '', 'is empty'],
    [['!'], '!', 'is a `!` with no glob'],
    [
      ['src/**', '!/lib/**'],
      '!/lib/**',
      'starts with `/`, but globs are relative to `root`. Write `!lib/**`',
    ],
    [
      ['./../x/*.ts'],
      './../x/*.ts',
      'starts with `..`, but globs are relative to `root` and match only files under it',
    ],
    [
      [String.raw`src\**\*.ts`],
      String.raw`src\**\*.ts`,
      'has a `\\` separator. Use `/` separators; a `\\` escapes a glob character, as in `\\*`',
    ],
  ] as const) {
    expect(build(optionsOf([...globs]))).toThrow(
      `@gpahal/eslint-config: \`${name}\`: glob \`${glob}\` ${problem}`,
    )
  }
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
})

test('throws on a malformed glob in the `files` or `ignores` of a config of yours', async () => {
  const glob = '../src/**'
  const message = (subjects: string, key: string) =>
    `@gpahal/eslint-config: ${subjects}: \`${key}\`: glob \`${glob}\` starts with \`..\``
  expect(
    build({ configs: [[{ files: [['src/**', glob]], rules: { 'no-console': 'off' } }]] }),
  ).toThrow(message('`configs[0][0]`', 'files'))
  expect(build({ configs: [{ ignores: [glob], rules: { 'no-console': 'off' } }] })).toThrow(
    message('`configs[0]`', 'ignores'),
  )
  await expect(
    build({})().append({ files: [glob], rules: { 'no-console': 'off' } }),
  ).rejects.toThrow(message('`.append()`: item `[0]`', 'files'))
  await expect(
    build({})().override('gpahal/javascript/rules', { ignores: [glob] }),
  ).rejects.toThrow(message("`.override('gpahal/javascript/rules')`", 'ignores'))
  await expect(
    build({})().onResolved((configs) => [
      ...configs,
      { files: [glob], rules: { 'no-console': 'off' } },
    ]),
  ).rejects.toThrow(message('`.onResolved()`', 'files'))
})

test.each(GLOB_OPTIONS.slice(0, 3))(
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

test.each([
  [
    { gitignore: { files: ['/abs'] } },
    '@gpahal/eslint-config: `gitignore.files`: path `/abs` is absolute. Make it relative to `root`',
  ],
  [
    { gitignore: { files: ['a/../../x'] } },
    '@gpahal/eslint-config: `gitignore.files`: path `a/../../x` has a `..` segment, but the files are under `root`, relative to it',
  ],
  [
    { typeAware: { allowDefaultProject: ['*.config.ts', './*'] } },
    '@gpahal/eslint-config: `typeAware.allowDefaultProject[1]`: glob `./*` matches every file in the root, which typescript-eslint rejects. List the files',
  ],
  [
    { typeAware: { allowDefaultProject: ['!x.ts'] } },
    '@gpahal/eslint-config: `typeAware.allowDefaultProject`: glob `!x.ts` starts with `!`, but typescript-eslint takes only the globs of files to add. Leave the file out of the list',
  ],
])('throws on a path or glob outside root: %j', (options, message) => {
  expect(build(options)).toThrow(message)
})

test('checks the brace alternatives of a glob', () => {
  expect(build({ testFiles: ['src/{styles.css,{client,server}/{a.css,b.ts}}'] })).not.toThrow()
  expect(build({ testFiles: ['src/{a.css,{b,c}/d.css}'] })).toThrow(
    '@gpahal/eslint-config: `testFiles`: glob `src/{a.css,{b,c}/d.css}` matches no JavaScript or TypeScript file',
  )
  expect(build({ node: { scope: ['src/{1..5000}.ts'] } })).toThrow(
    '@gpahal/eslint-config: `node.scope`: glob `src/{1..5000}.ts` expands to more than 1000 globs. List fewer alternatives',
  )
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

test('rejects a rule that no plugin has, turned off too', async () => {
  await expect(build({ unicorn: { rules: { 'unicorn/no-nul': 'off' } } })()).rejects.toThrow(
    "@gpahal/eslint-config: `unicorn.rules`: `unicorn/no-nul`: isn't a rule that the `unicorn` plugin this config loads has",
  )
  await expect(
    build({ configs: [{}, untyped({ name: 'user/x', rules: { 'no-consol': 'off' } })] })(),
  ).rejects.toThrow(
    "@gpahal/eslint-config: `configs[1]` (`user/x`): `no-consol`: isn't a rule that ESLint has",
  )
  await expect(
    build({ configs: [[{}, { files: ['**/*.ts'], rules: { 'some/rule': 'off' } }]] })(),
  ).rejects.toThrow(
    '@gpahal/eslint-config: `configs[0][1]`: `some/rule`: no config registers its plugin `some`',
  )
  const plugin = { rules: { rule: { create: () => ({}) } } }
  await expect(
    build({ configs: [{ plugins: { some: plugin }, rules: { 'some/rule': 'error' } }] })(),
  ).resolves.toBeInstanceOf(Array)
})

test('names the option that turns off the plugin of a rule', async () => {
  await expect(
    build({ antislop: { slop: false }, configs: [{ rules: { 'slop/no-em-dash': 'off' } }] })(),
  ).rejects.toThrow(
    '@gpahal/eslint-config: `configs[0]`: `slop/no-em-dash`: no config registers its plugin `slop`, which `antislop.slop: false` turns off',
  )
  await expect(
    build({
      antislop: { sonarjs: false, rules: { 'sonarjs/no-commented-code': 'off' } },
      sonarjs: false,
    })(),
  ).rejects.toThrow(
    '@gpahal/eslint-config: `antislop.rules`: `sonarjs/no-commented-code`: no config registers its plugin `sonarjs`, which `sonarjs: false` and `antislop.sonarjs: false` turn off',
  )
  // `sonarjs: true` still registers the plugin
  await expect(
    build({
      antislop: { sonarjs: false },
      configs: [{ rules: { 'sonarjs/no-commented-code': 'off' } }],
    })(),
  ).resolves.toBeInstanceOf(Array)
  await expect(
    build({
      unicorn: false,
      configs: [{ files: ['**/*.ts'], rules: { 'unicorn/no-null': 'error' } }],
    })(),
  ).rejects.toThrow(
    'no config registers its plugin `unicorn`. Turn on the `unicorn` option, which registers it',
  )
})

test.each<[string, keyof typeof files, string, string]>([
  ['package-json/require-license', 'json', 'JSON', "`files: ['**/package.json']`"],
  ['yml/no-empty-key', 'yaml', 'YAML', ''],
  ['markdown/no-html', 'markdown', 'Markdown', ''],
  ['@html-eslint/require-img-alt', 'html', 'HTML', ''],
])(
  'throws on `%s` turned on in a config of yours without `files`, and takes it with `files.%s` or turned off',
  async (rule, kind, language, filesHint) => {
    const hint =
      filesHint === ''
        ? `\`files: [...files.${kind}]\`, with \`files\` from this package`
        : filesHint
    const description = `is a rule for ${language} files, which a config of yours without \`files\` or \`language\` doesn't reach.${kind === 'html' ? ' The `html` preset lints `.html` files only, not HTML in template literals, so set `files` to target them.' : ''} Give it ${hint}`
    expect(build({ configs: [{ name: 'user/x', rules: { [rule]: 'error' } }] })).toThrow(
      `@gpahal/eslint-config: \`configs[0]\` (\`user/x\`): \`${rule}\`: ${description}`,
    )
    // Turned off beside a code rule, it goes to a part for every file, unless the config's
    // `languageOptions` keep it with the code rules
    expect(
      build({
        configs: [
          { languageOptions: { globals: {} }, rules: { [rule]: 'off', 'no-console': 'error' } },
        ],
      }),
    ).toThrow(`@gpahal/eslint-config: \`configs[0]\`: \`${rule}\`: ${description}`)
    const options = { html: rule.startsWith('@html-eslint/') }
    const ruleFiles = filesHint === '' ? [...files[kind]] : ['**/package.json']
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

test.each([
  [
    [{}, undefined],
    '`configs[1]`: expected a config object or an array of them, received `undefined`',
  ],
  [
    [[{}, ['foo']]],
    '`configs[0][1][0]`: expected a config object or an array of them, received `"foo"`',
  ],
])('throws on an item of `configs` that is no config: %j', (configs, message) => {
  expect(build({ configs })).toThrow(`@gpahal/eslint-config: ${message}`)
})

test('throws on `languageOptions.math` in a config of yours that can match Markdown files', async () => {
  const languageOptions = { math: true }
  expect(build({ configs: [{ files: ['docs/*.{md,ts}'], languageOptions }] })).toThrow(
    "@gpahal/eslint-config: `configs[0]`: `languageOptions.math`: can apply to Markdown files, whose parse this package's Markdown processor shares with the language. Set the `markdown.math` option instead",
  )
  await expect(
    build({ configs: [{ files: ['**/*.ts'], languageOptions }] })(),
  ).resolves.toBeInstanceOf(Array)
})

test.each([
  [{ basePath: 1 }, '`basePath`', 'a string', '`1`'],
  [{ files: '**/*.md' }, '`files`', 'an array', '`"**/*.md"`'],
  [{ settings: [] }, '`settings`', 'an object', 'an array'],
])('rejects a config of yours of the wrong shape: %j', async (config, key, expected, received) => {
  const message = `@gpahal/eslint-config: \`configs[0]\`: ${key}: expected ${expected}, received ${received}`
  expect(build({ configs: [config] })).toThrow(message)
  await expect(untypedComposer()['override']!('gpahal/javascript/rules', config)).rejects.toThrow(
    message.replace('`configs[0]`', "`.override('gpahal/javascript/rules')`"),
  )
})

test.each([
  ['antislop', { slop: false, sonarjs: false }, { 'sonarjs/no-commented-code': 'error' }],
  [
    'e18e',
    { modernization: false, moduleReplacements: false, performanceImprovements: false },
    { 'e18e/prefer-timer-args': 'error' },
  ],
] as const)(
  'throws on `%s` sub-options that turn off every rule, unless `rules` turns one on',
  async (area, subOptions, rules) => {
    const message = `@gpahal/eslint-config: \`${area}\`: turns off every rule of the area. Use \`${area}: false\``
    expect(build({ [area]: subOptions })).toThrow(message)
    expect(
      build({ [area]: { ...subOptions, rules: { [Object.keys(rules)[0] ?? '']: 'off' } } }),
    ).toThrow(message)
    await expect(build({ [area]: { ...subOptions, rules } })()).resolves.toBeInstanceOf(Array)
  },
)

/**
 * The glob of the JSON, YAML, TOML, Markdown and HTML files, which the JavaScript rules of a
 * config of yours skip
 */
const NON_CODE_FILES = '**/*.{json,jsonc,json5,yml,yaml,toml,md,markdown,html}'

const CODE_FILES = '**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'

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

test("rejects a change to the code blocks config that turns on a rule JSON and YAML code blocks can't run", async () => {
  await expect(
    defineConfig({ root }).override('gpahal/markdown/code-blocks', {
      rules: { 'unicorn/no-null': 'error' },
    }),
  ).rejects.toThrow(
    "@gpahal/eslint-config: `.override('gpahal/markdown/code-blocks')`: `files`: can match JSON, YAML",
  )
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

test("rejects a config of yours whose `files` can match only files where a rule can't run", async () => {
  // `\{a,b}.json` is the name `{a,b}.json`, not `a.json` or `b.json`
  const config = untyped({
    files: [['**/a.json', String.raw`!**/\{a,b}.json`]],
    rules: { 'unicorn/no-null': 'error' },
  })
  const message = `@gpahal/eslint-config: \`configs[0]\`: \`files\`: can match JSON files, where \`unicorn/no-null\` can't run. Limit it to code, as in \`files: [['src/**', '${CODE_FILES}']]\``
  await expect(build({ configs: [config] })()).rejects.toThrow(message)
  await expect(build({})().append(config)).rejects.toThrow(
    message.replace('`configs[0]`', '`.append()`: item `[0]`'),
  )
})

test.each<[Linter.Config, string]>([
  [
    { files: ['src/**'], rules: { 'json/no-duplicate-keys': 'error' } },
    'Limit it to JSON files, as in `files: [...files.json]`, with `files` from this package',
  ],
  [
    { files: ['**/*.tsx'], rules: { 'markdown/no-bare-urls': 'error' } },
    'Limit it to Markdown files',
  ],
])(
  'rejects a rule for other files than code with a hint of its files: %j',
  async (config, hint) => {
    await expect(build({ configs: [untyped(config)] })()).rejects.toThrow(
      new RegExp(String.raw`can't run\. ${RegExp.escape(hint)}`),
    )
  },
)

test("rejects a change without `files` that turns on a rule some files can't run", async () => {
  await expect(
    defineConfig({ root }).override('gpahal/setup', (config) => ({
      ...config,
      rules: { 'unicorn/no-null': 'error' },
    })),
  ).rejects.toThrow(
    `@gpahal/eslint-config: \`.override('gpahal/setup')\`: has no \`files\`, so it applies to JSON, YAML, TOML and Markdown files, where \`unicorn/no-null\` can't run. Give it \`files\` limited to code, as in \`files: [['src/**', '${CODE_FILES}']]\``,
  )
})

test("rejects a change to a config with `language` that turns on a rule its language can't run", async () => {
  const name = 'gpahal/json/json'
  await expect(
    defineConfig({ root, typeAware: false }).override(name, {
      rules: { 'unicorn/no-null': 'error' },
    }),
  ).rejects.toThrow(
    `@gpahal/eslint-config: \`.override('${name}')\`: \`unicorn/no-null\`: can't run in the config's language`,
  )
  await expect(
    defineConfig({ root, typeAware: false }).onResolved((configs) => {
      const config = configs.find((found) => found.name === name)
      if (config !== undefined) {
        config.rules = { ...config.rules, 'unicorn/no-null': 'error' }
      }
    }),
  ).rejects.toThrow("`unicorn/no-null`: can't run in the config's language")
  // The YAML preset's config has no `language`, so `files` decides
  await expect(
    defineConfig({ root, typeAware: false }).override('gpahal/yaml/rules', {
      rules: { 'unicorn/no-null': 'error' },
    }),
  ).rejects.toThrow(
    "@gpahal/eslint-config: `.override('gpahal/yaml/rules')`: `files`: can match YAML files, where `unicorn/no-null` can't run",
  )
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

test('rejects a rule whose `meta.languages` leaves out `js/js` in a config for code files', async () => {
  const plugin = {
    rules: { json: { meta: { languages: ['json/json'] }, create: () => ({}) } },
  }
  await expect(
    build({
      configs: [
        { files: ['**/*.ts'], plugins: { local: plugin }, rules: { 'local/json': 'error' } },
      ],
    })(),
  ).rejects.toThrow(
    "@gpahal/eslint-config: `configs[0]`: `files`: can match code files, where `local/json` can't run. Limit it to files in a language the rule supports, and set `language`",
  )
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

type Composer = ReturnType<typeof defineConfig>

/**
 * A config whose rule no plugin has, which the types would reject
 */
const misspelled = untyped({ rules: { 'no-consol': 'off' } })

test.each<[string, (composer: Composer) => Composer, string]>([
  [
    '`.removeRules()`',
    (composer) => composer.removeRules('unicorn/no-nul' as keyof TypedRules),
    "`unicorn/no-nul`: isn't a rule that the `unicorn` plugin this config loads has",
  ],
  [
    "`.override('gpahal/javascript/rules')`",
    (composer) =>
      composer.override('gpahal/javascript/rules', (config) => ({
        ...config,
        rules: { ...config.rules, ...misspelled.rules },
      })),
    "`no-consol`: isn't a rule that ESLint has",
  ],
])('rejects a rule that no plugin has in %s', async (subject, change, message) => {
  await expect(change(defineConfig({ root }))).rejects.toThrow(
    `@gpahal/eslint-config: ${subject}: ${message}`,
  )
})

/**
 * The composer's methods as JavaScript callers can call them, with arguments the types reject
 */
type UntypedComposer = Record<string, (...args: Array<unknown>) => Composer>

function untypedComposer(): UntypedComposer {
  const composer: unknown = defineConfig({ root })

  return composer as UntypedComposer
}

test.each<[string, (composer: UntypedComposer) => Composer, string]>([
  [
    'an `.override()` function that returns `undefined`',
    (composer) => composer['override']!('gpahal/javascript/rules', () => undefined),
    "`.override('gpahal/javascript/rules')`: expected the function to return a config object, received `undefined`",
  ],
  [
    'an `.onResolved()` callback that returns `null` in its array',
    (composer) => composer['onResolved']!(() => [{}, null]),
    '`.onResolved()`: returned item `[1]`: expected a config object, received `null`',
  ],
])('rejects %s', async (_, change, message) => {
  await expect(change(untypedComposer())).rejects.toThrow(`@gpahal/eslint-config: ${message}`)
})

test.each<[(composer: UntypedComposer) => unknown, string]>([
  [
    (composer) => composer['overrideRules']!(['no-console']),
    '`.overrideRules()`: expected an object of rule entries, received an array',
  ],
  [
    (composer) => composer['override']!(undefined, {}),
    '`.override()`: expected a config name, received `undefined`',
  ],
  [
    (composer) => composer['overrideRules']!({ 'no-console': 'warning' }),
    '`.overrideRules()`: `no-console`: expected a severity',
  ],
  [
    (composer) => composer['overrideRules']!({ 'no-console': ['warning'] }),
    '`.overrideRules()`: `no-console`: expected a severity',
  ],
])('throws on a wrong argument when called: %s', (call, message) => {
  expect(() => call(untypedComposer())).toThrow(`@gpahal/eslint-config: ${message}`)
})

test('rejects `.overrideRules()` that changes nothing', async () => {
  await expect(defineConfig({ root }).overrideRules({ curly: 'error' })).rejects.toThrow(
    '@gpahal/eslint-config: `.overrideRules()`: `curly`: is a formatting rule, which the configs leave out unless `allowFormattingRules` lists it, so this changes nothing. List it in `allowFormattingRules`, and turn it on with `configs` or `.append()` if no preset does',
  )
  await expect(defineConfig({ root }).overrideRules({ 'no-plusplus': 'error' })).rejects.toThrow(
    '@gpahal/eslint-config: `.overrideRules()`: `no-plusplus`: turns on a rule that no config turns on, so it changes nothing. Turn it on with `configs` or `.append()`',
  )
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

test('throws on an AND entry of brace patterns with more than 1000 combinations', async () => {
  const values = ['dev', 'test', 'stage', 'prod', 'local', 'qa', 'uat', 'demo', 'perf', 'canary']
  const patterns = ['env', 'region', 'component', 'version', 'name'].map(
    (key) => `**/*{${values.map((value) => `${key}-${value}`).join(',')}}*.json`,
  )
  await expect(
    defineConfig({
      root,
      typeAware: false,
      configs: [{ files: [patterns], language: 'json/json' }],
    }),
  ).rejects.toThrow(
    /^@gpahal\/eslint-config: config `[^`]+`: `files\[0\]`: the brace alternatives of the globs that a file must all match make more than 1000 combinations\. Split the entry into entries with fewer alternatives each$/,
  )
  // Thrown before making the combinations, so five globs cost about what four do, not 10 times
  const workOf = (count: number) =>
    countWork(() => {
      expect(() =>
        getLanguageSources([{ files: [patterns.slice(0, count)], language: 'json/json' }]),
      ).toThrow(TypeError)
    })
  expect(workOf(5)).toBeLessThan(2 * workOf(4))
})

describe('a plugin preset with formatting rules', () => {
  const FORMATTING_RULES = ['vue/html-indent', 'vue/html-quotes', 'vue/max-attributes-per-line']

  // A preset in the shape of eslint-plugin-vue's: a config that registers the plugin, then configs
  // of rules without `plugins`
  const vuePreset = [
    {
      name: 'vue/base/setup',
      plugins: {
        vue: {
          rules: Object.fromEntries(
            [...FORMATTING_RULES, 'vue/no-unused-vars'].map((rule) => [
              rule.slice('vue/'.length),
              { create: () => ({}) },
            ]),
          ),
        },
      },
    },
    {
      name: 'vue/recommended/rules',
      files: ['**/*.vue'],
      rules: Object.fromEntries(
        [...FORMATTING_RULES, 'vue/no-unused-vars'].map((rule) => [rule, 'warn']),
      ),
    },
  ]

  it('lists every formatting rule in one error', () => {
    expect(build({ configs: vuePreset })).toThrow(
      [
        '@gpahal/eslint-config: `configs[1]` (`vue/recommended/rules`): 3 issues',
        ...FORMATTING_RULES.map(
          (rule) =>
            `  \`${rule}\`: is a rule that eslint-config-prettier turns off, since it conflicts with Prettier or is only safe with some options`,
        ),
        "To use a plugin's preset that turns on such rules, wrap it in `withoutFormattingRules`. Turn them off, or list them in `allowFormattingRules`",
      ].join('\n'),
    )
  })

  it('removes them with `withoutFormattingRules`, from extended configs too, without changing the preset', async () => {
    const configs = await defineConfig({
      root,
      typeAware: false,
      configs: [
        withoutFormattingRules(vuePreset),
        withoutFormattingRules({ name: 'user/vue', files: ['**/*.vue'], extends: [vuePreset] }),
      ],
    })
    for (const name of ['vue/recommended/rules', 'user/vue > vue/recommended/rules']) {
      const rules = configs.find((config) => config.name === name)?.rules
      expect(Object.keys(rules ?? {})).toEqual(['vue/no-unused-vars'])
    }
    expect(vuePreset[1]?.rules).toHaveProperty('vue/html-indent')
  })
})

describe('a string in `extends`', () => {
  const plugin = {
    configs: { base: { rules: { 'local/demo': 'error' as const } } },
    rules: { demo: { create: () => ({}) } },
  }

  it.each<[Record<string, unknown>, string]>([
    [
      { extends: ['js/recommended'] },
      '@gpahal/eslint-config: `configs[0]`: `extends[0]`: expected `<plugin>/<config>` naming a plugin this config registers, received `"js/recommended"`',
    ],
    [
      { plugins: { local: plugin }, extends: ['local/missing'] },
      '@gpahal/eslint-config: `configs[0]`: `extends[0]`: plugin `local` has no config `missing`',
    ],
    [
      { extends: [{ extends: [{ rules: {} }] }] },
      "@gpahal/eslint-config: `configs[0]`: ESLint's `defineConfig` rejects it: Nested 'extends' is not allowed",
    ],
  ])('throws on %j', (config, message) => {
    expect(build({ configs: [config] })).toThrow(message)
  })

  it('accepts a config of a plugin the config registers, imported as a module namespace too', async () => {
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
})

describe('the project service options', () => {
  const PROJECT_SERVICE_HINT =
    'is set from `root` and `typeAware`, so a config of yours may not change it. List the files to lint with the default project in `typeAware.allowDefaultProject`, or those to lint without type information in `typeAware.ignores`'
  const name = 'gpahal/javascript/language-options'

  it('throws on a config of yours or a change that sets them', async () => {
    expect(
      build({
        configs: [
          untyped({
            files: ['**/*.ts'],
            languageOptions: { parserOptions: { projectService: false } },
          }),
        ],
      }),
    ).toThrow(
      `@gpahal/eslint-config: \`configs[0]\`: \`languageOptions.parserOptions.projectService\`: ${PROJECT_SERVICE_HINT}`,
    )
    expect(
      build({
        configs: [untyped({ languageOptions: { parserOptions: { tsconfigRootDir: root } } })],
      }),
    ).toThrow(
      '@gpahal/eslint-config: `configs[0]`: `languageOptions.parserOptions.tsconfigRootDir`: is set from `root`, so a config of yours may not change it. Set `root` to the folder of your `tsconfig.json`',
    )
    await expect(
      build({})().override(name, {
        languageOptions: { parserOptions: { projectService: { allowDefaultProject: ['x.ts'] } } },
      }),
    ).rejects.toThrow(
      `@gpahal/eslint-config: \`.override('${name}')\`: \`languageOptions.parserOptions.projectService\`: ${PROJECT_SERVICE_HINT}`,
    )
    await expect(
      build({})().onResolved((configs) => {
        const config = configs.find((found) => found.name === name)
        Reflect.deleteProperty(config?.languageOptions?.['parserOptions'] ?? {}, 'tsconfigRootDir')
      }),
    ).rejects.toThrow('`languageOptions.parserOptions.tsconfigRootDir`:')
  })

  it('accepts a change that keeps them, as a function override that spreads the config does', async () => {
    const configs = await build({})().override(name, (config) => ({
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
})
