import syncFs from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Linter } from 'eslint'

import type { ListTransform } from '@gpahal/internal/node/options'
import { runNodeOk } from '@gpahal/internal/node/testing'

import { defineConfig, files, type EslintConfigOptions } from '@/index'
import { getEnabledAreas } from '@/internal/areas'
import { findDefaultProjectFiles } from '@/internal/default-project'
import { scanProject } from '@/internal/project-scan'
import { resolveOptions } from '@/internal/resolve'
import { bindWarnings, warnOfSetup, withWarnings } from '@/internal/utils'

import {
  BUILD_DIR,
  captureWarnings,
  collator,
  CORE_AREAS_OFF,
  createESLint,
  eslintWith,
  FIXTURES_DIR,
  lintText,
  ruleSeverity,
  warningsOf,
  withProject,
} from './helpers'

/**
 * The minimatch that ESLint matches globs with
 */
const { minimatch } = createRequire(createRequire(import.meta.url).resolve('eslint'))(
  'minimatch',
) as { minimatch: (path: string, pattern: string, options: { dot: boolean }) => boolean }

const NON_NULL_RULE = '@typescript-eslint/no-non-null-assertion'
const VITEST_RULE = 'vitest/no-focused-tests'
const FLOATING_RULE = '@typescript-eslint/no-floating-promises'

describe('pnpm', () => {
  it.each([true, { rules: {} }])(
    'rejects explicit pnpm %j without a workspace file',
    async (pnpm) => {
      await using project = await withProject({ 'package.json': '{}' })
      expect(() => defineConfig({ root: project.dir, pnpm, typeAware: false })).toThrow(
        '@gpahal/eslint-config: `pnpm`: no `pnpm-workspace.yaml` at or above `root`. Remove the `pnpm` option',
      )
      await fs.writeFile(path.join(project.dir, 'pnpm-workspace.yaml'), 'packages: []\n')
      await expect(
        Promise.resolve(defineConfig({ root: project.dir, pnpm, typeAware: false })),
      ).resolves.toBeDefined()
    },
  )

  const GIT = { '.git/HEAD': 'ref: refs/heads/main\n' }

  it.each<[string, Record<string, string>, string, boolean]>([
    ['the workspace root', { ...GIT, 'pnpm-workspace.yaml': 'packages: []\n' }, '.', true],
    [
      'a workspace package',
      { ...GIT, 'pnpm-workspace.yaml': "packages: ['./apps/*/']\n" },
      'apps/web',
      true,
    ],
    [
      'a package the workspace excludes',
      { ...GIT, 'pnpm-workspace.yaml': "packages: ['apps/*', '!apps/old']\n" },
      'apps/old',
      false,
    ],
    [
      'a package the workspace excludes with `!./`',
      { ...GIT, 'pnpm-workspace.yaml': "packages: ['apps/*', '!./apps/old']\n" },
      'apps/old',
      false,
    ],
    [
      'a git repository under a folder with a stray workspace file',
      { 'pnpm-workspace.yaml': "packages: ['**']\n", 'repo/.git/HEAD': 'ref: refs/heads/main\n' },
      'repo',
      false,
    ],
  ])('is detected for %s: %s', async (_, files, dir, isOn) => {
    await using project = await withProject({ ...files, [`${dir}/package.json`]: '{}' })
    expect(getEnabledAreas({ root: path.join(project.dir, dir) }).pnpm).toBe(isOn)
  })
})

describe('testFiles', () => {
  it('adds to the default test files with a function', async () => {
    const eslint = await createESLint('typescript', {
      testFiles: (defaults) => [...defaults, 'e2e/**/*.ts'],
    })
    expect(await ruleSeverity(eslint, 'tests/a.test.ts', NON_NULL_RULE)).toBe(0)
    expect(await ruleSeverity(eslint, 'e2e/a.ts', NON_NULL_RULE)).toBe(0)
    expect(await ruleSeverity(eslint, 'src/a.ts', NON_NULL_RULE)).toBe(2)
  })

  it('replaces the default test files with an array', async () => {
    const eslint = await createESLint('typescript', { testFiles: ['e2e/**/*.ts'] })
    expect(await ruleSeverity(eslint, 'tests/a.test.ts', NON_NULL_RULE)).toBe(2)
    expect(await ruleSeverity(eslint, 'e2e/a.ts', NON_NULL_RULE)).toBe(0)
  })
})

