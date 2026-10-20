import fs from 'node:fs/promises'
import path from 'node:path'

import eslintPluginE18e from '@e18e/eslint-plugin'
import eslintPluginComments from '@eslint-community/eslint-plugin-eslint-comments'
import { ESLint, Linter, type Rule } from 'eslint'
import eslintPluginSlop from 'eslint-plugin-slop'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import { defineConfig as eslintDefineConfig } from 'eslint/config'
import ts from 'typescript'
import tseslint from 'typescript-eslint'

import { assertBuildIsCurrent } from '@gpahal/internal/node/testing'

import { eslintCommentsPlugin } from '@/eslint-comments'
import { defineConfig, type EslintConfigOptions } from '@/index'
import { patchUnsafeFixes } from '@/internal/fixes'
import { wrapSlopPlugin } from '@/internal/presets/antislop'
import { slopPlugin } from '@/slop'

import {
  BUILD_DIR,
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
    const eslint = await createESLint('typescript')
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

// Idiomatic code from real, non-framework projects, which must lint clean with the defaults
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

  it('scope-analyse .cjs files as CommonJS', async () => {
    const eslint = await createESLint('cjs', { node: true, extraConfigs: [scopeConfig] })
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
    const typescriptESLint = await createESLint('typescript', { extraConfigs: [scopeConfig] })
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
    const eslint = await createESLint(project.dir, {
      typeAware: false,
      gitignore: false,
      commonjs: { files: () => ['scripts/**'] },
    })
    const messages = await lint(eslint, ['scripts/a.js', 'src/a.js'], ruleIdOf)
    expect(messages['scripts/a.js']).toEqual([])
    expect(messages['src/a.js']).toEqual(
      expect.arrayContaining(['no-undef', 'unicorn/prefer-module']),
    )
    // The TypeScript files the globs match stay ES modules
    const config = (await eslint.calculateConfigForFile('scripts/b.ts')) as Linter.Config
    expect(config.languageOptions?.['sourceType']).toBe('module')
  })
  it('throws on a glob that matches no .js file', () => {
    expect(() =>
      defineConfig({ root: FIXTURES_DIR, commonjs: { files: ['src/**/*.ts'] } }),
    ).toThrow(
      '@gpahal/eslint-config: `commonjs.files`: glob `src/**/*.ts` matches no `.js` file. End it in `*` or an extension of one, as in `src/**/*.js`',
    )
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
  it('warns of a framework that no preset supports while its plugin is missing', async () => {
    await using project = await projectWith(['vue', 'svelte'])
    expect(
      warningsOf(project.dir, { typeAware: false, configs: [{ plugins: { vue: {} } }] }),
    ).toEqual([
      [
        expect.stringMatching(
          /^@gpahal\/eslint-config: `root`: `package.json` lists `svelte`, which no preset/,
        ),
        'GPAHAL_UNSUPPORTED_FRAMEWORK',
      ],
    ])
  })
})

describe('jsdoc/check-tag-names', () => {
  // Joined when the test runs, since Vitest reads an environment tag anywhere in a test file's text
  const tags = [
    ['@', 'vitest-environment node'].join(''),
    ['@', 'jest-environment node'].join(''),
    '@jsxImportSource preact',
    '@jsx h',
    '@jsxFrag Fragment',
    '@jsxRuntime classic',
    '@defaultValue 1',
  ]

  it.each([
    ['typescript', 'src/index.mts'],
    ['cjs', 'tags.js'],
  ])('accepts the tags of tools and TSDoc in %s files', async (fixture, file) => {
    const eslint = await sharedESLint(fixture)
    for (const tag of tags) {
      const code = `/**\n * ${tag}\n */\nexport const a = 1\n`
      expect(await lintText(eslint, file, code), tag).toEqual([])
    }
  })

  it('prefers @template to @typeParam', async () => {
    const eslint = await sharedESLint('typescript')
    const code = '/**\n * @typeParam T - The type\n */\nexport type A<T> = T\n'
    expect(await lintText(eslint, 'src/index.mts', code)).toEqual([
      expect.stringMatching(/^jsdoc\/check-tag-names: .*"template"/),
    ])
  })
})

describe('jsdoc/no-multi-asterisks', () => {
  it('accepts a `*` list in a doc block', async () => {
    const eslint = await sharedESLint('typescript')
    const code = '/**\n * Steps:\n *\n * * Parse\n * * Check\n */\nexport const a = 1\n'
    expect(await lintText(eslint, 'src/index.mts', code)).toEqual([])
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
    const kebab = await createESLint(project.dir, options)
    const camel = await createESLint(project.dir, {
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
  it.each([
    [
      'unicorn/no-break-in-nested-loop',
      'export function count(values) {\n  let n = 0\n  for (const value of values) {\n    switch (value) {\n      case 1:\n        n += 1\n        break\n      default:\n        break\n    }\n  }\n  return n\n}\n',
    ],
    [
      'unicorn/no-this-outside-of-class',
      'export const counter = {\n  count: 0,\n  inc() {\n    this.count += 1\n  },\n}\n',
    ],
    [
      'unicorn/prefer-number-coercion',
      'export function px(s) {\n  return Number.parseInt(s, 10)\n}\n',
    ],
    [
      'unicorn/no-computed-property-existence-check',
      'export function has(object, key) {\n  return key in object\n}\n',
    ],
    [
      'unicorn/prefer-ternary',
      'export function text(error) {\n  if (error instanceof Error) {\n    return error.message\n  }\n  return String(error)\n}\n',
    ],
    [
      'jsdoc/require-returns-description',
      '/**\n * Runs\n *\n * @returns {Promise<unknown>}\n */\nexport async function run() {\n  await Promise.resolve()\n}\n',
    ],
    [
      'unicorn/import-style',
      "import { join } from 'node:path'\nimport util, { format } from 'node:util'\n\nexport const a = join(format('%s', 'a'), util.inspect(1))\n",
    ],
    ['unicorn/expiring-todo-comments', '// TODO [2000-01-01]: remove\nexport const a = 1\n'],
    [
      'unicorn/prefer-observer-apis',
      "export function onResize(update) {\n  window.addEventListener('resize', () => update(window.innerWidth))\n}\n",
    ],
  ])('`%s` passes', async (rule, code) => {
    expect(await reportsOf(rule, 'src/a.js', code)).toEqual([])
  })

  it('`unicorn/prefer-ternary` still reports a one-line `if` and `else`', async () => {
    const code =
      'export function sign(n) {\n  let s\n  if (n > 0) {\n    s = 1\n  } else {\n    s = 0\n  }\n  return s\n}\n'
    expect(await reportsOf('unicorn/prefer-ternary', 'src/a.js', code)).toEqual([
      'unicorn/prefer-ternary',
    ])
  })

  it('`unicorn/prefer-event-target` passes `EventEmitter` with `node` only', async () => {
    const code =
      "import { EventEmitter } from 'node:events'\n\nexport class Bus extends EventEmitter {}\n"
    expect(await reportsOf('unicorn/prefer-event-target', 'src/a.js', code)).toEqual([
      'unicorn/prefer-event-target',
    ])
    expect(
      await reportsOf('unicorn/prefer-event-target', 'src/a.js', code, { node: true }),
    ).toEqual([])
  })

  it("`n/hashbang` leaves a script's shebang alone with `node`", async () => {
    const code = "#!/usr/bin/env node\n\nconsole.log('released')\n"
    expect(await reportsOf('n/hashbang', 'scripts/release.js', code, { node: true })).toEqual([])
    expect(await reportsOf('n/hashbang', 'src/a.js', code, { node: true })).toEqual(['n/hashbang'])
  })
})

describe('bug-catching rules', () => {
  it('report unreachable code in TypeScript files', async () => {
    const eslint = await sharedESLint('rules')
    const code = 'export function f(): number {\n  return 1\n  console.error(2)\n}\n'
    expect(await lintText(eslint, 'src/dead-store.ts', code)).toEqual([
      expect.stringMatching(/^no-unreachable: /),
    ])
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
      expect.stringMatching(/^e18e\/prefer-spread-syntax: .*Array\.from/),
    ])
  })

  // Dropped, as e18e's `prefer-spread-syntax` report is, only where unicorn's
  // `prefer-array-from-map` reports
  it.each([
    ['(value, index, all) => value + index + all.length', true],
    ['Math.abs, values', true],
    ['(value) => value * 2, values', false],
    ['Math.abs', true],
  ])('reports `Array.from(values).map(%s)` when %s', async (mapArguments, isReported) => {
    const eslint = await sharedESLint('rules')
    const messages = await lintText(eslint, file, code(`Array.from(values).map(${mapArguments})`))
    for (const rule of ['unicorn/prefer-spread', 'e18e/prefer-spread-syntax']) {
      expect(messages.some((message) => message.startsWith(`${rule}: `))).toBe(isReported)
    }
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
    for (const rule of ['unicorn/prefer-spread', 'e18e/prefer-spread-syntax']) {
      expect(messages.some((message) => message.startsWith(`${rule}: `))).toBe(isReported)
    }
  })
  it('leaves `Array.from(values).map(fn)` to prefer-array-from-map, without contradicting it, and to `--fix` unchanged, as that rule only suggests', async () => {
    const eslint = await createESLint('rules', {}, { fix: true })
    const [result] = await eslint.lintText(code('Array.from(values).map((value) => value * 2)'), {
      filePath: file,
    })
    expect(result?.output).toBeUndefined()
    expect(result?.messages.map((message) => message.ruleId ?? message.message)).toEqual([
      'unicorn/prefer-array-from-map',
    ])
    expect(result?.messages[0]?.suggestions).toHaveLength(1)
  })
})

describe('the patched rules of shared plugins', () => {
  it('report `Array.from(…)` before `.map()` with unicorn/prefer-array-from-map off', async () => {
    const eslint = await createESLint('rules', {
      unicorn: { rules: { 'unicorn/prefer-array-from-map': 'off' } },
    })
    const messages = await lintText(
      eslint,
      'src/array-from-map.ts',
      arrayFunction('Array.from(values).map((value) => value * 2)'),
    )
    expect(messages).toEqual([
      expect.stringMatching(/^unicorn\/prefer-spread: /),
      expect.stringMatching(/^e18e\/prefer-spread-syntax: /),
    ])
  })

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
    expect(
      linter
        .verify(
          '[...m.keys()].map((x) => x)\n',
          config({ 'e18e/prefer-array-from-map': 'error' }),
          'x.js',
        )
        .map((message) => message.ruleId),
    ).toEqual(['e18e/prefer-array-from-map'])
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
  const eslint = await createESLint(
    project.dir,
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

/**
 * Runs `fixTypedProjects` once for the describe block it's called in, and returns results by key
 */
function fixTypedProjectsOnce(
  cases: () => Record<string, TypedCase>,
  configOptions: ConfigOptions = {},
): (key: string) => TypedFix {
  const results = new Map<string, TypedFix>()
  beforeAll(async () => {
    const entries = Object.entries(cases())
    const fixes = await fixTypedProjects(
      entries.map(([, typedCase]) => typedCase),
      configOptions,
    )
    for (const [index, [key]] of entries.entries()) {
      results.set(key, fixes[index]!)
    }
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
    [{ maxDepth: 2 }, ALL],
  ])('reports the files of a cycle with `cycles: %j`', async (cycles, expected) => {
    await using project = await withProject(FILES)
    const eslint = await createESLint(project.dir, {
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

  it('only reports in an editor, and without the option', async () => {
    const code = "import { a, b } from './a.ts'\n\nexport const x = a\n"
    for (const options of [{ imports: { removeUnused: true }, isInEditor: true }, {}]) {
      const [result] = await fixTypedProjects([caseOf(code)], options)
      expect(result?.output).toBe(code)
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

  it('keep the module augmentations of a `.ts` file, and fix an interface outside them', () => {
    const { output, again, errors, rules } = fixed('augmentations')
    expect(output).toBe(
      `${USE}\n${AUGMENTATION}\ntype Local = {\n  d: number\n}\n\nexport const local: Local = { d: 1 }\n`,
    )
    expect(errors).toEqual([])
    expect(rules).not.toContain('@typescript-eslint/consistent-type-definitions')
    expect(again).toBe(output)
  })

  it('fix an empty interface that extends to an intersection', () => {
    const { output, errors, rules } = fixed('intersection')
    expect(output).toBe(
      "import type { B } from './b.ts'\n\ntype C = { c: string }\n\ntype A<T> = B<T> & C\n\nexport const a: A<number> = { b: 1, c: '' }\n",
    )
    expect(errors).toEqual([])
    expect(rules).toEqual([])
  })

  it.each([
    ['src/page.astro', false],
    ['README.md/0.ts', false],
    ['src/global.ts', true],
    ['src/a.d.ts', false],
    ['src/b.d.ts', true],
  ])('treat `%s` as a module whose interfaces other files see: %s', (filename, isVisible) => {
    const patchedFixes = patchUnsafeFixes(
      [{ plugins: { '@typescript-eslint': tseslint.plugin } }],
      process.cwd(),
    )
    const code =
      {
        'src/a.d.ts':
          "import type { B } from './b'\n\ninterface Local {\n  b: B\n}\n\nexport type All = Local\n\nexport {}\n",
        'src/b.d.ts':
          "import type { B } from './b'\n\ninterface Local {\n  b: B\n}\n\nexport type All = Local\n",
        'README.md/0.ts':
          'interface Local {\n  a: number\n}\n\nexport const local: Local = { a: 1 }\n',
      }[filename] ?? 'interface Local {\n  a: number\n}\n\nconst local: Local = { a: 1 }\n'
    const fixed = new Linter({ configType: 'flat' }).verifyAndFix(
      code,
      [
        {
          files: ['**/*.{ts,astro}'],
          languageOptions: { parser: tseslint.parser },
          plugins: { '@typescript-eslint': tseslint.plugin },
          rules: { '@typescript-eslint/consistent-type-definitions': ['error', 'type'] },
        },
        ...patchedFixes,
      ],
      { filename: path.resolve(filename) },
    )
    expect(fixed.output.includes('type Local = {')).toBe(!isVisible)
    expect(fixed.messages.map(ruleIdOf)).toEqual(
      isVisible ? ['@typescript-eslint/consistent-type-definitions'] : [],
    )
  })
})

/**
 * A function of `m`, `s` and `fn` that returns `body`, with the parameters that `body` uses
 */
function spreads(body: string): string {
  const params = ['m', 's', 'fn'].filter((name) =>
    new RegExp(String.raw`\b${name}\b`, 'u').test(body),
  )
  return `export function keys(${params.join(', ')}) {\n  return ${body}\n}\n`
}

describe('iterator rules', () => {
  // `e18e/prefer-array-from-map` asks for `Array.from(m.keys(), fn)`, against `m.keys().toArray()`
  it.each([
    ['[...m.keys()].map(fn)', ['unicorn/prefer-iterator-to-array']],
    ['[...m.keys()]', ['unicorn/prefer-iterator-to-array']],
    ['[...s].map(fn)', ['e18e/prefer-array-from-map']],
  ])('report `%s` with one rule', async (body, rules) => {
    const eslint = await sharedESLint('rules')
    const messages = await lintText(eslint, 'x.js', spreads(body))
    expect(messages.map((message) => message.split(':', 1)[0])).toEqual(rules)
  })
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
    const eslint = await sharedESLint(FIXTURES_DIR, options)
    for (const rule of [
      'unicorn/prefer-iterator-helpers',
      'unicorn/prefer-iterator-to-array',
      'unicorn/prefer-iterator-to-array-at-end',
      // `Array.fromAsync()` isn't in the ES2024 `lib` either
      'unicorn/prefer-array-from-async',
    ]) {
      expect(await ruleSeverity(eslint, file, rule), rule).toBe(0)
    }
    expect(await ruleSeverity(eslint, 'src/a.ts', 'unicorn/prefer-iterator-to-array')).toBe(2)
    expect(await ruleSeverity(eslint, 'src/a.ts', 'unicorn/prefer-array-from-async')).toBe(2)
  })
})

function matchFunction(body: string): string {
  return `export function check(s: string): unknown {\n${body}\n}\n`
}

describe('@typescript-eslint/prefer-regexp-exec', () => {
  const file = 'src/array-from-map.ts'

  const IF_MATCH = '  if (s.match(/a/)) {\n    console.error(s)\n  }\n  return s'

  it.each([
    ['unicorn/prefer-regexp-test', {}, IF_MATCH],
    ['e18e/prefer-regex-test', { unicorn: false }, IF_MATCH],
  ] as const)('leaves a match as a condition to `%s` with %j: %s', async (rule, options, body) => {
    const eslint = await sharedESLint('rules', options)
    expect(await lintText(eslint, file, matchFunction(body))).toEqual([
      expect.stringMatching(new RegExp(`^${rule}: `, 'u')),
    ])
  })

  it.each([{}, { unicorn: false }] as const)(
    'still reports a match whose result is used with %j',
    async (options) => {
      const eslint = await sharedESLint('rules', options)
      expect(await lintText(eslint, file, matchFunction('  return s.match(/a/)'))).toEqual([
        expect.stringMatching(/^@typescript-eslint\/prefer-regexp-exec: /),
      ])
    },
  )

  it('reports a match as a condition with the regexp-test rule off', async () => {
    const eslint = await sharedESLint('rules', {
      unicorn: { rules: { 'unicorn/prefer-regexp-test': 'off' } },
    })
    expect(await lintText(eslint, file, matchFunction(IF_MATCH))).toEqual([
      expect.stringMatching(/^@typescript-eslint\/prefer-regexp-exec: /),
    ])
  })

  it('reports no match as a condition with the regexp-test rule off in a later config', async () => {
    // The patch reads which rules are on from the presets' configs, and can't see a later one
    const eslint = await createESLint('rules', {
      extraConfigs: [{ rules: { 'unicorn/prefer-regexp-test': 'off' } }],
    })
    expect(await lintText(eslint, file, matchFunction(IF_MATCH))).toEqual([])
  })
})

describe('n/hashbang', () => {
  it("keeps the shebang of a TypeScript file built to the package's bin", async () => {
    const code = "#!/usr/bin/env node\n\nconsole.log('done')\n"
    await using project = await withProject({
      'package.json': JSON.stringify({
        name: 'cli-project',
        private: true,
        type: 'module',
        bin: './build/cli.js',
      }),
      'src/cli.ts': code,
      'src/cli.js': code,
    })
    const options = { node: true, typeAware: false } as const
    const eslint = await createESLint(project.dir, options)
    expect(await lint(eslint, ['src/cli.ts'], ruleIdOf)).toEqual({ 'src/cli.ts': [] })
    expect(await lint(eslint, ['src/cli.js'], ruleIdOf)).toEqual({ 'src/cli.js': ['n/hashbang'] })
    const [result] = await (
      await createESLint(project.dir, options, { fix: true })
    ).lintFiles(['src/cli.ts'])
    expect(result?.output).toBeUndefined()
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
      const eslint = await createESLint(project.dir, { node, typeAware: false, gitignore: false })
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

describe('unused variables', () => {
  it.each(['index.js', 'index.cjs'])(
    'report each once and allow a leading underscore: %s',
    async (file) => {
      const eslint = await sharedESLint('cjs')
      const code = 'const a = 1\nconst _b = 2\nconsole.error((c, _d) => 0)\n'
      // The core rule, in the JavaScript-only project, with typescript-eslint's rule's options
      expect(await lintText(eslint, file, code)).toEqual([
        "no-unused-vars: 'a' is assigned a value but never used. Allowed unused vars must match /^_/u.",
        "no-unused-vars: 'c' is defined but never used. Allowed unused args must match /^_/u.",
      ])
    },
  )
})

describe('void returns and rest siblings', () => {
  const TSCONFIG = JSON.stringify({
    compilerOptions: { strict: true, module: 'preserve', noEmit: true, types: [] },
    include: ['src'],
  })
  const code = [
    'export function collect(xs: Array<number>): Set<number> {',
    '  const s = new Set<number>()',
    '  xs.forEach((x) => s.add(x))',
    '  return s',
    '}',
    'export function omitA(o: { a: number; b: number }): { b: number } {',
    '  const { a, ...rest } = o',
    '  return rest',
    '}',
    'export function each(xs: Array<number>, f: (x: number) => void): void {',
    '  for (const x of xs) {',
    '    f(x)',
    '  }',
    '}',
    'each([1], async (x) => {',
    '  await Promise.resolve(x)',
    '})',
    'export function unused(o: { a: number }): void {',
    '  const { a } = o',
    '}',
    '',
  ].join('\n')
  const ruleIds = new Set([
    '@typescript-eslint/strict-void-return',
    '@typescript-eslint/no-misused-promises',
    '@typescript-eslint/no-unused-vars',
  ])

  async function lintCode(options: ConfigOptions): Promise<Array<string>> {
    await using project = await withProject({ 'tsconfig.json': TSCONFIG, 'src/a.ts': code })
    const eslint = await createESLint(project.dir, { gitignore: false, ...options })
    const [result] = await eslint.lintFiles(['src/a.ts'])
    return (result?.messages ?? [])
      .filter((message) => ruleIds.has(message.ruleId ?? ''))
      .map(lineAndRuleOf)
  }

  it('allow a callback whose value is ignored and an omitted rest sibling, but report an async callback and an unused binding', async () => {
    expect(await lintCode({})).toEqual([
      '15:@typescript-eslint/no-misused-promises',
      '19:@typescript-eslint/no-unused-vars',
    ])
  })
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
    const eslint = await createESLint(project.dir, { vitest: { files: ['e2e/**/*.ts'] } })
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
      'e18e/prefer-array-from-map',
      'e18e/prefer-timer-args',
      'e18e/prefer-static-collator',
      'e18e/prefer-throw-if-no-entry',
    ],
  }

  it.each(Object.keys(RULES))('e18e.%s: false turns only its rules off', async (option) => {
    // `moduleReplacements` is off by default
    const eslint = await createESLint('typescript', {
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
    // The rule skips a package that doesn't resolve
    await fs.mkdir(path.join(project.dir, 'node_modules'))
    await fs.symlink(
      path.join(import.meta.dirname, '../node_modules/globals'),
      path.join(project.dir, 'node_modules/globals'),
    )
    const eslint = await createESLint(project.dir, { typeAware: false })
    expect(await lint(eslint, files, ruleIdOf)).toEqual({
      'src/index.ts': ['import-x/no-extraneous-dependencies'],
      'src/fooBar.ts': ['unicorn/filename-case', 'import-x/no-extraneous-dependencies'],
      'test/index.ts': [],
      'vitest.setup.ts': [],
      'scripts/x.ts': [],
      'src/cli.ts': ['import-x/no-extraneous-dependencies'],
      'vite.config.ts': [],
      // A config module that the app runs, as Angular's is
      'src/app/app.config.ts': ['import-x/no-extraneous-dependencies'],
      'src/web/vite.config.ts': [],
      'packages/b/src/app.config.ts': ['import-x/no-extraneous-dependencies'],
      'e2e/fixtures.ts': [],
      '.storybook/preview.tsx': [],
    })
  })
})

describe('dev dependencies in a workspace', () => {
  // The rule reads the `package.json` nearest the file, so each package declares the tools its tests
  // and configs import, as the README says
  it.each([
    ['only the root declares it', {}, ['import-x/no-extraneous-dependencies']],
    ['the package declares it', { devDependencies: { globals: '*' } }, []],
  ])('in a package test when %s', async (_name, manifest, expected) => {
    await using project = await withProject({
      'package.json':
        '{ "name": "root", "private": true, "type": "module", "devDependencies": { "globals": "*" } }\n',
      'packages/a/package.json': `${JSON.stringify({ name: 'a', private: true, type: 'module', ...manifest })}\n`,
      'packages/a/src/a.test.ts':
        "import globals from 'globals'\n\nexport const names = Object.keys(globals)\n",
    })
    await fs.mkdir(path.join(project.dir, 'node_modules'))
    await fs.symlink(
      path.join(import.meta.dirname, '../node_modules/globals'),
      path.join(project.dir, 'node_modules/globals'),
    )
    const eslint = await createESLint(project.dir, { typeAware: false })
    expect(await lint(eslint, ['packages/a/src/a.test.ts'], ruleIdOf)).toEqual({
      'packages/a/src/a.test.ts': expected,
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
  await fs.mkdir(path.join(project.dir, 'node_modules'))
  await fs.symlink(
    path.join(import.meta.dirname, '../node_modules/globals'),
    path.join(project.dir, 'node_modules/globals'),
  )
  return project
}

describe('testFiles and dev dependencies', () => {
  beforeAll(async () => assertBuildIsCurrent(BUILD_DIR))

  it('allows dev dependencies in testFiles relative to the config file, with ESLint run from a subfolder', async () => {
    await using project = await withE2eProject()
    const eslint = new ESLint({ cwd: path.join(project.dir, 'e2e') })
    const [result] = await eslint.lintFiles(['app.ts'])
    expect(result?.messages.map(ruleIdOf)).toEqual([])
  })
})

async function browserImportReports(root: string) {
  const file = 'src/client/app.js'
  const eslint = await createESLint(root, {
    browser: { files: ['src/client/**'] },
    gitignore: false,
    typeAware: false,
  })
  return (await lint(eslint, [file], lineAndRuleOf))[file]?.filter((message) =>
    message.includes('@gpahal/'),
  )
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

  it('reports a bare built-in subpath, such as `path/posix`, unless the declared shim has it', async () => {
    await using project = await withProject({
      'package.json': JSON.stringify({
        name: 'app',
        type: 'module',
        dependencies: { assert: '*', path: '*', 'stream-browserify': '*', util: '*' },
      }),
      'node_modules/assert/package.json': JSON.stringify({
        name: 'assert',
        exports: { '.': './index.js', './strict': './strict.js' },
      }),
      'node_modules/path/package.json': '{ "name": "path", "main": "index.js" }',
      'node_modules/stream-browserify/package.json': JSON.stringify({
        name: 'stream-browserify',
        exports: { '.': './index.js' },
      }),
      'node_modules/util/package.json': '{ "name": "util", "main": "util.js" }',
      'node_modules/util/types.js': '',
      'src/client/app.js': [
        "import path from 'path'",
        "import posix from 'path/posix'",
        "import { pipeline } from 'stream/promises'",
        "import strict from 'assert/strict'",
        "import types from 'util/types'",
        '',
        'export const a = [path, posix, pipeline, strict, types]',
        '',
      ].join('\n'),
    })
    expect(await browserImportReports(project.dir)).toEqual([
      '2:@gpahal/no-node-imports',
      '3:@gpahal/no-node-imports',
    ])
  })

  it('keeps its rules when your configs set the core no-restricted-* rules', async () => {
    const eslint = await createESLint('browser', {
      browser: { files: ['src/client/**'] },
      configs: [
        {
          rules: {
            'no-restricted-imports': ['error', 'lodash'],
            'no-restricted-syntax': ['error', 'WithStatement'],
          },
        },
      ],
    })
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
    const eslint = await createESLint('browser', {
      react: true,
      server: { files: ['src/server/**'] },
    })
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

  it('allows `typeof` checks of browser globals, but not their other uses', async () => {
    const eslint = await sharedESLint('browser', {
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
    const eslint = await createESLint('browser', {
      ...options,
      browser: { files: ['src/**'] },
      server: { files: ['src/server/**'] },
    })
    expect(await ruleSeverity(eslint, 'src/client/app.ts', '@gpahal/no-node-imports')).toBe(2)
    expect(
      await ruleSeverity(eslint, 'src/server/app.ts', '@gpahal/no-node-imports'),
    ).toBeUndefined()
    expect(await lintText(eslint, 'src/server/route.js', windowCode)).toEqual([
      expect.stringMatching(/^unicorn\/prefer-global-this: /),
      serverMessage,
    ])
    expect(await lintText(eslint, 'src/client/page.js', windowCode)).toEqual([
      expect.stringMatching(/^unicorn\/prefer-global-this: /),
    ])
    const config = (await eslint.calculateConfigForFile('src/server/app.ts')) as Linter.Config
    expect(globalsOf(config)['process']).toBeDefined()
  })
})

describe('antislop preset', () => {
  it('reports em dashes in code, strings too, and Markdown, and once in a code block', async () => {
    const eslint = await createESLint('markdown', {
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
    const eslint = await createESLint('markdown', {
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

  it('registers its wrapped slop plugin, the one it exports, in place of the upstream one in a config of yours', async () => {
    const root = path.join(FIXTURES_DIR, 'markdown')
    const configs = await defineConfig({
      root,
      antislop: true,
      typeAware: false,
      configs: [{ plugins: { slop: eslintPluginSlop }, rules: { 'slop/no-em-dash': 'error' } }],
    }).append({ files: ['**/*.md'], plugins: { slop: eslintPluginSlop } })
    const slopPlugins = new Set(configs.flatMap((config) => config.plugins?.['slop'] ?? []))
    expect([...slopPlugins]).toEqual([slopPlugin])
    // The wrapped rule reports at Markdown's own column
    const messages = await eslintWith(root, configs).lintText('# Title\n\nA \u{2014} b\n', {
      filePath: path.join(root, 'docs.md'),
    })
    expect(messages[0]?.messages.map(({ ruleId, column }) => `${ruleId ?? ''}:${column}`)).toEqual([
      'slop/no-em-dash:1',
    ])
  })

  it('registers its wrapped eslint-comments plugin in place of the stock one in a config of yours', async () => {
    const root = path.join(FIXTURES_DIR, 'markdown')
    const configs = await defineConfig({
      root,
      typeAware: false,
      configs: [
        {
          plugins: { '@eslint-community/eslint-comments': eslintPluginComments },
          rules: {
            '@eslint-community/eslint-comments/no-restricted-disable': ['error', 'no-console'],
          },
        },
      ],
    })
    const plugins = new Set(
      configs.flatMap((config) => config.plugins?.['@eslint-community/eslint-comments'] ?? []),
    )
    // The wrapped plugin that the package exports
    expect([...plugins]).toEqual([eslintCommentsPlugin])
    const [result] = await eslintWith(root, configs).lintText(
      '// eslint-disable-next-line no-console -- A demo\nconsole.log(1)\n',
      { filePath: path.join(root, 'x.js') },
    )
    expect(result?.messages.map(ruleIdOf)).toEqual([
      '@eslint-community/eslint-comments/no-restricted-disable',
    ])
  })

  it('reports cognitive complexity over antislop.cognitiveComplexity', async () => {
    const code =
      'export function sum(values: Array<number>): number {\n  let total = 0\n  for (const value of values) {\n    if (value > 0) {\n      total += value\n    }\n  }\n  return total\n}\n'
    const low = await createESLint('rules', {
      typeAware: false,
      antislop: { cognitiveComplexity: 2 },
    })
    expect(await lintText(low, 'src/complex.ts', code)).toEqual([
      expect.stringMatching(/^sonarjs\/cognitive-complexity: /),
    ])
    const off = await createESLint('rules', {
      typeAware: false,
      antislop: { cognitiveComplexity: false },
    })
    expect(await lintText(off, 'src/complex.ts', code)).toEqual([])
  })
})

describe('type-aware rules in tests and components', () => {
  const RULES = [
    '@typescript-eslint/no-unnecessary-condition',
    '@typescript-eslint/no-floating-promises',
    '@typescript-eslint/strict-boolean-expressions',
  ]
  const ASSERTION =
    "import assert from 'node:assert/strict'\n\nexport function check(): void {\n  assert.deepEqual({ a: 1 + 1 }, { a: 2 })\n}\n"
  const NAVIGATE_TYPES =
    'export interface NavigateFunction {\n  (to: string): void | Promise<void>\n  (delta: number): void | Promise<void>\n}\nexport declare function useNavigate(): NavigateFunction\n'
  const SOURCES = {
    'src/sum.test.ts': ASSERTION,
    'src/sum.ts': ASSERTION,
    'src/a.test.ts':
      "import { describe, it, test } from 'node:test'\n\ntest('x', () => {})\ndescribe('d', () => {\n  it('y', () => {})\n})\n",
    'src/nav.ts':
      "import { useNavigate } from 'react-router'\n\nasync function save(): Promise<void> {\n  await Promise.resolve()\n}\n\nexport function go(): void {\n  const navigate = useNavigate()\n  navigate('/a')\n  save()\n}\n",
    'src/status.tsx':
      'export function Status(props: { isLoading?: boolean; count: number; title?: string }): unknown {\n  return [props.isLoading && <p />, props.count && <p />, props.title && <p />]\n}\n',
  }
  // Linted once, with type information and Node's types, as `line:rule`
  let reports: Record<string, Array<string>> = {}
  beforeAll(async () => {
    await using project = await withProject({
      'package.json': '{ "name": "a", "private": true, "type": "module" }\n',
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          jsx: 'preserve',
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
    const eslint = await createESLint(project.dir, { gitignore: false })
    const messages = await lint(eslint, Object.keys(SOURCES), lineAndRuleOf)
    reports = Object.fromEntries(
      Object.entries(messages).map(([file, fileMessages]) => [
        file,
        fileMessages.filter((message) => RULES.some((rule) => message.endsWith(`:${rule}`))),
      ]),
    )
  })

  it('`no-unnecessary-condition` passes typed assertions in tests, and still reports them elsewhere', () => {
    expect(reports['src/sum.test.ts']).toEqual([])
    expect(reports['src/sum.ts']).toEqual(['4:@typescript-eslint/no-unnecessary-condition'])
  })

  it("`no-floating-promises` passes `node:test`'s tests and React Router's `navigate()`, and still reports other promises", () => {
    expect(reports['src/a.test.ts']).toEqual([])
    expect(reports['src/nav.ts']).toEqual(['10:@typescript-eslint/no-floating-promises'])
  })

  it('`strict-boolean-expressions` allows a nullable boolean, but not a number or a string', () => {
    expect(reports['src/status.tsx']).toEqual([
      '2:@typescript-eslint/strict-boolean-expressions',
      '2:@typescript-eslint/strict-boolean-expressions',
    ])
  })
})

describe('n/no-unsupported-features', () => {
  it("leaves a global's type alone, but reports its value, before the Node version of `engines`", async () => {
    await using project = await withProject({
      'package.json':
        '{ "name": "a", "private": true, "type": "module", "engines": { "node": ">=20" } }\n',
      'src/fetch.ts':
        'export type Handler = (request: Request) => Promise<Response>\n\nexport async function get(url: string): Promise<Response> {\n  return new Response(url)\n}\n',
    })
    const eslint = await createESLint(project.dir, {
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
    const eslint = await createESLint(project.dir, {
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
      // A config file in a package's source, such as Angular's `src/app/app.config.ts`, often runs
      // in the app
      'src/app.config.mjs': [expect.stringMatching(/^n\/no-unsupported-features\/node-builtins: /)],
    })
  })
})

test('`unicorn/prefer-observer-apis` reports the resize listener when turned on', async () => {
  const code =
    "export function onResize(update) {\n  window.addEventListener('resize', () => update(window.innerWidth))\n}\n"
  const unicorn = { rules: { 'unicorn/prefer-observer-apis': 'error' } } as const
  expect(await reportsOf('unicorn/prefer-observer-apis', 'src/a.js', code, { unicorn })).toEqual([
    'unicorn/prefer-observer-apis',
  ])
})
