import fs from 'node:fs/promises'
import path from 'node:path'

import eslintPluginE18e from '@e18e/eslint-plugin'
import { ESLint, Linter, type Rule } from 'eslint'
import eslintPluginSlop from 'eslint-plugin-slop'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import { defineConfig as eslintDefineConfig } from 'eslint/config'
import ts from 'typescript'
import tseslint from 'typescript-eslint'

import { defineConfig, type EslintConfigOptions } from '@/index'
import { patchUnsafeFixes } from '@/internal/fixes'
import { wrapSlopPlugin } from '@/internal/presets/antislop'

import { createFocusedESLint } from './fix-helpers'
import {
  createESLint,
  eslintWith,
  FIXTURES_DIR,
  lint,
  lintText,
  ruleIdOf,
  ruleSeverity,
  sharedESLint,
  warningsOf,
  withProject,
  type ConfigOptions,
} from './helpers'

function lineAndRuleOf(message: Linter.LintMessage): string {
  return `${String(message.line)}:${ruleIdOf(message)}`
}

describe('.mts and .cts files', () => {
  it('are linted with type information', async () => {
    // The fixture's tsconfig sets `verbatimModuleSyntax`, which makes `.cts` files use
    // `import = require`, `export =` and `__dirname`
    const eslint = await sharedESLint('typescript')
    expect(await lint(eslint, ['.'])).toEqual({
      'src/index.cts': [expect.stringMatching(/^@typescript-eslint\/no-floating-promises: /)],
      'src/index.mts': [expect.stringMatching(/^@typescript-eslint\/no-floating-promises: /)],
      'src/paths.cts': [],
      'src/types.d.cts': [],
      'src/types.d.mts': [],
      'tsconfig.json': [],
    })
    for (const file of ['src/types.d.mts', 'src/types.d.cts']) {
      expect(await ruleSeverity(eslint, file, '@typescript-eslint/array-type'), file).toBe(2)
    }
  })
})

describe('.cjs files', () => {
  it('allow require, module.exports and __dirname', async () => {
    // Without the default project for `tool.config.cjs`, which typescript-eslint makes once for the
    // process, and which `options.test.ts` lints with in a process of its own
    const eslint = await sharedESLint('cjs', { typeAware: { allowDefaultProject: [] } })
    expect(await lint(eslint, ['.'])).toEqual({
      'eslint.config.mjs': [],
      'early-return.cjs': [],
      'index.cjs': [],
      'tool.config.cjs': [],
    })
  })
})

describe('module types', () => {
  it('parse .cjs files as CommonJS', async () => {
    const eslint = await sharedESLint('cjs')
    const code = [
      "import path from 'node:path'",
      '',
      'export const dir = path.dirname(import.meta.filename)',
      '',
    ].join('\n')
    expect(await lintText(eslint, 'esm.cjs', code)).toEqual([
      expect.stringMatching(/^@gpahal\/no-esm-in-commonjs: `\.cjs` files are CommonJS/),
      expect.stringMatching(/^@gpahal\/no-esm-in-commonjs: `\.cjs` files are CommonJS/),
      expect.stringMatching(/^@gpahal\/no-esm-in-commonjs: `\.cjs` files are CommonJS/),
    ])
  })

  // Reports how the file was parsed and scope-analysed
  const scopeRule: Rule.RuleModule = {
    meta: { type: 'problem', schema: [] },
    create(context) {
      return {
        Program(node) {
          const { childScopes } = context.sourceCode.scopeManager.globalScope!
          context.report({
            node,
            message: `${node.sourceType} ${childScopes.map((scope) => scope.type).join(',')}`,
          })
        },
      }
    },
  }
  const scopeConfig = {
    plugins: { test: { rules: { scope: scopeRule } } },
    rules: { 'test/scope': 'error' },
  } satisfies Linter.Config
  const SCOPE_RULE = new Set(['test/scope'])

  it('scope-analyse .cjs files as CommonJS', async () => {
    const eslint = await createFocusedESLint('cjs', SCOPE_RULE, {
      node: true,
      extraConfigs: [scopeConfig],
    })
    // Node's function wrapper is a function scope, and allows `early-return.cjs`'s top-level return.
    // ESLint's parser, which lints the JavaScript-only project, names the source type `commonjs`
    expect(await lint(eslint, ['early-return.cjs', 'index.cjs'])).toEqual({
      'early-return.cjs': ['test/scope: commonjs function'],
      'index.cjs': ['test/scope: commonjs function'],
    })
    expect(await lintText(eslint, 'scope.mjs', 'export const a = 1\n')).toEqual([
      'test/scope: module module',
    ])
    // TypeScript compiles `import` in `.cts` files to `require()`, so they stay modules
    const typescriptESLint = await createFocusedESLint('typescript', SCOPE_RULE, {
      extraConfigs: [scopeConfig],
    })
    const { 'src/index.cts': messages = [] } = await lint(typescriptESLint, ['src/index.cts'])
    expect(messages.filter((message) => message.startsWith('test/scope'))).toEqual([
      'test/scope: module module',
    ])
  })

  it('report CommonJS and worker globals in ES modules', async () => {
    const eslint = await sharedESLint('cjs')
    const code = 'export const values = [__dirname, __filename, require, name, origin]\n'
    expect(await lintText(eslint, 'index.js', code)).toEqual([
      "no-undef: '__dirname' is not defined.",
      "no-undef: '__filename' is not defined.",
      "no-undef: 'require' is not defined.",
      "no-undef: 'name' is not defined.",
      "no-undef: 'origin' is not defined.",
    ])
    expect(await lintText(eslint, 'index.js', 'export const response = fetch(URL.name)\n')).toEqual(
      [],
    )
  })

  // `__dirname` throws a ReferenceError in an ES module. `@types/node` declares it, so TypeScript
  // passes it, and `no-undef` is off in TypeScript files. eslint-plugin-n's `flat/recommended-module`
  // turns these globals off, which would hide them
  it.each([[undefined], [{ typeStripping: true }]] as const)(
    'report CommonJS globals in TypeScript files, not `.cts` ones, with `node: %j`',
    async (node) => {
      const preferModule = async (fixture: string, file: string, code: string) =>
        (await lintText(await sharedESLint(fixture, { node }), file, code)).filter((message) =>
          message.startsWith('unicorn/prefer-module'),
        )
      expect(
        await preferModule(
          'rules',
          'src/dead-store.ts',
          'export const dir: string = __dirname\nexport const file: string = __filename\n',
        ),
      ).toEqual([
        'unicorn/prefer-module: Do not use "__dirname".',
        'unicorn/prefer-module: Do not use "__filename".',
      ])
      expect(
        await preferModule(
          'typescript',
          'src/index.cts',
          "import path = require('node:path')\n\nexport = path.join(__dirname, 'a')\n",
        ),
      ).toEqual([])
    },
  )
})

describe('CommonJS files', () => {
  it('get no top-level await advice, which CommonJS can not follow', async () => {
    const eslint = await sharedESLint('cjs')
    const code =
      'async function main() {\n  await Promise.resolve()\n}\n\nmain().catch((error) => {\n  console.error(error)\n})\n'
    expect(await lintText(eslint, 'index.cjs', code)).toEqual([])
  })
})