describe('vitest', () => {
  it('treats type tests as test files, with Vitest globals', async () => {
    const eslint = await createESLint('typescript', { vitest: true })
    expect(await ruleSeverity(eslint, 'src/a.test-d.ts', NON_NULL_RULE)).toBe(0)
    expect(await ruleSeverity(eslint, 'src/a.test-d.ts', VITEST_RULE)).toBe(2)
    const config = (await eslint.calculateConfigForFile('src/a.test-d.ts')) as Linter.Config
    expect(config.languageOptions?.['globals']).toHaveProperty('expectTypeOf')
  })

  it('gives all test exemptions to the independent union of testFiles and vitest.files', async () => {
    const transform = vi.fn(() => ['e2e/**/*.ts', 'tests/fixtures/**', '!tests/**/a.test.ts'])
    const eslint = await createESLint('typescript', {
      testFiles: (defaults) => [...defaults, '!tests/fixtures/**'],
      vitest: { files: transform },
      typescript: { library: true },
      antislop: { slop: false },
    })
    const libraryRule = '@typescript-eslint/explicit-module-boundary-types'
    for (const file of ['e2e/a.ts', 'tests/a.test.ts', 'tests/fixtures/b.ts']) {
      expect(await ruleSeverity(eslint, file, NON_NULL_RULE), file).toBe(0)
      expect(await ruleSeverity(eslint, file, libraryRule), file).toBeUndefined()
      const config = (await eslint.calculateConfigForFile(file)) as Linter.Config
      expect(config.rules?.['import-x/no-extraneous-dependencies']).toEqual([
        2,
        { devDependencies: true, peerDependencies: true, optionalDependencies: true },
      ])
    }
    expect(await ruleSeverity(eslint, 'tests/fixtures/a.test.ts', NON_NULL_RULE)).toBe(2)
    expect(await ruleSeverity(eslint, 'tests/fixtures/a.test.ts', libraryRule)).toBe(2)
    expect(transform).toHaveBeenCalledTimes(1)
  })

  it('replaces the Vitest files with an array or what a function of the resolved testFiles returns', async () => {
    const byArray = await createESLint('typescript', { vitest: { files: ['tests/unit/**/*.ts'] } })
    expect(await ruleSeverity(byArray, 'tests/unit/a.test.ts', VITEST_RULE)).toBe(2)
    expect(await ruleSeverity(byArray, 'tests/e2e/a.test.ts', VITEST_RULE)).toBeUndefined()
    // Still test files, with the test files' looser rules
    expect(await ruleSeverity(byArray, 'tests/e2e/a.test.ts', NON_NULL_RULE)).toBe(0)

    let defaults: Array<string> = []
    const byFunction = await createESLint('typescript', {
      testFiles: (testFiles) => [...testFiles, 'spec/**/*.ts'],
      vitest: {
        files: (testFiles) => {
          defaults = testFiles
          return ['e2e/**/*.ts']
        },
      },
    })
    expect(defaults).toContain('spec/**/*.ts')
    expect(await ruleSeverity(byFunction, 'tests/a.test.ts', VITEST_RULE)).toBeUndefined()
    expect(await ruleSeverity(byFunction, 'e2e/a.ts', VITEST_RULE)).toBe(2)
  })
})

describe('area rules', () => {
  it('leave out a rule whose entry is `undefined`, as if it were missing', async () => {
    const eslint = await createESLint('typescript', {
      javascript: { rules: { 'no-console': undefined } },
    })
    expect(await lintText(eslint, 'x.js', 'console.log(1)\n')).toContainEqual(
      expect.stringMatching(/^no-console: /),
    )
  })
})

/**
 * Lints the files in `process.argv[4]` of the working directory with the build's config for the
 * options in `process.argv[3]`, and prints each file's messages
 */
const LINT_SCRIPT = `
const [indexUrl, eslintUrl, optionsJson, files] = process.argv.slice(1)
const { defineConfig } = await import(indexUrl)
const { ESLint } = await import(eslintUrl)
const options = JSON.parse(optionsJson)
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: await defineConfig({ root: process.cwd(), isInEditor: false, ...options }),
})
const results = await eslint.lintFiles(JSON.parse(files))
console.log(JSON.stringify(Object.fromEntries(results.map((result) => [
  result.filePath.slice(process.cwd().length + 1),
  result.messages.map((message) => message.message),
]))))
`

/**
 * The messages of each of `files` in `dir`, linted by a child process with the build's config,
 * since typescript-eslint keeps one project service for the whole process
 */
async function lintInChild(dir: string, files: Array<string>): Promise<unknown> {
  const stdout = await runNodeOk(
    [
      '--input-type=module',
      '--eval',
      LINT_SCRIPT,
      pathToFileURL(path.join(BUILD_DIR, 'index.js')).href,
      pathToFileURL(createRequire(import.meta.url).resolve('eslint')).href,
      JSON.stringify(CORE_AREAS_OFF),
      JSON.stringify(files),
    ],
    { cwd: dir },
  )
  return JSON.parse(stdout)
}

/**
 * The default `typeAware.allowDefaultProject` of `root`, as one walk of the project finds it
 */
function findDefaults(root: string): Array<string> {
  const { tsconfigFiles, configFiles } = scanProject({
    root,
    gitignore: false,
    ignores: [],
    findsTsconfigFiles: true,
  })
  return findDefaultProjectFiles(root, tsconfigFiles, configFiles)
}

describe('typeAware.allowDefaultProject', () => {
  const PROJECT = {
    'package.json': '{ "name": "default-project", "private": true, "type": "module" }\n',
    'tsconfig.json': '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n',
    'src/index.ts': 'export const a = 1\n',
    'vitest.config.ts': 'export default { test: {} }\n',
  }

  it.each<[string, Record<string, string>, Array<string>]>([
    ['every root config file', {}, ['eslint.config.mts', 'vitest.config.ts']],
    [
      'the root config files with an infix, but not declaration or test files',
      {
        'vitest.config.e2e.ts': 'export default {}\n',
        'vite.config.prod.mts': 'export default {}\n',
        'x.config.d.ts': 'export {}\n',
        'x.config.test.ts': 'export {}\n',
      },
      ['eslint.config.mts', 'vite.config.prod.mts', 'vitest.config.e2e.ts', 'vitest.config.ts'],
    ],
    [
      'none that a referenced project includes',
      {
        'tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.node.json" }] }\n',
        'tsconfig.node.json':
          '{ "compilerOptions": { "composite": true }, "include": ["*.config.*ts"] }\n',
      },
      [],
    ],
  ])('defaults to %s', async (_name, files, expected) => {
    await using project = await withProject({
      ...PROJECT,
      'eslint.config.mts': 'export default []\n',
      ...files,
    })
    expect(findDefaults(project.dir)).toEqual(expected)
  })

  it('finds the TypeScript and JavaScript config files of every folder', async () => {
    await using project = await withProject({
      ...PROJECT,
      'eslint.config.mjs': 'export default []\n',
      'packages/a/tsconfig.json': '{ "include": ["src"] }\n',
      'packages/a/vitest.config.ts': 'export default {}\n',
      'packages/a/tool.config.js': 'export default {}\n',
      'packages/b/vitest.config.ts': 'export default {}\n',
    })
    expect(findDefaults(project.dir)).toEqual([
      'eslint.config.mjs',
      'packages/a/tool.config.js',
      'packages/a/vitest.config.ts',
      'packages/b/vitest.config.ts',
      'vitest.config.ts',
    ])
  })

  it('leaves out the config files that a .gitignore or your ignores match', async () => {
    await using project = await withProject({
      ...PROJECT,
      '.git/HEAD': '',
      '.gitignore': '*.timestamp-*.mjs\n',
      'vite.config.ts.timestamp-1.mjs': 'export default {}\n',
      'tools/x.config.ts': 'export default {}\n',
    })
    const { tsconfigFiles, configFiles } = scanProject({
      root: project.dir,
      gitignore: true,
      ignores: ['tools/'],
      findsTsconfigFiles: true,
    })
    expect(findDefaultProjectFiles(project.dir, tsconfigFiles, configFiles)).toEqual([
      'eslint.config.mjs',
      'vitest.config.ts',
    ])
  })

  it('un-ignores JavaScript config files in folders with glob characters, with globs that match them', async () => {
    const folders = ['[slug]', '(group)', '{a,b}', '#tools']
    await using project = await withProject({
      ...PROJECT,
      ...Object.fromEntries(
        folders.flatMap((folder) => [
          [`${folder}/tsconfig.json`, '{ "include": ["src"] }\n'],
          [`${folder}/eslint.config.mjs`, 'export default []\n'],
        ]),
      ),
    })
    const unignores = (resolveOptions({ root: project.dir }).typeAware?.ignores ?? [])
      .filter((glob) => glob.startsWith('!'))
      .map((glob) => glob.slice(1))
    expect(unignores).toHaveLength(folders.length + 1)
    for (const folder of folders) {
      const file = `${folder}/eslint.config.mjs`
      expect(
        unignores.filter((glob) => minimatch(file, glob, { dot: true })),
        file,
      ).toHaveLength(1)
    }
  })

  // One process lints the default project end to end, since typescript-eslint keeps one project
  // service per process. The other tests check the files the package puts in it
  it('lints more than 8 root config files with type information, and names the fix for one that an included file imports', async () => {
    const configFiles = Array.from('abcdefghij', (name) => `${name}.config.ts`)
    await using project = await withProject({
      ...PROJECT,
      'tsconfig.json':
        '{ "compilerOptions": { "strict": true, "module": "nodenext" }, "include": ["src"] }\n',
      'src/index.ts': "import config from '../vitest.config.js'\n\nexport { config }\n",
      'eslint.config.mjs': "Promise.reject(new Error('a'))\n\nexport default []\n",
      ...Object.fromEntries(configFiles.map((file) => [file, 'export default {}\n'])),
    })
    expect(findDefaults(project.dir)).toEqual(
      [...configFiles, 'eslint.config.mjs', 'vitest.config.ts'].toSorted(collator.compare),
    )
    expect(
      await lintInChild(project.dir, ['eslint.config.mjs', 'vitest.config.ts', ...configFiles]),
    ).toEqual({
      'eslint.config.mjs': [expect.stringMatching(/^Promises must be awaited/)],
      'vitest.config.ts': [
        expect.stringMatching(
          /^Parsing error: @gpahal\/eslint-config: project service: `[^`]+vitest\.config\.ts`: `vitest\.config\.ts` is in the default project, and a tsconfig project also includes it through an import\. Add it to that tsconfig's `include`, or leave it out of the default project with `typeAware: \{ allowDefaultProject: \(files\) => files\.filter\(\(file\) => file !== 'vitest\.config\.ts'\) \}`$/,
        ),
      ],
      ...Object.fromEntries(configFiles.map((file) => [file, []])),
    })
  })

  it("leaves out a Vite project's config file that a referenced tsconfig includes, with JSON files ignored", async () => {
    await using project = await withProject({
      ...PROJECT,
      'tsconfig.json':
        '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }\n',
      'tsconfig.app.json': '{ "compilerOptions": { "composite": true }, "include": ["src"] }\n',
      'tsconfig.node.json':
        '{ "compilerOptions": { "composite": true }, "include": ["vite.config.ts"] }\n',
      'vite.config.ts': 'export default {}\n',
    })
    expect(
      resolveOptions({ root: project.dir, ignores: (defaults) => [...defaults, '**/*.json'] })
        .allowDefaultProject,
    ).toEqual(['eslint.config.mjs', 'vitest.config.ts'])
  })

  it('lists the config files that no tsconfig the project service opens includes', async () => {
    const base = '{ "compilerOptions": { "strict": true, "types": ["*"], "skipLibCheck": true } }\n'
    const config = 'export default {}\n'
    const source = 'export const x = 1\n'
    const shared =
      // eslint-disable-next-line no-template-curly-in-string -- tsconfig's own template
      '{ "extends": "./tsconfig.base.json", "include": ["${configDir}/src", "${configDir}/*.config.ts"] }\n'
    await using project = await withProject({
      'package.json': '{ "private": true, "type": "module" }\n',
      'node_modules/@scope/tsconfig/package.json':
        '{ "name": "@scope/tsconfig", "version": "1.0.0", "exports": { "./base": "./base.json" } }\n',
      'node_modules/@scope/tsconfig/base.json': base,
      'tsconfig.base.json': base,
      'tsconfig.json':
        '{ "extends": "./tsconfig.base.json", "files": [], "references": [{ "path": "./packages/a" }] }\n',
      // Not included
      'packages/a/tsconfig.json':
        '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "composite": true }, "include": ["src"] }\n',
      'packages/a/src/x.ts': source,
      'packages/a/vitest.config.ts': config,
      // Through a package's export
      'packages/b/tsconfig.json':
        '{ "extends": "@scope/tsconfig/base", "include": ["src", "*.config.ts"] }\n',
      'packages/b/src/x.ts': source,
      'packages/b/vitest.config.ts': config,
      // Through the last of an `extends` array
      'packages/c/x.json': '{ "compilerOptions": { "strict": true } }\n',
      'packages/c/y.json': '{ "extends": "../../tsconfig.base.json", "include": ["**/*"] }\n',
      'packages/c/tsconfig.json': '{ "extends": ["./x.json", "./y.json"] }\n',
      'packages/c/src/x.ts': source,
      'packages/c/vite.config.ts': config,
      // Through `${configDir}` in a shared tsconfig, which TypeScript resolves from the folder of
      // each tsconfig extending it
      'tsconfig.shared.json': shared,
      'packages/d/tsconfig.json': '{ "extends": "../../tsconfig.shared.json" }\n',
      'packages/d/src/x.ts': source,
      'packages/d/vite.config.ts': config,
      // Excluded
      'packages/i/tsconfig.json':
        '{ "extends": "../../tsconfig.base.json", "include": ["**/*"], "exclude": ["vitest.config.ts"] }\n',
      'packages/i/src/x.ts': source,
      'packages/i/vitest.config.ts': config,
    })
    expect(findDefaults(project.dir)).toEqual([
      'eslint.config.mjs',
      'packages/a/vitest.config.ts',
      'packages/i/vitest.config.ts',
    ])
  })

  it('leaves out the config files of a JavaScript project whose jsconfig.json includes them', async () => {
    await using project = await withProject({
      'package.json': '{ "name": "js-project", "private": true, "type": "module" }\n',
      // `allowJs` is on by default in a jsconfig.json, without `checkJs`
      'jsconfig.json': '{}\n',
      'eslint.config.mjs': 'export default []\n',
      'index.js': 'export const a = 1\n',
    })
    expect(findDefaults(project.dir)).toEqual([])
  })

  // Without a tsconfig, the default project would type it with typescript-eslint's defaults, which
  // lack Node's types, so `import.meta.dirname` would be an error type
  it('gives the JavaScript config files of a project without a tsconfig, jsconfig or TypeScript files no type information', async () => {
    await using project = await withProject({
      'package.json': '{ "name": "js-project", "private": true, "type": "module" }\n',
      'eslint.config.mjs': 'export const root = import.meta.dirname\n\nexport default []\n',
      'vite.config.ts': 'export default {}\n',
      'src/index.js': 'export const answer = 42\n',
    })
    expect(resolveOptions({ root: project.dir }).allowDefaultProject).toEqual(['vite.config.ts'])
    const eslint = await createESLint(project.dir, CORE_AREAS_OFF)
    for (const file of ['eslint.config.mjs', 'src/index.js']) {
      const config = (await eslint.calculateConfigForFile(file)) as Linter.Config
      const parserOptions = config.languageOptions?.['parserOptions'] as Linter.ParserOptions
      expect(parserOptions['projectService'], file).toBe(false)
      expect((await ruleSeverity(eslint, file, FLOATING_RULE)) ?? 0, file).toBe(0)
    }
  })

  // No tsconfig of a Vite or Next.js template includes `.storybook`, and `storybook init` doesn't
  // add it, so its files parse only in the default project
  it("gives Storybook's config files in `.storybook` the default project", async () => {
    await using project = await withProject({
      ...PROJECT,
      '.storybook/main.ts':
        'const config = { stories: [] as Array<string> }\n\nexport default config\n',
      '.storybook/preview.tsx': 'export default {}\n',
      '.storybook/types.d.ts': 'export {}\n',
      '.storybook/addons/x.ts': 'export {}\n',
    })
    expect(resolveOptions({ root: project.dir }).allowDefaultProject).toEqual([
      '.storybook/main.ts',
      '.storybook/preview.tsx',
      'eslint.config.mjs',
      'vitest.config.ts',
    ])
  })

  it('gives the JavaScript files of a glob with braces the type-aware rules', async () => {
    await using project = await withProject({ ...PROJECT, 'src/a.js': 'export const a = 1\n' })
    const eslint = await createESLint(project.dir, {
      ...CORE_AREAS_OFF,
      typeAware: { allowDefaultProject: ['*.config.{js,mjs}', 'vitest.config.ts'] },
    })
    expect(await ruleSeverity(eslint, 'eslint.config.mjs', FLOATING_RULE)).toBe(2)
    expect((await ruleSeverity(eslint, 'src/a.js', FLOATING_RULE)) ?? 0).toBe(0)
    const tsOnly = await createESLint(project.dir, {
      ...CORE_AREAS_OFF,
      typeAware: { allowDefaultProject: ['vitest.config.ts'] },
    })
    expect((await ruleSeverity(tsOnly, 'eslint.config.mjs', FLOATING_RULE)) ?? 0).toBe(0)
  })

  /**
   * The default project's file limit of the configs for `options`
   */
  async function getFileLimit(options: EslintConfigOptions): Promise<unknown> {
    const configs: Array<Linter.Config> = await defineConfig(options)
    const parserOptions = configs.find(
      (config) => config.name === 'gpahal/javascript/language-options',
    )?.languageOptions?.['parserOptions'] as { projectService: Record<string, unknown> }
    return parserOptions.projectService[
      'maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING'
    ]
  }

  // `PROJECT` with a `vitest.config.ts` in each of 10 packages, the last of them git-ignored
  const PACKAGES_PROJECT = {
    ...PROJECT,
    '.gitignore': 'packages/j/\n',
    ...Object.fromEntries(
      Array.from('abcdefghij', (name) => [
        `packages/${name}/vitest.config.ts`,
        'export default { test: {} }\n',
      ]),
    ),
  }

  it.each<[string, Array<string> | ListTransform | undefined, number | undefined]>([
    ['the files found by default', undefined, 32],
    [
      'each file once, with the literal paths and the files a glob of an array matches',
      ['packages/a/vitest.config.ts', 'packages/*/vitest.config.ts', 'vitest.config.ts'],
      32,
    ],
    ['8 files with headroom', ['packages/[a-h]/vitest.config.ts'], 16],
  ])('raises the file limit for %s', async (_name, allowDefaultProject, limit) => {
    await using project = await withProject(PACKAGES_PROJECT)
    expect(await getFileLimit({ root: project.dir, typeAware: { allowDefaultProject } })).toBe(
      limit,
    )
  })

  it("raises the file limit for the 30 files a function's glob adds", async () => {
    await using project = await withProject({
      ...PROJECT,
      ...Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [`scripts/s${index}.ts`, 'export const a = 1\n']),
      ),
    })
    const allowDefaultProject: ListTransform = (defaults) => [...defaults, 'scripts/*.ts']
    expect(await getFileLimit({ root: project.dir, typeAware: { allowDefaultProject } })).toBe(48)
  })
})

describe('globs', () => {
  const NODE_RULE = 'n/no-deprecated-api'
  const LIBRARY_RULE = '@typescript-eslint/explicit-module-boundary-types'

  it('accept an extglob as the last segment, whose extension is unknown', async () => {
    const eslint = await createESLint('typescript', { node: { scope: ['src/**/!(*test*)'] } })
    expect(await ruleSeverity(eslint, 'src/main.ts', NODE_RULE)).toBe(2)
    expect(await ruleSeverity(eslint, 'src/main.test.ts', NODE_RULE)).toBeUndefined()
  })

  it.each([
    ['node.scope', { node: { scope: ['apps/**', '!apps/x/**'] } }, NODE_RULE],
    ['react.scope', { react: { scope: ['apps/**', '!apps/x/**'] } }, 'react-hooks/rules-of-hooks'],
  ])('leave the files negated globs match out of `%s`', async (_, options, rule) => {
    const eslint = await createESLint('typescript', options)
    expect(await ruleSeverity(eslint, 'apps/web/a.tsx', rule)).toBe(2)
    expect(await ruleSeverity(eslint, 'apps/x/a.tsx', rule)).toBeUndefined()
    expect(await ruleSeverity(eslint, 'lib/a.tsx', rule)).toBeUndefined()
  })

  it('leave the files negated globs match out of `testFiles`, and in the library rules', async () => {
    const eslint = await createESLint('typescript', {
      testFiles: (defaults) => [...defaults, '!**/fixtures/**'],
      typescript: { library: true },
      vitest: true,
    })
    expect(await ruleSeverity(eslint, 'tests/a.test.ts', NON_NULL_RULE)).toBe(0)
    expect(await ruleSeverity(eslint, 'tests/fixtures/a.test.ts', NON_NULL_RULE)).toBe(2)
    expect(await ruleSeverity(eslint, 'tests/fixtures/a.test.ts', VITEST_RULE)).toBeUndefined()
    expect(await ruleSeverity(eslint, 'tests/a.test.ts', LIBRARY_RULE)).toBeUndefined()
    expect(await ruleSeverity(eslint, 'tests/fixtures/a.test.ts', LIBRARY_RULE)).toBe(2)
  })
})

describe('files', () => {
  it('is a frozen object of frozen arrays of the default globs', () => {
    expect(Object.isFrozen(files)).toBe(true)
    for (const [kind, globs] of Object.entries(files)) {
      expect(Object.isFrozen(globs), kind).toBe(true)
      expect(globs.length, kind).toBeGreaterThan(0)
    }
    expect(files.markdown).toEqual(['**/*.md', '**/*.markdown'])
  })

  it('works as the files of a user config', async () => {
    const eslint = await createESLint('typescript', {
      configs: [{ files: [...files.test], rules: { 'no-plusplus': 'error' } }],
    })
    expect(await ruleSeverity(eslint, 'tests/a.test.ts', 'no-plusplus')).toBe(2)
    expect(await ruleSeverity(eslint, 'src/a.ts', 'no-plusplus')).toBeUndefined()
  })
})

describe('nextjs.rootDir', () => {
  const RULE = '@next/next/no-html-link-for-pages'
  const MONOREPO = {
    'package.json': '{ "name": "monorepo", "private": true, "type": "module" }\n',
    'apps/web/pages/about.tsx': 'export default function About() {\n  return null\n}\n',
    'apps/docs/app/page.tsx': 'export default function Page() {\n  return null\n}\n',
  }

  async function ruleEntry(dir: string, options: Parameters<typeof createESLint>[1]) {
    const eslint = await createESLint(dir, options)
    const config = (await eslint.calculateConfigForFile(path.join(dir, 'apps/web/nav.tsx'))) as
      Linter.Config | undefined
    return { entry: config?.rules?.[RULE], settings: config?.settings?.['next'] }
  }

  it("finds the pages folders of the apps' roots, and is off without one", async () => {
    await using project = await withProject(MONOREPO)
    const { entry, settings } = await ruleEntry(project.dir, {
      nextjs: { scope: ['apps/**'], rootDir: ['apps/web', 'apps/docs'] },
    })
    expect(entry).toEqual([2, [path.join(project.dir, 'apps/web/pages')]])
    // Each app's links against its own routes only
    expect(settings).toEqual({ rootDir: path.join(project.dir, 'apps/web') })
    expect((await ruleEntry(project.dir, { nextjs: { scope: ['apps/**'] } })).entry).toEqual([0])
  })

  it('scopes the preset to the apps without `nextjs.scope`', async () => {
    const avatar =
      'export function Avatar(): React.ReactNode {\n  return <img src="/a.png" alt="A" />\n}\n'
    await using project = await withProject({
      ...MONOREPO,
      'packages/ui/src/avatar.tsx': avatar,
      'apps/web/src/avatar.tsx': avatar,
    })
    const eslint = await createESLint(project.dir, {
      nextjs: { rootDir: ['apps/web', 'apps/docs'] },
      typeAware: false,
    })
    const rule = '@next/next/no-img-element'
    expect(await ruleSeverity(eslint, 'packages/ui/src/avatar.tsx', rule)).toBeUndefined()
    expect(await ruleSeverity(eslint, 'apps/web/src/avatar.tsx', rule)).toBe(2)
  })
})

describe('a second root in the same process', () => {
  /**
   * Roots with equal compiler options and a default-project `tool.config.ts` that calls `check()`,
   * which each root's `@types/node` declares to return its `returnType`, at its `version`
   */
  function ambientTypesProject(
    types: Record<string, { returnType: string; version: string }>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(types).flatMap(([name, { returnType, version }]) => [
        [
          `${name}/tsconfig.json`,
          JSON.stringify({
            compilerOptions: { strict: true, target: 'ES2024', types: ['node'] },
            include: ['src'],
          }),
        ],
        [`${name}/src/index.ts`, 'export {}\n'],
        [`${name}/tool.config.ts`, 'check()\n'],
        [
          `${name}/node_modules/@types/node/package.json`,
          JSON.stringify({ name: '@types/node', version, types: 'index.d.ts' }),
        ],
        [
          `${name}/node_modules/@types/node/index.d.ts`,
          `declare function check(): ${returnType}\n`,
        ],
      ]),
    )
  }

  /**
   * The `no-floating-promises` reports and fatal messages of each root's `tool.config.ts`, linted
   * in order by one child process, since typescript-eslint keeps one project service for it
   */
  async function lintRootsInChild(
    dir: string,
    roots: Array<string>,
  ): Promise<Record<string, { floating: number; fatal: Array<string> }>> {
    const stdout = await runNodeOk([
      '--input-type=module',
      '--eval',
      `
      import path from 'node:path'
      const [indexUrl, eslintUrl, dir, areasJson, rootsJson] = process.argv.slice(1)
      const { defineConfig } = await import(indexUrl)
      const { ESLint } = await import(eslintUrl)
      const output = {}
      for (const name of JSON.parse(rootsJson)) {
        const root = path.join(dir, name)
        const config = await defineConfig({ root, isInEditor: false, ...JSON.parse(areasJson), typeAware: { allowDefaultProject: ['tool.config.ts'] } })
        const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config })
        const [result] = await eslint.lintFiles([path.join(root, 'tool.config.ts')])
        output[name] = {
          floating: result.messages.filter((message) => message.ruleId === '@typescript-eslint/no-floating-promises').length,
          fatal: result.messages.filter((message) => message.fatal).map((message) => message.message),
        }
      }
      console.log(JSON.stringify(output))
      `,
      pathToFileURL(path.join(BUILD_DIR, 'index.js')).href,
      pathToFileURL(createRequire(import.meta.url).resolve('eslint')).href,
      dir,
      JSON.stringify(CORE_AREAS_OFF),
      JSON.stringify(roots),
    ])
    return JSON.parse(stdout) as Record<string, { floating: number; fatal: Array<string> }>
  }

  it('lints one whose default project loads the same type packages through links, and rejects one that loads another version', async () => {
    await using project = await withProject(
      ambientTypesProject({
        a: { returnType: 'Promise<void>', version: '1.0.0' },
        b: { returnType: 'Promise<void>', version: '1.0.0' },
        c: { returnType: 'void', version: '2.0.0' },
      }),
    )
    // As pnpm links each package's `@types/node` to one folder in its store
    const types = path.join(project.dir, 'b/node_modules/@types/node')
    await fs.rm(types, { recursive: true })
    await fs.symlink(path.join(project.dir, 'a/node_modules/@types/node'), types, 'junction')
    const file = path.join(project.dir, 'c', 'tool.config.ts')
    expect(await lintRootsInChild(project.dir, ['a', 'b', 'c'])).toEqual({
      a: { floating: 1, fatal: [] },
      b: { floating: 1, fatal: [] },
      c: {
        floating: 0,
        fatal: [
          `Parsing error: @gpahal/eslint-config: project service: \`${file}\`: the config of \`${path.join(project.dir, 'c')}\` sets the type packages that \`${path.join(project.dir, 'c', 'tsconfig.json')}\` loads for the default project, against those of \`${path.join(project.dir, 'a', 'tsconfig.json')}\` in the config of \`${path.join(project.dir, 'a')}\`, whose project service this process already uses. typescript-eslint keeps one project service per process, with the options of the first config that uses it. Lint the packages with one config at their common root, limiting presets with \`scope\` and settings with \`files\`, or run ESLint once per package`,
        ],
      },
    })
  })
})