describe('commonjs option', () => {
  const COMMONJS_CODE = [
    "'use strict'",
    '',
    "const path = require('node:path')",
    '',
    "module.exports = path.join(__dirname, 'a')",
    '',
  ].join('\n')

  it('lints .js files as CommonJS with `commonjs: true`', async () => {
    await using project = await withProject({ 'src/a.js': COMMONJS_CODE })
    const eslint = await createESLint(project.dir, {
      typeAware: false,
      gitignore: false,
      commonjs: true,
    })
    expect(await lint(eslint, ['src/a.js'])).toEqual({ 'src/a.js': [] })
    expect(await lintText(eslint, 'src/b.js', "export const a = 'a'\n")).toEqual([
      '@gpahal/no-esm-in-commonjs: `commonjs` makes this file CommonJS: use `require()` and `module.exports`',
    ])
    // Not `.mjs` files, which stay ES modules
    expect(await lintText(eslint, 'src/c.mjs', 'export const dir = __dirname\n')).toEqual([
      "no-undef: '__dirname' is not defined.",
    ])
    // Nor TypeScript files, which keep the ES module globals that `unicorn/prefer-module` reports
    expect(
      (await lintText(eslint, 'src/d.ts', 'export const dir: string = __dirname\n')).map(
        (message) => message.split(':', 1)[0],
      ),
    ).toContain('unicorn/prefer-module')
  })
  it('limits CommonJS to the .js files of `commonjs.files`', async () => {
    await using project = await withProject({
      'scripts/a.js': COMMONJS_CODE,
      'src/a.js': COMMONJS_CODE,
    })
    const eslint = await createFocusedESLint(
      project.dir,
      new Set(['no-undef', 'unicorn/prefer-module', '@gpahal/no-esm-in-commonjs']),
      { typeAware: false, gitignore: false, commonjs: { files: () => ['scripts/**'] } },
    )
    const messages = await lint(eslint, ['scripts/a.js', 'src/a.js'], ruleIdOf)
    expect(messages['scripts/a.js']).toEqual([])
    expect(messages['src/a.js']).toEqual(
      expect.arrayContaining(['no-undef', 'unicorn/prefer-module']),
    )
    // The TypeScript files the globs match stay ES modules
    const config = (await eslint.calculateConfigForFile('scripts/b.ts')) as Linter.Config
    expect(config.languageOptions?.['sourceType']).toBe('module')
  })
})

describe('the commonjs hint', () => {
  const COMMONJS_PACKAGE = {
    'package.json': '{ "private": true, "type": "commonjs" }\n',
    'src/a.js': 'module.exports = 1\n',
  }

  it('suggests `commonjs: true` once for a package of "type": "commonjs"', async () => {
    await using project = await withProject(COMMONJS_PACKAGE)
    expect(warningsOf(project.dir, { typeAware: false })).toEqual([
      [
        '@gpahal/eslint-config: `commonjs`: `package.json` sets `"type": "commonjs"`, so Node runs `.js` files as CommonJS, but they\'re linted as ES modules. Set `commonjs: true`, or `commonjs: false` to lint them as ES modules',
        'GPAHAL_COMMONJS_PACKAGE',
      ],
    ])
    expect(warningsOf(project.dir, { typeAware: false })).toEqual([])
  })

  it.each([true, false])("doesn't warn with `commonjs: %s`", async (commonjs) => {
    await using project = await withProject(COMMONJS_PACKAGE)
    expect(warningsOf(project.dir, { typeAware: false, commonjs })).toEqual([])
  })
  it('suggests `commonjs: true` for a package without "type", which Node runs as CommonJS', async () => {
    await using project = await withProject({ 'package.json': '{}', 'src/a.jsx': '' })
    expect(warningsOf(project.dir, { typeAware: false })).toEqual([
      [
        '@gpahal/eslint-config: `commonjs`: `package.json` has no `"type"`, so Node runs `.js` files as CommonJS, but they\'re linted as ES modules. Set `commonjs: true`, or `commonjs: false` to lint them as ES modules, or set `"type": "module"` in `package.json`',
        'GPAHAL_COMMONJS_PACKAGE',
      ],
    ])
  })
})

async function projectWith(packages: Array<string>): ReturnType<typeof withProject> {
  return withProject({
    'package.json': JSON.stringify({
      private: true,
      type: 'module',
      devDependencies: Object.fromEntries(packages.map((name) => [name, '*'])),
    }),
  })
}

describe('framework hints', () => {
  it.each([
    ['react', 'react', 'Set `react: true` and install its plugins, as in `pnpm add -D '],
    [
      '@playwright/test',
      'playwright',
      'Set `playwright: true` and install its plugins, as in `pnpm add -D "eslint-plugin-playwright@',
    ],
  ])('suggests the option for %s once', async (packageName, option, fix) => {
    await using project = await projectWith([packageName])
    const warnings = warningsOf(project.dir, { typeAware: false })
    expect(warnings).toEqual([
      [
        expect.stringContaining(
          `@gpahal/eslint-config: \`${option}\`: \`package.json\` lists ${packageName}, but the \`${option}\` option isn't set, so its rules are off. ${fix}`,
        ),
        'GPAHAL_FRAMEWORK_OPTION_UNSET',
      ],
    ])
    expect(warnings[0]?.[0]).toMatch(
      new RegExp(`, or set \`${option}: false\` to turn this warning off$`),
    )
    expect(warningsOf(project.dir, { typeAware: false })).toEqual([])
  })
  it('gives the Next.js hint alone for a Next.js app, whose option turns React on', async () => {
    await using project = await projectWith(['next', 'react'])
    expect(warningsOf(project.dir, { typeAware: false }).map(([message]) => message)).toEqual([
      expect.stringMatching(/^@gpahal\/eslint-config: `nextjs`: /),
    ])
  })

  it.each([true, false])("doesn't warn with the option set to %s", async (value) => {
    await using project = await projectWith(['vitest', 'react'])
    expect(warningsOf(project.dir, { typeAware: false, vitest: value, react: value })).toEqual([])
  })
})

describe('unicorn/filename-case', () => {
  it('skips router segments, its folders, generated files and test setup files, with your options too', async () => {
    const files = {
      'src/app/[postId]/page.tsx': 'export const a = 1\n',
      'src/app/[...slug]/page.tsx': 'export const a = 1\n',
      'src/app/[[...slug]]/page.tsx': 'export const a = 1\n',
      'src/pages/[postId].astro': '---\nconst a = 1\n---\n<p>{a}</p>\n',
      'src/app/(marketing)/page.tsx': 'export const a = 1\n',
      'src/app/@modal/page.tsx': 'export const a = 1\n',
      'src/__tests__/App.test.tsx': 'export const a = 1\n',
      'src/vite-env.d.ts': 'export {}\n',
      // Test setup files, whose names the test tools choose
      'src/setupTests.ts': 'export const a = 1\n',
      'vitest-setup.ts': 'export const a = 1\n',
      'src/setupMocks.ts': 'export const a = 1\n',
      'src/fooBar.ts': 'export const a = 1\n',
      'src/foo-bar.ts': 'export const a = 1\n',
    }
    await using project = await withProject(files)
    const options = { astro: true, react: true, typeAware: false, gitignore: false }
    const rules = new Set(['unicorn/filename-case'])
    const kebab = await createFocusedESLint(project.dir, rules, options)
    const camel = await createFocusedESLint(project.dir, rules, {
      ...options,
      // The Quick start's example
      unicorn: { rules: { 'unicorn/filename-case': ['error', { case: 'camelCase' }] } },
    })
    const reportedFiles = async (eslint: ESLint) =>
      Object.entries(await lint(eslint, Object.keys(files), ruleIdOf))
        .filter(([, rules]) => rules.includes('unicorn/filename-case'))
        .map(([file]) => file)
    expect(await reportedFiles(kebab)).toEqual(['src/setupMocks.ts', 'src/fooBar.ts'])
    expect(await reportedFiles(camel)).toEqual(['src/foo-bar.ts'])
  })

  // ESLint 10 lints text without a file name, as from `eslint --stdin`, as `__placeholder__.js`
  it('skips text without a file name', async () => {
    await using project = await withProject()
    const eslint = await createESLint(project.dir, { typeAware: false })
    const [result] = await eslint.lintText('export const a = 1\n')
    expect(result?.messages.map((message) => message.ruleId)).toEqual([])
  })
})

/**
 * The messages of `rule` for `code` as `file` of the node fixture, a package of `"type": "module"`,
 * linted with `options`
 */
async function reportsOf(
  rule: string,
  file: string,
  code: string,
  options: Partial<EslintConfigOptions> = {},
): Promise<Array<string>> {
  const eslint = await sharedESLint('node', { typeAware: false, gitignore: false, ...options })
  return (await lintText(eslint, file, code))
    .map((message) => message.split(':', 1)[0] ?? '')
    .filter((ruleId) => ruleId === rule)
}