describe('the parsing of tsconfigs for the default project', () => {
  const options = { module: 'NodeNext', moduleResolution: 'NodeNext', types: [] }

  /**
   * A workspace of `count` packages, each with a `tsconfig.json` that extends the root's, a source
   * folder and a `vitest.config.ts` that no project includes
   */
  function packagesProject(count: number): Record<string, string> {
    return {
      'package.json': '{"type":"module"}',
      'tsconfig.json': JSON.stringify({ compilerOptions: options, files: [] }),
      ...Object.fromEntries(
        Array.from({ length: count }, (_, index) => index).flatMap(
          (index): Array<[string, string]> => [
            [
              `packages/p${index}/tsconfig.json`,
              '{"extends":"../../tsconfig.json","include":["src"]}',
            ],
            [`packages/p${index}/vitest.config.ts`, 'export default {}\n'],
            [`packages/p${index}/src/a.ts`, 'export const a = 1\n'],
          ],
        ),
      ),
    }
  }

  it('reads a tsconfig that the projects extend once, and none again for a second config', async () => {
    await using project = await withProject(packagesProject(4))
    const rootTsconfig = path.join(project.dir, 'tsconfig.json')
    const readFileSync = vi.spyOn(syncFs, 'readFileSync')
    try {
      expect(findDefaults(project.dir)).toHaveLength(5)
      // Once as a project and once as the config the others extend
      expect(readFileSync.mock.calls.filter(([file]) => file === rootTsconfig)).toHaveLength(2)
    } finally {
      readFileSync.mockRestore()
    }

    await defineConfig({ root: project.dir, isInEditor: false })
    const secondRead = vi.spyOn(syncFs, 'readFileSync')
    try {
      await defineConfig({ root: project.dir, isInEditor: false })
      expect(secondRead.mock.calls.map(([file]) => file)).not.toContain(
        path.join(project.dir, 'packages', 'p0', 'tsconfig.json'),
      )
    } finally {
      secondRead.mockRestore()
    }
  })

  it('sees a config file added after an earlier discovery', async () => {
    await using project = await withProject({
      'package.json': '{"type":"module"}',
      'tsconfig.json': JSON.stringify({ compilerOptions: options, include: ['shared/**/*'] }),
      'shared/a.ts': 'export const a = 1\n',
    })
    expect(findDefaults(project.dir)).toEqual(['eslint.config.mjs'])
    await fs.writeFile(path.join(project.dir, 'shared', 'tsup.config.ts'), '')
    await fs.writeFile(path.join(project.dir, 'extra.config.ts'), '')
    // The tsconfig includes the new file in `shared`, so only the one outside it is left
    expect(findDefaults(project.dir)).toEqual(['eslint.config.mjs', 'extra.config.ts'])
  })

  it.each<[string, Record<string, string>, Array<string>]>([
    [
      'leaves out a config file that a transitively referenced project includes',
      {
        'tsconfig.json': '{ "files": [], "references": [{ "path": "./packages/a" }] }\n',
        'packages/a/tsconfig.json':
          '{ "compilerOptions": { "composite": true, "strict": true }, "include": ["src"], "references": [{ "path": "./tsconfig.node.json" }] }\n',
        'packages/a/tsconfig.node.json':
          '{ "compilerOptions": { "composite": true, "strict": true }, "include": ["vite.config.ts"] }\n',
      },
      ['eslint.config.mjs'],
    ],
    [
      'keeps a config file that only a project referenced through one with `disableReferencedProjectLoad` includes',
      {
        'tsconfig.json': '{ "files": [], "references": [{ "path": "./packages/a" }] }\n',
        'packages/a/tsconfig.json':
          '{ "compilerOptions": { "composite": true, "strict": true, "disableReferencedProjectLoad": true }, "include": ["src"], "references": [{ "path": "./tsconfig.node.json" }] }\n',
        'packages/a/tsconfig.node.json':
          '{ "compilerOptions": { "composite": true, "strict": true }, "include": ["vite.config.ts"] }\n',
      },
      ['eslint.config.mjs', 'packages/a/vite.config.ts'],
    ],
  ])('%s', async (_name, files, expected) => {
    await using project = await withProject({
      'package.json': '{ "name": "root", "private": true, "type": "module" }\n',
      'packages/a/src/index.ts': 'export const a = 1\n',
      'packages/a/vite.config.ts': 'export default {}\n',
      ...files,
    })
    expect(findDefaults(project.dir)).toEqual(expected)
  })
})