describe('rules that misfire on ordinary code', () => {
  it("`n/hashbang` leaves a script's shebang alone with `node`", async () => {
    const code = "#!/usr/bin/env node\n\nconsole.log('released')\n"
    expect(await reportsOf('n/hashbang', 'scripts/release.js', code, { node: true })).toEqual([])
    expect(await reportsOf('n/hashbang', 'src/a.js', code, { node: true })).toEqual(['n/hashbang'])
  })
})

function arrayFunction(body: string): string {
  return [
    'export function double(values: Array<number>): Array<number> {',
    `  return ${body}`,
    '}',
    '',
  ].join('\n')
}

describe('unicorn/prefer-spread', () => {
  const file = 'src/array-from-map.ts'
  const code = arrayFunction

  it('still reports `Array.from()` elsewhere', async () => {
    const eslint = await sharedESLint('rules')
    expect(await lintText(eslint, file, code('Array.from(values)'))).toEqual([
      expect.stringMatching(
        /^unicorn\/prefer-spread: Prefer the spread operator over `Array\.from/,
      ),
    ])
  })

  // Spreading a value without `[Symbol.iterator]` throws, and TypeScript rejects it. `any` says
  // nothing either way
  it.each([
    ['ArrayLike<number>', false],
    ['Set<number>', true],
    ['any', true],
  ])('reports `Array.from(values)` of `%s` when %s', async (type, isReported) => {
    const eslint = await sharedESLint('rules')
    const messages = await lintText(
      eslint,
      file,
      `export function copy(values: ${type}): Array<unknown> {\n  return Array.from(values)\n}\n`,
    )
    expect(messages.some((message) => message.startsWith('unicorn/prefer-spread: '))).toBe(
      isReported,
    )
  })
  it('reports `Array.from(values).map(fn)` once, without a fix, and `Array.from(new Set(values))`', async () => {
    const eslint = await createESLint('rules', {}, { fix: true })
    for (const body of [
      'Array.from(values).map((value) => value * 2)',
      'Array.from(new Set(values))',
    ]) {
      const [result] = await eslint.lintText(code(body), { filePath: file })
      expect(result?.output).toBeUndefined()
      expect(result?.messages.map((message) => message.ruleId ?? message.message)).toEqual([
        'unicorn/prefer-spread',
      ])
    }
  })
})

describe('the patched rules of shared plugins', () => {
  it("keep their stock behaviour in a config that isn't the presets'", async () => {
    // Patches the plugins' rules in place
    await defineConfig({ root: path.join(FIXTURES_DIR, 'rules'), isInEditor: false })
    const linter = new Linter({ configType: 'flat' })
    const config = (rules: Linter.RulesRecord): Linter.Config => ({
      files: ['**/*.js', '**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { e18e: eslintPluginE18e, unicorn: eslintPluginUnicorn },
      rules,
    })
    expect(
      linter.verifyAndFix(
        "o?.hasOwnProperty('k') ?? false\n",
        config({ 'e18e/prefer-object-has-own': 'error' }),
        'x.js',
      ).output,
    ).toBe("Object.hasOwn(o, 'k') ?? false\n")
    expect(
      linter
        .verify(
          'Array.from(s).map((x) => x)\n',
          config({ 'unicorn/prefer-spread': 'error' }),
          'x.js',
        )
        .map((message) => message.ruleId),
    ).toEqual(['unicorn/prefer-spread'])
  })
})

const FIX_COMPILER_OPTIONS = {
  strict: true,
  module: 'preserve',
  moduleResolution: 'bundler',
  allowImportingTsExtensions: true,
  verbatimModuleSyntax: true,
  noEmit: true,
  types: [],
}

type TypedCase = { files: Record<string, string>; file: string }

/**
 * The rules whose fixes the typed cases check, the only ones that run on them, and the layout rule
 * that drops the blank line a removed import leaves at the top
 */
const TYPED_FIX_RULES: ReadonlySet<string> = new Set([
  '@typescript-eslint/consistent-type-definitions',
  '@typescript-eslint/no-unused-vars',
  'unicorn/no-leading-empty-lines',
])

type TypedFix = { output: string; again: string; errors: Array<string>; rules: Array<string> }

/**
 * `--fix`'s output for each case, its TypeScript errors, the rules left reporting and the output of
 * a second `--fix`. The cases share one program, each in a folder of its own, so they must be
 * modules: script files would merge their globals
 */
async function fixTypedProjects(
  cases: ReadonlyArray<TypedCase>,
  configOptions: ConfigOptions = {},
): Promise<Array<TypedFix>> {
  const prefixOf = (index: number) => (cases.length === 1 ? '' : `case${String(index)}/`)
  await using project = await withProject({
    'package.json': JSON.stringify({ name: 'app', private: true, type: 'module' }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: FIX_COMPILER_OPTIONS,
      include: cases.map((_, index) => `${prefixOf(index)}src`),
    }),
    ...Object.fromEntries(
      cases.flatMap(({ files }, index) =>
        Object.entries(files).map(([name, text]) => [`${prefixOf(index)}${name}`, text]),
      ),
    ),
  })
  const targets = cases.map(({ file }, index) =>
    path.join(project.dir, `${prefixOf(index)}${file}`),
  )
  const eslint = await createFocusedESLint(
    project.dir,
    TYPED_FIX_RULES,
    { gitignore: false, ...configOptions },
    { fix: true },
  )
  const fixAndRead = async () => {
    const results = await eslint.lintFiles(targets)
    await ESLint.outputFixes(results)
    const rules = new Map(results.map((result) => [result.filePath, result.messages.map(ruleIdOf)]))
    return Promise.all(
      targets.map(async (target) => ({
        output: await fs.readFile(target, 'utf8'),
        rules: rules.get(target) ?? [],
      })),
    )
  }
  const first = await fixAndRead()
  const { options } = ts.convertCompilerOptionsFromJson(FIX_COMPILER_OPTIONS, project.dir)
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram({ rootNames: targets, options }))
  const again = await fixAndRead()
  return first.map(({ output, rules }, index) => ({
    output,
    again: again[index]?.output ?? '',
    errors: diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.file === undefined ||
          path
            .resolve(diagnostic.file.fileName)
            .startsWith(path.join(project.dir, prefixOf(index))),
      )
      .map(
        (diagnostic) =>
          `TS${String(diagnostic.code)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
      ),
    rules,
  }))
}

type TypedBatch = {
  cases: Array<() => Record<string, TypedCase>>
  fixes?: Promise<Array<Map<string, TypedFix>>>
}

/**
 * The cases of each `fixTypedProjectsOnce` call, by its options, run as one `fixTypedProjects`
 */
const TYPED_BATCHES = new Map<string, TypedBatch>()

async function fixTypedBatch(
  batch: TypedBatch,
  configOptions: ConfigOptions,
): Promise<Array<Map<string, TypedFix>>> {
  const groups = batch.cases.map((cases) => Object.entries(cases()))
  const fixes = await fixTypedProjects(
    groups.flatMap((entries) => entries.map(([, typedCase]) => typedCase)),
    configOptions,
  )
  let index = 0
  return groups.map((entries) => new Map(entries.map(([key]) => [key, fixes[index++]!] as const)))
}

/**
 * Runs `fixTypedProjects` before the describe block it's called in, and returns results by key. The
 * calls with the same options, which must be JSON, share one run, which has every call's cases as
 * the tests are collected before any runs
 */
function fixTypedProjectsOnce(
  cases: () => Record<string, TypedCase>,
  configOptions: ConfigOptions = {},
): (key: string) => TypedFix {
  const batchKey = JSON.stringify(configOptions)
  let batch = TYPED_BATCHES.get(batchKey)
  if (batch === undefined) {
    batch = { cases: [] }
    TYPED_BATCHES.set(batchKey, batch)
  }
  const group = batch.cases.length
  batch.cases.push(cases)
  let results = new Map<string, TypedFix>()
  beforeAll(async () => {
    batch.fixes ??= fixTypedBatch(batch, configOptions)
    results = (await batch.fixes)[group]!
  })
  return (key) => {
    const result = results.get(key)
    if (result === undefined) {
      throw new Error(`no batched case ${key}`)
    }
    return result
  }
}

/**
 * Whether `code`, compiled as TypeScript does under `verbatimModuleSyntax`, still loads `./a.ts`
 */
function loadsModule(code: string): boolean {
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: {
      verbatimModuleSyntax: true,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'b.ts',
  })
  return outputText.includes("'./a.ts'")
}

describe('imports.cycles', () => {
  // `a` imports `b`, which imports `c`, which imports `a`
  const FILES = {
    'package.json': '{ "name": "a", "private": true, "type": "module" }\n',
    'src/a.js': "import { c } from './b.js'\n\nexport const a = c\n",
    'src/b.js': "import { a } from './c.js'\n\nexport const c = a\n",
    'src/c.js': "import { a } from './a.js'\n\nexport { a }\n",
  }
  const ALL = ['src/a.js', 'src/b.js', 'src/c.js']

  it.each([
    [undefined, []],
    [true, ALL],
    [{ maxDepth: 1 }, []],
  ])('reports the files of a cycle with `cycles: %j`', async (cycles, expected) => {
    await using project = await withProject(FILES)
    const eslint = await createFocusedESLint(project.dir, new Set(['import-x/no-cycle']), {
      typeAware: false,
      gitignore: false,
      ...(cycles !== undefined && { imports: { cycles } }),
    })
    const results = await lint(eslint, ['src'], ruleIdOf)
    expect(
      Object.entries(results)
        .filter(([, rules]) => rules.includes('import-x/no-cycle'))
        .map(([file]) => file),
    ).toEqual(expected)
  })
})

describe('imports.removeUnused', () => {
  const MODULE =
    "console.info('loaded')\n\nexport const a = 1\nexport const b = 2\nexport type T = number\n\nexport default 0\n"
  const caseOf = (code: string): TypedCase => ({
    files: { 'src/a.ts': MODULE, 'src/b.ts': code },
    file: 'src/b.ts',
  })

  const REMOVED = [
    [
      'an unused specifier beside a used one',
      "import { a, b } from './a.ts'\n\nexport const x = a\n",
      "import { a } from './a.ts'\n\nexport const x = a\n",
    ],
    [
      'a value import with every specifier unused, as a side-effect import',
      "import { a, b } from './a.ts'\n\nexport const x = 1\n",
      "import './a.ts'\n\nexport const x = 1\n",
    ],
    [
      'an unused default import beside a used named one',
      "import d, { a } from './a.ts'\n\nexport const x = a\n",
      "import { a } from './a.ts'\n\nexport const x = a\n",
    ],
    [
      'an unused `import type`, entirely',
      "import type { T } from './a.ts'\n\nexport const x = 1\n",
      'export const x = 1\n',
    ],
    [
      'an unused type import beside a side-effect import, keeping that',
      "import type { T } from './a.ts'\nimport './a.ts'\n\nexport const x = 1\n",
      "import './a.ts'\n\nexport const x = 1\n",
    ],
  ] as const
  // The fix would move the comment
  const BEFORE_LINE_COMMENT = "import d // keep\n, { a } from './a.ts'\n\nexport const x = a\n"
  const fixed = fixTypedProjectsOnce(
    () =>
      Object.fromEntries(
        [...REMOVED.map(([, code]) => code), BEFORE_LINE_COMMENT].map((code) => [
          code,
          caseOf(code),
        ]),
      ),
    { imports: { removeUnused: true } },
  )

  it.each(REMOVED)('removes %s', (_name, code, expected) => {
    const { output, again, errors, rules } = fixed(code)
    expect(output).toBe(expected)
    expect(loadsModule(output)).toBe(expected.includes("'./a.ts'"))
    expect(rules).not.toContain('@typescript-eslint/no-unused-vars')
    expect(errors).toEqual([])
    expect(again).toBe(output)
  })

  it('leaves an unused default import before a line comment', () => {
    const { output, rules } = fixed(BEFORE_LINE_COMMENT)
    expect(output).toBe(BEFORE_LINE_COMMENT)
    expect(rules).toContain('@typescript-eslint/no-unused-vars')
  })

  const UNUSED = "import { a, b } from './a.ts'\n\nexport const x = a\n"
  // With the default options, so it joins the other batches with them
  const fixedWithoutOption = fixTypedProjectsOnce(() => ({ unused: caseOf(UNUSED) }))

  it('only reports in an editor, and without the option', async () => {
    const [inEditor] = await fixTypedProjects([caseOf(UNUSED)], {
      imports: { removeUnused: true },
      isInEditor: true,
    })
    for (const result of [inEditor, fixedWithoutOption('unused')]) {
      expect(result?.output).toBe(UNUSED)
      expect(result?.rules).toContain('@typescript-eslint/no-unused-vars')
    }
  })
})

describe('interfaces that merge declarations', () => {
  const PACKAGE = {
    'node_modules/x/package.json': JSON.stringify({ name: 'x', types: 'index.d.ts' }),
    'node_modules/x/index.d.ts':
      'export interface Register {\n  a: number\n}\nexport declare const registry: Register\n',
  }
  const AUGMENTATION =
    "declare module 'x' {\n  interface Register {\n    b: string\n  }\n}\n\ndeclare module 'x' {\n  interface Register {\n    c: boolean\n  }\n}\n"
  const USE =
    "import { registry, type Register } from 'x'\n\nexport const all: Register = { ...registry, b: '', c: true }\n"
  const UNFIXED = [
    [
      'merges with another declaration',
      'export interface A {\n  a: number\n}\nexport interface A {\n  b: number\n}\n',
    ],
    [
      'is in a merged namespace',
      "export namespace A { export interface X { a: string } }\nexport namespace A { export interface X { b: number } }\nexport const x: A.X = { a: 'a', b: 1 }\n",
    ],
    [
      'mentions itself',
      "interface Json extends Record<string, Json | string> {\n  x: string\n}\n\nexport const json: Json = { x: 'a' }\n",
    ],
    // A type alias can't use the polymorphic `this` type: TS2526
    [
      'uses `this`',
      'interface Chain {\n  next(): this\n}\n\nexport const chain: Chain = {\n  next() {\n    return this\n  },\n}\n',
    ],
  ] as const
  const index = (code: string, files: Record<string, string> = {}): TypedCase => ({
    files: { ...files, 'src/index.ts': code },
    file: 'src/index.ts',
  })
  const fixed = fixTypedProjectsOnce(() => ({
    augmentations: index(
      `${USE}\n${AUGMENTATION}\ninterface Local {\n  d: number\n}\n\nexport const local: Local = { d: 1 }\n`,
      PACKAGE,
    ),
    intersection: index(
      "import type { B } from './b.ts'\n\ntype C = { c: string }\n\ninterface A<T> extends B<T>, C {}\n\nexport const a: A<number> = { b: 1, c: '' }\n",
      { 'src/b.ts': 'export type B<T> = { b: T }\n' },
    ),
    ...Object.fromEntries(UNFIXED.map(([, code]) => [code, index(code)])),
  }))

  it.each(UNFIXED)('report an interface that %s without a fix', (_name, code) => {
    const { output, again, errors, rules } = fixed(code)
    expect(output).toBe(code)
    expect(errors).toEqual([])
    expect(rules).toContain('@typescript-eslint/consistent-type-definitions')
    expect(again).toBe(output)
  })

  it('keep the module augmentations of a `.ts` file, and report an interface outside them', () => {
    const { output, errors, rules } = fixed('augmentations')
    expect(output).toBe(
      `${USE}\n${AUGMENTATION}\ninterface Local {\n  d: number\n}\n\nexport const local: Local = { d: 1 }\n`,
    )
    expect(errors).toEqual([])
    expect(rules).toEqual(['@typescript-eslint/consistent-type-definitions'])
  })

  it('report a file-local interface without fixing it', () => {
    const { output, errors, rules } = fixed('intersection')
    expect(output).toBe(
      "import type { B } from './b.ts'\n\ntype C = { c: string }\n\ninterface A<T> extends B<T>, C {}\n\nexport const a: A<number> = { b: 1, c: '' }\n",
    )
    expect(errors).toEqual([])
    expect(rules).toEqual(['@typescript-eslint/consistent-type-definitions'])
  })

  it.each([
    ['a script code block', 'README.md/0.ts', 'interface Window {\n  a: number\n}\n', false],
    [
      '`declare global`',
      'src/a.ts',
      'declare global {\n  interface Window {\n    a: number\n  }\n}\n\nexport {}\n',
      false,
    ],
    [
      'a script file without type information',
      'src/global.ts',
      'interface Window {\n  a: number\n}\n',
      true,
    ],
    [
      'a module',
      'src/b.ts',
      'interface Local {\n  a: number\n}\n\nexport const local: Local = { a: 1 }\n',
      true,
    ],
  ])('report an interface in %s', (_name, filename, code, isReported) => {
    const plugins = { '@typescript-eslint': tseslint.plugin }
    const messages = new Linter({ configType: 'flat' }).verify(
      code,
      [
        {
          files: ['**/*.ts'],
          languageOptions: { parser: tseslint.parser },
          plugins,
          rules: { '@typescript-eslint/consistent-type-definitions': ['error', 'type'] },
        },
        ...patchUnsafeFixes([{ plugins }], process.cwd()),
      ],
      { filename: path.resolve(filename) },
    )
    expect(messages.map(ruleIdOf)).toEqual(
      isReported ? ['@typescript-eslint/consistent-type-definitions'] : [],
    )
  })
})

describe('iterator rules', () => {
  it('ask for iterator helpers in Node code, not in browser code', async () => {
    const eslint = await sharedESLint('browser', { browser: { files: ['src/client/**'] } })
    const code = 'export const first = (map) => [...map.keys()].find((key) => key > 1)\n'
    expect(await lintText(eslint, 'src/client/first.js', code)).toEqual([])
    expect(
      (await lintText(eslint, 'src/server/first.js', code)).map(
        (message) => message.split(':', 1)[0],
      ),
    ).toContain('unicorn/prefer-iterator-helpers')
  })

  it.each([
    ['react', { react: { scope: ['src/**/*.tsx'] } }, 'src/a.tsx'],
    ['astro', { astro: true }, 'src/a.astro'],
  ])('leave out iterator helpers with %s: %s', async (_name, options, file) => {
    const rules = [
      'unicorn/prefer-iterator-helpers',
      'unicorn/prefer-iterator-to-array',
      'unicorn/prefer-iterator-to-array-at-end',
      // `Array.fromAsync()` isn't in the ES2024 `lib` either
      'unicorn/prefer-array-from-async',
    ]
    const eslint = await createFocusedESLint(FIXTURES_DIR, new Set(rules), options)
    for (const rule of rules) {
      expect(await ruleSeverity(eslint, file, rule), rule).toBe(0)
    }
    expect(await ruleSeverity(eslint, 'src/a.ts', 'unicorn/prefer-iterator-to-array')).toBe(2)
    expect(await ruleSeverity(eslint, 'src/a.ts', 'unicorn/prefer-array-from-async')).toBe(2)
  })
})

describe('node.typeStripping', () => {
  it.each([
    [
      { typeStripping: true },
      ['1:@gpahal/no-js-specifier-for-ts', '3:@gpahal/no-unstrippable-syntax'],
    ],
    [true, []],
  ] as const)(
    "reports a `.js` specifier and syntax Node can't strip in `.ts` files only, with `node: %j`",
    async (node, expected) => {
      const code = "import { b } from './b.js'\n\nexport enum E { A = b }\n"
      await using project = await withProject({
        'package.json': JSON.stringify({ name: 'app', private: true, type: 'module' }),
        'src/a.ts': code,
        'src/b.ts': 'export const b = 1\n',
        // Node's type stripping doesn't run `.tsx` files, nor load declaration files
        'src/c.tsx': code,
        'src/d.d.ts': "import { b } from './b.js'\n\nexport declare const d: typeof b\n",
      })
      const eslint = await createFocusedESLint(
        project.dir,
        (ruleId) => ruleId.startsWith('@gpahal/no-'),
        { node, typeAware: false, gitignore: false },
      )
      const messages = await lint(eslint, ['src/a.ts', 'src/c.tsx', 'src/d.d.ts'], lineAndRuleOf)
      expect(
        Object.fromEntries(
          Object.entries(messages).map(([file, list]) => [
            file,
            list.filter((message) => message.includes(':@gpahal/no-')),
          ]),
        ),
      ).toEqual({ 'src/a.ts': expected, 'src/c.tsx': [], 'src/d.d.ts': [] })
    },
  )
})

describe('files.config', () => {
  it.each([
    ['vitest.config.e2e.ts', 0],
    ['packages/a/playwright.config.ci.cts', 0],
    ['x.config.d.ts', 2],
    ['x.config.test.ts', 2],
  ])(
    'matches config files with an infix, not declaration or test files: %s',
    async (file, severity) => {
      const eslint = await sharedESLint('cjs')
      expect(await ruleSeverity(eslint, file, 'import-x/no-anonymous-default-export')).toBe(
        severity,
      )
    },
  )
})

describe('unicorn rules that type-aware rules overlap', () => {
  const code = [
    'export function hasValue(values: Array<number>, value: number): boolean {',
    '  return values.indexOf(value) !== -1',
    '}',
    '',
    'export function firstLarge(values: Array<number>): number | undefined {',
    '  return values.filter((value) => value > 1)[0]',
    '}',
    '',
  ].join('\n')

  it('report in TypeScript files linted without type information', async () => {
    const eslint = await createESLint('rules', { typeAware: false })
    expect(await lintText(eslint, 'src/untyped.ts', code)).toEqual([
      expect.stringMatching(/^unicorn\/prefer-includes: /),
      expect.stringMatching(/^unicorn\/prefer-array-find: /),
    ])
  })
})

type RuleOnAfterPresets = 'a later config' | 'native defineConfig' | 'an inline comment'

/**
 * `--fix`'s output for `code` with `on` turned on after the presets through `by`. The inline comment
 * goes after the code, as `import-x/no-duplicates` doesn't fix an import that a comment touches
 */
async function fixAfterPresets(
  by: RuleOnAfterPresets,
  options: ConfigOptions,
  on: { rules: Linter.RulesRecord; comment: string },
  file: string,
  code: string,
): Promise<{ output: string; rules: Array<string | null> }> {
  const root = path.join(FIXTURES_DIR, 'rules')
  let eslint: ESLint
  let text = code
  switch (by) {
    case 'a later config': {
      eslint = await createESLint(
        'rules',
        { ...options, extraConfigs: [{ rules: on.rules }] },
        {
          fix: true,
        },
      )
      break
    }
    case 'native defineConfig': {
      const configs = eslintDefineConfig(
        ...(await defineConfig({ root, isInEditor: false, ...options })),
        { rules: on.rules },
      )
      eslint = eslintWith(root, configs, { fix: true })
      break
    }
    case 'an inline comment': {
      eslint = await createESLint('rules', options, { fix: true })
      text = `${code}${on.comment}\n`
      break
    }
  }
  const [result] = await eslint.lintText(text, { filePath: file })
  return {
    output: result?.output ?? text,
    rules: result?.messages.map((message) => message.ruleId ?? message.message) ?? [],
  }
}

describe('rules turned on after the presets', () => {
  const BY: Array<RuleOnAfterPresets> = [
    'a later config',
    'native defineConfig',
    'an inline comment',
  ]

  it.each(BY)(
    "keep `import-x/no-duplicates`' merge from racing the type-import fix through %s",
    async (by) => {
      const { output, rules } = await fixAfterPresets(
        by,
        { imports: { rules: { 'import-x/no-duplicates': 'off' } } },
        {
          rules: { 'import-x/no-duplicates': 'error' },
          comment:
            '/* eslint import-x/no-duplicates: ["error", { "prefer-inline": true }] -- on here */',
        },
        'src/array-from-map.ts',
        "import { type A } from 'a'\nimport type { B } from 'a'\n\nexport type C = A | B\n",
      )
      expect(output).not.toContain('type B')
      expect(rules).not.toContain(null)
    },
  )
})

describe('type-aware rules turned on through an area', () => {
  it('uses only Vitest unbound-method and allows assertions and dev dependencies in custom Vitest files', async () => {
    await using project = await withProject({
      'package.json': JSON.stringify({ type: 'module', devDependencies: { vitest: '*' } }),
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, module: 'preserve', noEmit: true, types: [] },
        include: ['e2e'],
      }),
      'e2e/a.ts': 'class A { run() { return this } }\nexport const run = new A().run\n',
      'e2e/b.ts': "import 'vitest'\nexport const x = ['x'][0]!\n",
      'node_modules/vitest/package.json': JSON.stringify({
        name: 'vitest',
        type: 'module',
        main: 'index.js',
      }),
      'node_modules/vitest/index.js': 'export {}\n',
    })
    const eslint = await createFocusedESLint(
      project.dir,
      new Set([
        'vitest/unbound-method',
        '@typescript-eslint/unbound-method',
        'import-x/no-extraneous-dependencies',
        '@typescript-eslint/no-non-null-assertion',
      ]),
      { vitest: { files: ['e2e/**/*.ts'] } },
    )
    const messages = await lint(eslint, ['e2e/a.ts', 'e2e/b.ts'], ruleIdOf)
    expect(messages['e2e/a.ts']?.filter((rule) => rule.endsWith('/unbound-method'))).toEqual([
      'vitest/unbound-method',
    ])
    expect(messages['e2e/b.ts']).not.toContain('import-x/no-extraneous-dependencies')
    expect(messages['e2e/b.ts']).not.toContain('@typescript-eslint/no-non-null-assertion')
  })
})

describe('e18e options', () => {
  // The rules each option turns on that no other rule duplicates
  const RULES: Record<string, Array<string>> = {
    modernization: ['e18e/prefer-object-has-own'],
    moduleReplacements: ['e18e/ban-dependencies'],
    performanceImprovements: [
      'e18e/prefer-timer-args',
      'e18e/prefer-static-collator',
      'e18e/prefer-throw-if-no-entry',
    ],
  }

  it.each(Object.keys(RULES))('e18e.%s: false turns only its rules off', async (option) => {
    // `moduleReplacements` is off by default
    const eslint = await createFocusedESLint('typescript', new Set(Object.values(RULES).flat()), {
      e18e: { moduleReplacements: true, [option]: false },
    })
    for (const [name, rules] of Object.entries(RULES)) {
      for (const rule of rules) {
        expect((await ruleSeverity(eslint, 'src/index.ts', rule)) ?? 0, rule).toBe(
          name === option ? 0 : 2,
        )
      }
    }
  })
})

/**
 * Links the `globals` package into the `node_modules` of `dir`, since
 * `import-x/no-extraneous-dependencies` skips a package that doesn't resolve
 */
async function linkGlobals(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'node_modules'))
  await fs.symlink(
    path.join(import.meta.dirname, '../node_modules/globals'),
    path.join(dir, 'node_modules/globals'),
  )
}