describe('react.compiler', () => {
  it.each<[string, Record<string, string>, boolean]>([
    ['pnpm-workspace.yaml', { 'pnpm-workspace.yaml': "packages:\n# Apps\n- 'apps/*'\n" }, true],
    ['`workspaces`', { 'package.json': '{ "type": "module", "workspaces": ["apps/*"] }' }, true],
    [
      'a multi-line flow sequence with comments and braces',
      { 'pnpm-workspace.yaml': "packages: [\n  'libs/*', # Libraries\n  'apps/{web,api}',\n]\n" },
      true,
    ],
    [
      'a flow sequence with commas, `]` and `#` in quotes',
      { 'pnpm-workspace.yaml': 'packages: [\'libs/[a,]]\', "x #y", "apps/{web,x]}"]\n' },
      true,
    ],
    ['a malformed pnpm-workspace.yaml', { 'pnpm-workspace.yaml': "packages: ['apps/*'\n" }, false],
  ])('is detected from a workspace package of %s: %s', async (_name, files, expected) => {
    await using project = await withProject({
      'package.json': '{ "type": "module" }',
      ...files,
      'apps/web/package.json': JSON.stringify({
        dependencies: { 'react-compiler-runtime': '*' },
      }),
    })
    expect(resolveOptions({ root: project.dir, typeAware: false, react: true }).reactCompiler).toBe(
      expected,
    )
  })
})