describe('dev dependencies and file names', () => {
  const files = [
    'src/index.ts',
    'src/fooBar.ts',
    'test/index.ts',
    'vitest.setup.ts',
    'scripts/x.ts',
    'src/cli.ts',
    'vite.config.ts',
    'src/app/app.config.ts',
    'src/web/vite.config.ts',
    'packages/b/src/app.config.ts',
    'e2e/fixtures.ts',
    '.storybook/preview.tsx',
  ]
  it("allow dev dependencies in test files, scripts and config files outside a package's `src`, but not command-line tools", async () => {
    const code = "import globals from 'globals'\n\nexport const names = Object.keys(globals)\n"
    await using project = await withProject({
      'package.json':
        '{ "name": "dev-deps", "private": true, "type": "module", "devDependencies": { "globals": "*" } }\n',
      ...Object.fromEntries(files.map((file) => [file, code])),
      // Packages of their own, one nested in the root package's `src`
      'src/web/package.json':
        '{ "name": "web", "private": true, "type": "module", "devDependencies": { "globals": "*" } }\n',
      'packages/b/package.json':
        '{ "name": "b", "private": true, "type": "module", "devDependencies": { "globals": "*" } }\n',
    })
    await linkGlobals(project.dir)
    const eslint = await createFocusedESLint(
      project.dir,
      new Set(['unicorn/filename-case', 'import-x/no-extraneous-dependencies']),
      { typeAware: false },
    )
    expect(await lint(eslint, files, ruleIdOf)).toEqual({
      'src/index.ts': ['import-x/no-extraneous-dependencies'],
      'src/fooBar.ts': ['unicorn/filename-case', 'import-x/no-extraneous-dependencies'],
      'test/index.ts': [],
      'vitest.setup.ts': [],
      'scripts/x.ts': [],
      'src/cli.ts': ['import-x/no-extraneous-dependencies'],
      'vite.config.ts': [],
      // A config module that the app runs
      'src/app/app.config.ts': ['import-x/no-extraneous-dependencies'],
      'src/web/vite.config.ts': [],
      'packages/b/src/app.config.ts': ['import-x/no-extraneous-dependencies'],
      'e2e/fixtures.ts': [],
      '.storybook/preview.tsx': [],
    })
  })
})