describe("Playwright's testDir", () => {
  it("warns only when `playwright.files` misses a literal testDir's tests", async () => {
    const createPlaywright = {
      'package.json': '{ "type": "module", "devDependencies": { "@playwright/test": "*" } }',
      'playwright.config.ts':
        "import { defineConfig } from '@playwright/test'\n\nexport default defineConfig({\n  testDir: './tests',\n})\n",
      'tests/example.spec.ts': '',
    }
    const testDirWarnings = (root: string, options: Omit<EslintConfigOptions, 'root'>) =>
      warningsOf(root, { typeAware: false, ...options }).filter(
        ([, code]) => code === 'GPAHAL_PLAYWRIGHT_FILES_UNMATCHED',
      )
    await using project = await withProject(createPlaywright)
    expect(testDirWarnings(project.dir, { playwright: true })).toEqual([
      [
        "@gpahal/eslint-config: `playwright.files`: `playwright.config.ts` sets `testDir` to `./tests`, but `playwright.files` doesn't match its tests, such as `tests/example.spec.ts`, so they get no Playwright rules. Set `playwright: { files: ['tests/**'] }`",
        'GPAHAL_PLAYWRIGHT_FILES_UNMATCHED',
      ],
    ])
    // A fresh project for each, since a hint is given once per root
    for (const files of [['tests/**'], ['./tests/**']]) {
      await using matched = await withProject(createPlaywright)
      expect(testDirWarnings(matched.dir, { playwright: { files } })).toEqual([])
    }
    await using dynamic = await withProject({
      ...createPlaywright,
      'playwright.config.ts': 'export default { testDir: process.env.DIR }\n',
    })
    expect(testDirWarnings(dynamic.dir, { playwright: true })).toEqual([])
  })
})

describe('scanProject', () => {
  it('lists the source files only when asked, and still finds a TypeScript file', async () => {
    await using project = await withProject({
      'src/a.js': 'export const a = 1\n',
      'src/b.ts': 'export const b = 1\n',
    })
    const scan = (options: Partial<Parameters<typeof scanProject>[0]>) =>
      scanProject({
        root: project.dir,
        gitignore: false,
        ignores: [],
        findsTsconfigFiles: true,
        ...options,
      })
    expect(new Set(scan({}).sourceFiles)).toEqual(new Set(['src/a.js', 'src/b.ts']))
    expect(scan({ collectsSourceFiles: false })).toMatchObject({
      sourceFiles: [],
      hasTypescriptFiles: true,
    })
    expect(scan({ isUntyped: (file) => file.endsWith('.ts') }).hasTypescriptFiles).toBe(false)
  })
})

describe('GPAHAL_ROOT_GITIGNORED', () => {
  it.each<[string, boolean]>([
    ['sub/', false],
    ['*', true],
  ])(
    'says whether ESLint ignores the project too, for a parent `.gitignore` of `%s`',
    async (rule, isIgnoredByESLint) => {
      await using project = await withProject({
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.gitignore': `${rule}\n`,
        'sub/eslint.config.mjs': 'export default []\n',
        'sub/a.js': 'export const a = 1\n',
      })
      const root = path.join(project.dir, 'sub')
      const warnings = warningsOf(root, { typeAware: false }).filter(
        ([, code]) => code === 'GPAHAL_ROOT_GITIGNORED',
      )
      expect(warnings).toHaveLength(1)
      expect(warnings[0]?.[0]).toContain(
        isIgnoredByESLint
          ? 'so git ignores every file in the project, and ESLint does too.'
          : 'so git ignores every file in the project, though ESLint still lints them.',
      )
      const configs = await defineConfig({ root, typeAware: false, isInEditor: false })
      expect(await eslintWith(root, configs).isPathIgnored(path.join(root, 'a.js'))).toBe(
        isIgnoredByESLint,
      )
    },
  )
})