async function withE2eProject() {
  const project = await withProject({
    'package.json':
      '{ "name": "dev-deps", "private": true, "type": "module", "devDependencies": { "globals": "*" } }\n',
    'e2e/app.ts': "import globals from 'globals'\n\nexport const names = Object.keys(globals)\n",
    'eslint.config.mjs': `import { defineConfig } from ${JSON.stringify(new URL('../build/index.js', import.meta.url).href)}\n\nexport default defineConfig({ root: import.meta.dirname, typeAware: false, isInEditor: false, testFiles: (defaults) => [...defaults, 'e2e/**/*.ts'] })\n`,
  })
  await linkGlobals(project.dir)
  return project
}

describe('testFiles and dev dependencies', () => {
  it('allows dev dependencies in testFiles relative to the config file, with ESLint run from a subfolder', async () => {
    await using project = await withE2eProject()
    const eslint = new ESLint({ cwd: path.join(project.dir, 'e2e') })
    const [result] = await eslint.lintFiles(['app.ts'])
    expect(result?.messages.map(ruleIdOf)).toEqual([])
  })
})

async function browserImportReports(root: string) {
  const file = 'src/client/app.js'
  const eslint = await createFocusedESLint(root, (ruleId) => ruleId.startsWith('@gpahal/'), {
    browser: { files: ['src/client/**'] },
    gitignore: false,
    typeAware: false,
  })
  return (await lint(eslint, [file], lineAndRuleOf))[file]
}

describe('browser option', () => {
  it('reports Node globals and built-in modules in browser files only', async () => {
    const eslint = await sharedESLint('browser', { browser: { files: ['src/client/**'] } })
    const messages = await lint(eslint, ['src/client', 'src/server/app.ts'], lineAndRuleOf)
    const browserMessages = ['1:@gpahal/no-node-imports', '2:@gpahal/no-node-imports']
    expect(messages).toEqual({
      // Not `no-undef` too, since Node's globals stay defined. `process.env` and
      // `globalThis.process` are allowed
      'src/client/app.js': browserMessages,
      'src/client/app.ts': browserMessages,
      // Literal `import()`s of built-in modules, with or without `node:`, but not of others
      'src/client/dynamic.ts': [
        '2:@gpahal/no-node-dynamic-imports',
        '7:@gpahal/no-node-dynamic-imports',
        '12:@gpahal/no-node-dynamic-imports',
      ],
      'src/server/app.ts': [
        '2:unicorn/prefer-node-protocol',
        '5:unicorn/no-unnecessary-global-this',
      ],
    })
  })

  it("allows `process.env`, which bundlers replace, but reports `process`'s other uses", async () => {
    const eslint = await sharedESLint('browser', { browser: { files: ['src/client/**'] } })
    const code = [
      'export const mode = process.env.NODE_ENV',
      "export const url = process.env['NEXT_PUBLIC_URL']",
      'export const { env } = process',
      'export const dir = process.cwd()',
      'export const { argv } = process',
      // A parameter or variable named `process` isn't the global
      'export const start = (process) => process.start()',
      'export function run({ process }) { const { argv } = process; return argv }',
      'export const p = process',
      'export const q = String(process)',
      'export const r = process?.argv',
      // For code that checks whether it runs in Node
      "export const isNode = typeof process !== 'undefined'",
      'export const node = globalThis.process',
      'export const debug = process?.env.DEBUG',
      'export const { env: environment } = globalThis.process',
      'export const { argv: args } = globalThis.process',
      '',
    ].join('\n')
    expect(
      (await eslint.lintText(code, { filePath: 'src/client/env.js' }))
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId?.startsWith('@gpahal/') !== false)
        .map(lineAndRuleOf),
    ).toEqual([
      '3:@gpahal/no-node-globals',
      '4:@gpahal/no-node-globals',
      '5:@gpahal/no-node-globals',
      '8:@gpahal/no-node-globals',
      '9:@gpahal/no-node-globals',
      '10:@gpahal/no-node-globals',
      '15:@gpahal/no-node-global-properties',
    ])
  })

  it('reports a built-in that `package.json` declares a browser port of', async () => {
    await using project = await withProject({
      'package.json': JSON.stringify({
        name: 'app',
        type: 'module',
        dependencies: { buffer: '*' },
      }),
      'node_modules/buffer/package.json': '{ "name": "buffer", "main": "index.js" }',
      'src/client/app.js': "import { Buffer } from 'buffer'\n\nexport const a = Buffer\n",
    })
    expect(await browserImportReports(project.dir)).toEqual(['1:@gpahal/no-node-imports'])
  })

  it('reports a dynamic import of a built-in written as an expression of literals', async () => {
    await using project = await withProject({
      'package.json': JSON.stringify({ name: 'app', type: 'module' }),
      'src/client/app.js': "export const load = () => import('f' + 's')\n",
    })
    expect(await browserImportReports(project.dir)).toEqual(['1:@gpahal/no-node-dynamic-imports'])
  })

  it('keeps its rules when your configs set the core no-restricted-* rules', async () => {
    const eslint = await createFocusedESLint(
      'browser',
      (ruleId) => ruleId.startsWith('@gpahal/') || ruleId.startsWith('no-restricted-'),
      {
        browser: { files: ['src/client/**'] },
        configs: [
          {
            rules: {
              'no-restricted-imports': ['error', 'lodash'],
              'no-restricted-syntax': ['error', 'WithStatement'],
            },
          },
        ],
      },
    )
    const code =
      "import fs from 'node:fs'\nimport lodash from 'lodash'\n\nexport const a = [fs, lodash]\n"
    const messages = await lintText(eslint, 'src/client/imports.js', code)
    expect(
      messages.filter(
        (message) => message.includes('restricted') || message.startsWith('@gpahal/'),
      ),
    ).toEqual([
      expect.stringMatching(/^@gpahal\/no-node-imports: 'node:fs' is a Node built-in module/),
      expect.stringMatching(/^no-restricted-imports: 'lodash' import is restricted/),
    ])
  })
})

function globalsOf(config: Linter.Config): Linter.Globals {
  return (config.languageOptions?.['globals'] ?? {}) as Linter.Globals
}

describe('server option', () => {
  const windowCode = 'export const href = window.location.href\n'
  const serverMessage: unknown = expect.stringMatching(
    /^@gpahal\/no-browser-globals: Unexpected use of 'window'\. Server code runs without browser globals/,
  )

  it('reports browser globals and their globalThis properties once each', async () => {
    const eslint = await createFocusedESLint(
      'browser',
      (ruleId) => ruleId.startsWith('@gpahal/no-browser') || ruleId === 'no-undef',
      { react: true, server: { files: ['src/server/**'] } },
    )
    const messages = await lint(eslint, ['src/server/dom.ts', 'src/shared/dom.ts'], lineAndRuleOf)
    const guardMessages = Object.fromEntries(
      Object.entries(messages).map(([file, fileMessages]) => [
        file,
        fileMessages.filter((message) => message.includes(':@gpahal/no-browser')),
      ]),
    )
    expect(guardMessages).toEqual({
      'src/server/dom.ts': [
        '1:@gpahal/no-browser-globals',
        '2:@gpahal/no-browser-global-properties',
        '3:@gpahal/no-browser-globals',
        '4:@gpahal/no-browser-global-properties',
      ],
      'src/shared/dom.ts': [],
    })
    // Nothing else reports them a second time
    expect(messages['src/server/dom.ts']).not.toContainEqual(expect.stringMatching(/:no-undef$/))
  })

  it("reports a browser global once without a preset that defines browser globals, as `no-undef` doesn't too", async () => {
    const eslint = await sharedESLint('browser', {
      server: { files: ['src/server/**'] },
      typeAware: false,
    })
    expect(
      await lintText(eslint, 'src/server/title.js', 'export const title = document.title\n'),
    ).toEqual([expect.stringMatching(/^@gpahal\/no-browser-globals: Unexpected use of 'document'/)])
  })

  it('reports `window` once, leaving `global` to `unicorn/prefer-global-this`', async () => {
    const eslint = await sharedESLint('browser', {
      server: { files: ['src/server/**'] },
      typeAware: false,
    })
    const code = 'export const href = window.location.href\nexport const g = global.process\n'
    expect(await lintText(eslint, 'src/server/env.js', code)).toEqual([
      expect.stringMatching(/^@gpahal\/no-browser-globals: Unexpected use of 'window'/),
      'unicorn/prefer-global-this: Prefer `globalThis` over `global`.',
    ])
  })

  it('allows `typeof` checks of browser globals, but not their other uses', async () => {
    const eslint = await createFocusedESLint('browser', (ruleId) => ruleId.startsWith('@gpahal/'), {
      react: true,
      server: { files: ['src/server/**'] },
      typeAware: false,
    })
    const code = [
      "export const isBrowser = typeof window !== 'undefined'",
      "export const hasWindow = typeof globalThis.window !== 'undefined'",
      // `typeof` of a property reads the global first
      "export const hasLocation = typeof window.location !== 'undefined'",
      'export const doc = document',
      'export const win = globalThis.window',
      '',
    ].join('\n')
    expect(
      (await eslint.lintText(code, { filePath: 'src/server/guard.ts' }))
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId?.startsWith('@gpahal/') !== false)
        .map(lineAndRuleOf),
    ).toEqual([
      '3:@gpahal/no-browser-globals',
      '4:@gpahal/no-browser-globals',
      '5:@gpahal/no-browser-global-properties',
    ])
  })

  it.each([
    ['react', { react: true }],
    ['nextjs', { nextjs: true }],
  ])('wins over browser for the files both match, with %s', async (_name, options) => {
    const eslint = await createFocusedESLint(
      'browser',
      new Set([
        '@gpahal/no-node-imports',
        '@gpahal/no-browser-globals',
        '@gpahal/no-browser-global-properties',
        'unicorn/prefer-global-this',
        'no-undef',
      ]),
      { ...options, browser: { files: ['src/**'] }, server: { files: ['src/server/**'] } },
    )
    expect(await ruleSeverity(eslint, 'src/client/app.ts', '@gpahal/no-node-imports')).toBe(2)
    expect(
      await ruleSeverity(eslint, 'src/server/app.ts', '@gpahal/no-node-imports'),
    ).toBeUndefined()
    expect(await lintText(eslint, 'src/server/route.js', windowCode)).toEqual([serverMessage])
    expect(await lintText(eslint, 'src/client/page.js', windowCode)).toEqual([
      expect.stringMatching(/^unicorn\/prefer-global-this: /),
    ])
    const config = (await eslint.calculateConfigForFile('src/server/app.ts')) as Linter.Config
    expect(globalsOf(config)['process']).toBeDefined()
  })
})