describe('warnings', () => {
  const COMMONJS_PACKAGE = {
    'package.json': '{ "private": true, "type": "commonjs" }\n',
    'src/a.js': 'module.exports = 1\n',
  }

  /**
   * The codes of the warnings that `defineConfig` of `options` emits, until ESLint would have
   * awaited it
   */
  async function warningCodesOf(options: EslintConfigOptions): Promise<Array<unknown>> {
    const warnings = await captureWarnings(async () => defineConfig(options))
    return warnings.map(([, code]) => code)
  }

  it('silences a code for its config only, and warns once per root', async () => {
    await using project = await withProject(COMMONJS_PACKAGE)
    const options = { root: project.dir, typeAware: false }
    expect(
      await warningCodesOf({ ...options, warnings: { GPAHAL_COMMONJS_PACKAGE: false } }),
    ).toEqual([])
    expect(await warningCodesOf({ ...options, warnings: { GPAHAL_NO_TSCONFIG: false } })).toEqual([
      'GPAHAL_COMMONJS_PACKAGE',
    ])
    expect(await warningCodesOf(options)).toEqual([])
  })

  it("keeps one config's silenced codes from another's, in warnings given after an await", async () => {
    // The files outside every tsconfig are warned of once ESLint awaits the composer
    const project = {
      'tsconfig.json': '{ "compilerOptions": { "types": [] }, "include": ["src"] }\n',
      'src/a.ts': 'export const a = 1\n',
      'scripts/b.ts': 'export const b = 1\n',
    }
    await using first = await withProject(project)
    await using second = await withProject(project)
    const warnings = await captureWarnings(async () => {
      const silenced = defineConfig({
        root: first.dir,
        warnings: { GPAHAL_FILES_OUTSIDE_TSCONFIG: false },
      })
      const warned = defineConfig({ root: second.dir })
      await Promise.all([silenced, warned])
    })
    expect(warnings.filter(([message]) => message.includes('`scripts/b.ts`'))).toHaveLength(1)
  })

  it.each([
    [
      { GPAHAL_COMMONJS: false },
      /^@gpahal\/eslint-config: `warnings\.GPAHAL_COMMONJS`: unknown warning code\. Known warning codes: `GPAHAL_FRAMEWORK_OPTION_UNSET`, .*`GPAHAL_COMMONJS_PACKAGE`/,
    ],
    [
      { GPAHAL_COMMONJS_PACKAGE: 'off' },
      '@gpahal/eslint-config: `warnings.GPAHAL_COMMONJS_PACKAGE`: expected a boolean, received `"off"`',
    ],
  ])('throws on `warnings: %j`', (warnings, message) => {
    // @ts-expect-error - Values the type rejects, as a JavaScript config can pass
    expect(() => defineConfig({ root: FIXTURES_DIR, warnings })).toThrow(message)
  })

  it('silences a code after an await, and in a callback bound where it was made', async () => {
    const warnings = await captureWarnings(async () => {
      const later = await withWarnings({ GPAHAL_ROOT_GITIGNORED: false }, async () => {
        await Promise.resolve()
        warnOfSetup('after an await', 'GPAHAL_ROOT_GITIGNORED')
        return bindWarnings(() => {
          warnOfSetup('bound', 'GPAHAL_ROOT_GITIGNORED')
        })
      })
      later()
      warnOfSetup('outside', 'GPAHAL_ROOT_GITIGNORED')
    })
    expect(warnings.map(([message]) => message)).toEqual(['outside'])
  })
})