describe('antislop preset', () => {
  const EM_DASH = new Set(['slop/no-em-dash'])

  it('reports em dashes in code, strings too, and Markdown, and once in a code block', async () => {
    const eslint = await createFocusedESLint('markdown', EM_DASH, {
      markdown: true,
      antislop: true,
      typeAware: false,
    })
    expect(await lintText(eslint, 'src/a.ts', "export const a = 'x \u{2014} y'\n")).toEqual([
      expect.stringMatching(/^slop\/no-em-dash: /),
    ])
    // Data files hold text that is quoted rather than written
    expect(await lintText(eslint, 'data.json', '{ "a": "x \u{2014} y" }\n')).toEqual([])
    expect(await lintText(eslint, 'data.yaml', 'a: x \u{2014} y\n')).toEqual([])
    const markdown = "# Title\n\nA \u{2014} b\n\n```ts\nexport const a = 'x \u{2014} y'\n```\n"
    expect(await lintText(eslint, 'docs.md', markdown)).toEqual([
      expect.stringMatching(/^slop\/no-em-dash: /),
      expect.stringMatching(/^slop\/no-em-dash: /),
    ])
  })

  it('reports an em dash at its column in each language, so a disable comment on its line applies', async () => {
    const eslint = await createFocusedESLint('markdown', EM_DASH, {
      markdown: true,
      // `antislop.rules` turns it on in JSON and YAML files too
      antislop: { rules: { 'slop/no-em-dash': 'error' } },
      typeAware: false,
    })
    const columnsOf = async (filePath: string, code: string) =>
      (await eslint.lintText(code, { filePath })).flatMap((result) =>
        result.messages.map(
          (message) => `${message.ruleId ?? ''} ${message.line}:${message.column}`,
        ),
      )
    // The sentence starts at the first column in each
    expect(await columnsOf('src/a.ts', 'export const a = 1\n// x \u{2014} y\n')).toEqual([
      'slop/no-em-dash 2:1',
    ])
    expect(await columnsOf('data.json', '{\n"a": "x \u{2014} y" }\n')).toEqual([
      'slop/no-em-dash 2:1',
    ])
    expect(await columnsOf('docs.md', '# Title\n\nA \u{2014} b\n')).toEqual(['slop/no-em-dash 3:1'])
    const disabled = [
      '# Title',
      '',
      '<!-- eslint-disable-next-line slop/no-em-dash -- quoting -->',
      'A \u{2014} b',
      '',
      'C \u{2014} d <!-- eslint-disable-line slop/no-em-dash -- quoting -->',
      '',
    ].join('\n')
    expect(await columnsOf('docs.md', disabled)).toEqual([])
  })

  it.each<[string, unknown, unknown, boolean]>([
    ['settings without `cwd`, which the plugin ignores', { inspection: 'uncommitted' }, {}, false],
    ['settings with `cwd`', { cwd: '/tmp', inspection: 'uncommitted' }, {}, true],
    ['rule options without `cwd`', undefined, { inspection: 'uncommitted' }, true],
  ])(
    'runs the stock `no-em-dash` only for inspection of changed lines, with %s',
    (_, settings, options, isStock) => {
      const stock = eslintPluginSlop.rules?.['no-em-dash']
      const create = vi.fn<Rule.RuleModule['create']>(() => ({}))
      const plugin = wrapSlopPlugin({ rules: { 'no-em-dash': { ...stock, create } } })
      const messages = new Linter({ configType: 'flat' }).verify('// a \u{2014} b\n', [
        {
          plugins: { slop: plugin },
          settings: { slop: settings },
          rules: { 'slop/no-em-dash': ['error', options] },
        },
      ])
      expect(create).toHaveBeenCalledTimes(isStock ? 1 : 0)
      expect(messages.length).toBe(isStock ? 0 : 1)
    },
  )

  it('reports cognitive complexity over antislop.cognitiveComplexity', async () => {
    const code =
      'export function sum(values: Array<number>): number {\n  let total = 0\n  for (const value of values) {\n    if (value > 0) {\n      total += value\n    }\n  }\n  return total\n}\n'
    const complexity = new Set(['sonarjs/cognitive-complexity'])
    const low = await createFocusedESLint('rules', complexity, {
      typeAware: false,
      antislop: { cognitiveComplexity: 2 },
    })
    expect(await lintText(low, 'src/complex.ts', code)).toEqual([
      expect.stringMatching(/^sonarjs\/cognitive-complexity: /),
    ])
    const off = await createFocusedESLint('rules', complexity, {
      typeAware: false,
      antislop: { cognitiveComplexity: false },
    })
    expect(await lintText(off, 'src/complex.ts', code)).toEqual([])
  })
})

describe('@typescript-eslint/no-floating-promises', () => {
  const NAVIGATE_TYPES =
    'export interface NavigateFunction {\n  (to: string): void | Promise<void>\n  (delta: number): void | Promise<void>\n}\nexport declare function useNavigate(): NavigateFunction\n'
  const SOURCES = {
    'src/a.test.ts':
      "import { describe, it, test } from 'node:test'\n\ntest('x', () => {})\ndescribe('d', () => {\n  it('y', () => {})\n})\n",
    'src/nav.ts':
      "import { useNavigate } from 'react-router'\n\nasync function save(): Promise<void> {\n  await Promise.resolve()\n}\n\nexport function go(): void {\n  const navigate = useNavigate()\n  navigate('/a')\n  save()\n}\n",
  }

  it("passes `node:test`'s tests and React Router's `navigate()`, and still reports other promises", async () => {
    await using project = await withProject({
      'package.json': '{ "name": "a", "private": true, "type": "module" }\n',
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          noEmit: true,
          skipLibCheck: true,
          typeRoots: [path.join(import.meta.dirname, '../../../node_modules/@types')],
          types: ['node'],
        },
        include: ['src'],
      }),
      'node_modules/react-router/package.json':
        '{ "name": "react-router", "version": "7.0.0", "types": "index.d.ts" }\n',
      'node_modules/react-router/index.d.ts': NAVIGATE_TYPES,
      ...SOURCES,
    })
    const rule = '@typescript-eslint/no-floating-promises'
    const eslint = await createFocusedESLint(project.dir, new Set([rule]), { gitignore: false })
    const messages = await lint(eslint, Object.keys(SOURCES), lineAndRuleOf)
    expect(
      Object.fromEntries(
        Object.entries(messages).map(([file, fileMessages]) => [
          file,
          fileMessages.filter((message) => message.endsWith(`:${rule}`)),
        ]),
      ),
    ).toEqual({ 'src/a.test.ts': [], 'src/nav.ts': [`10:${rule}`] })
  })
})

describe('n/no-unsupported-features', () => {
  const isUnsupportedFeaturesRule = (ruleId: string) => ruleId.startsWith('n/no-unsupported')

  it("leaves a global's type alone, but reports its value, before the Node version of `engines`", async () => {
    await using project = await withProject({
      'package.json':
        '{ "name": "a", "private": true, "type": "module", "engines": { "node": ">=20" } }\n',
      'src/fetch.ts':
        'export type Handler = (request: Request) => Promise<Response>\n\nexport async function get(url: string): Promise<Response> {\n  return new Response(url)\n}\n',
    })
    const eslint = await createFocusedESLint(project.dir, isUnsupportedFeaturesRule, {
      node: true,
      typeAware: false,
      gitignore: false,
    })
    const messages = await lint(eslint, ['src/fetch.ts'], lineAndRuleOf)
    expect(
      messages['src/fetch.ts']?.filter((message) => message.includes(':n/no-unsupported')),
    ).toEqual(['4:n/no-unsupported-features/node-builtins'])
  })

  it("checks config files and scripts against the developer's Node, not the package's", async () => {
    const code = 'export const root = import.meta.dirname\n'
    await using project = await withProject({
      'package.json': '{ "name": "a", "private": true, "type": "module" }\n',
      'eslint.config.mjs': code,
      'scripts/build.mjs': code,
      'src/a.mjs': code,
      'src/app.config.mjs': code,
    })
    const eslint = await createFocusedESLint(project.dir, isUnsupportedFeaturesRule, {
      node: true,
      typeAware: false,
      gitignore: false,
    })
    const messages = await lint(eslint, [
      'eslint.config.mjs',
      'scripts/build.mjs',
      'src/a.mjs',
      'src/app.config.mjs',
    ])
    expect(
      Object.fromEntries(
        Object.entries(messages).map(([file, fileMessages]) => [
          file,
          fileMessages.filter((message) => message.startsWith('n/no-unsupported')),
        ]),
      ),
    ).toEqual({
      'eslint.config.mjs': [],
      'scripts/build.mjs': [],
      'src/a.mjs': [expect.stringMatching(/^n\/no-unsupported-features\/node-builtins: /)],
      // A config file in a package's source, such as `src/app/app.config.ts`, often runs in the app
      'src/app.config.mjs': [expect.stringMatching(/^n\/no-unsupported-features\/node-builtins: /)],
    })
  })
})
