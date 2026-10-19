import path from 'node:path'

import * as prettier from 'prettier'
import ts from 'typescript'

import { defineConfig as definePrettierConfig } from '@gpahal/prettier-config'

import type { EslintConfigOptions } from '@/index'

import {
  createESLint,
  FIXTURES_DIR,
  lint,
  lintText,
  ruleIdOf,
  ruleSeverity,
  sharedESLint,
  typeErrors,
  withProject,
} from './helpers'

const prettierConfig = definePrettierConfig({ root: path.resolve(import.meta.dirname, '..') })
const RULES_DIR = path.join(FIXTURES_DIR, 'rules')

async function lintFixture(
  fixture: string,
  files: Array<string>,
  options: Partial<EslintConfigOptions> = {},
) {
  const eslint = await createESLint(fixture, options)
  return lint(eslint, files, ruleIdOf)
}

/**
 * The rules that report `code` linted as `file` of the rules fixture
 */
async function reportingRules(
  file: string,
  code: string,
  options: Partial<EslintConfigOptions> = {},
): Promise<Array<string>> {
  const eslint = await sharedESLint('rules', { antislop: { slop: false }, ...options })
  return (await lintText(eslint, file, code)).map((message) => message.split(':', 1)[0] ?? '')
}

function fixtureTypeErrors(file: string, code: string): Array<string> {
  const { config } = ts.readConfigFile(path.join(RULES_DIR, 'tsconfig.json'), (name) =>
    ts.sys.readFile(name),
  ) as { config: unknown }
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, RULES_DIR)
  return typeErrors(path.join(RULES_DIR, file), code, options)
}

const format = async (code: string, filepath: string) =>
  prettier.format(code, { ...prettierConfig, filepath })

/**
 * Each file holds one problem, so its messages are exactly the rules that report it, once each
 */
const CASES: Record<string, Array<string>> = {
  'src/unused-disable.ts': [
    "Unused eslint-disable directive (no problems were reported from 'no-console').",
  ],
  'src/dead-store.ts': ['no-useless-assignment'],
  'src/inverted-equality.ts': ['unicorn/no-negated-comparison'],
  'src/unused-private-member.ts': ['@typescript-eslint/no-unused-private-class-members'],
  'src/array-from-map.ts': ['e18e/prefer-array-from-map'],
  'src/object-has-own.ts': ['e18e/prefer-object-has-own'],
  // Overlapping rules that each also report code the others miss
  'src/double-negation.ts': [
    'no-extra-boolean-cast',
    '@typescript-eslint/no-unnecessary-type-conversion',
  ],
  'src/redundant-or-false.ts': [
    '@typescript-eslint/no-unnecessary-condition',
    'unicorn/no-useless-logical-operand',
    'sonarjs/no-redundant-boolean',
  ],
  'src/number-condition.ts': ['@typescript-eslint/strict-boolean-expressions'],
  'src/void-promise.ts': ['@typescript-eslint/no-floating-promises'],
  'src/type-predicate.ts': ['@typescript-eslint/no-unnecessary-condition'],
}

describe('rules', () => {
  it('report each problem with the rule for it, once', async () => {
    const messages = await lintFixture('rules', Object.keys(CASES), { antislop: { slop: false } })
    expect(messages).toEqual(CASES)
  })

  it('allow what the presets leave to judgement', async () => {
    const messages = await lintFixture('rules', ['clean'], {
      react: true,
      antislop: { slop: false },
    })
    expect(Object.values(messages).flat()).toEqual([])
  })

  // The test file is in `__tests__`, since vitest would run a `*.test.ts` fixture
  it.each([
    ['@typescript-eslint/explicit-module-boundary-types', 'boundary-types', {}, [0, 0]],
    [
      '@typescript-eslint/explicit-module-boundary-types',
      'boundary-types',
      { library: true },
      [1, 0],
    ],
    ['@typescript-eslint/no-inferrable-types', 'inferrable-types', {}, [1, 1]],
    // `isolatedDeclarations` needs the type of an exported regex, which the rule removes
    ['@typescript-eslint/no-inferrable-types', 'inferrable-types', { library: true }, [0, 1]],
    ['@typescript-eslint/unbound-method', 'unbound-method', {}, [1, 0]],
  ] as const)(
    'report %s in %s and its test with typescript %j',
    async (rule, name, typescript, expected) => {
      const messages = await lintFixture('rules', [`src/${name}.ts`, `src/__tests__/${name}.ts`], {
        typescript,
      })
      expect(Object.values(messages).map((ids) => ids.filter((id) => id === rule).length)).toEqual(
        expected,
      )
    },
  )

  it.each([
    ['src/strict-boolean.ts', {}, ['@typescript-eslint/strict-boolean-expressions']],
    ['src/strict-boolean.ts', { strictBooleanExpressions: false }, []],
    ['src/switch-default.ts', {}, ['@typescript-eslint/switch-exhaustiveness-check']],
    ['src/switch-default.ts', { exhaustiveSwitch: 'default' }, []],
  ] as const)('report %s with typescript %j', async (file, typescript, expected) => {
    expect(await lintFixture('rules', [file], { typescript })).toEqual({ [file]: expected })
  })

  describe('report implied eval, thrown literals, rejections with non-errors and bracket access', () => {
    const code = [
      'export function run(): void {',
      "  setTimeout('run()', 1)",
      "  throw 'failed'",
      '}',
      'export const failed = new Promise((_resolve, reject) => {',
      "  reject('failed')",
      '})',
      'export const sizes = { small: 1 }',
      "export const small = sizes['small']",
      '',
    ].join('\n')
    const jsCode = code.replace(': void', '')
    const coreRules = [
      'no-implied-eval',
      'no-throw-literal',
      'prefer-promise-reject-errors',
      'dot-notation',
    ]
    const typedRules = coreRules.map((rule) =>
      rule === 'no-throw-literal'
        ? '@typescript-eslint/only-throw-error'
        : `@typescript-eslint/${rule}`,
    )

    it.each([
      ['x.js', jsCode, coreRules],
      ['README.md', `# Title\n\n\`\`\`js\n${jsCode}\`\`\`\n`, coreRules],
      ['src/dead-store.ts', code, typedRules],
    ])('in %s', async (file, text, expected) => {
      const rules = await reportingRules(file, text)
      expect(rules.filter((rule) => [...coreRules, ...typedRules].includes(rule))).toEqual(expected)
    })
  })

  it('merge duplicate imports into TypeScript that compiles', { timeout: 30_000 }, async () => {
    const file = 'src/imports/duplicates.ts'
    // Turns `unicorn/prefer-export-from`'s fix back on to check how it combines with the merge
    const eslint = await createESLint(
      RULES_DIR,
      {
        configs: [{ settings: { '@gpahal/report-only': { 'unicorn/prefer-export-from': false } } }],
      },
      { fix: true },
    )
    // The default merge, `import type { A, type B, C }`, would make `C` type-only
    const [result] = await eslint.lintFiles([file])
    expect(result?.messages).toEqual([])
    const output = await format(result!.output!, result!.filePath)
    expect(output).toBe(
      [
        "import type { A, B } from './types'",
        '',
        'export const x: A = 1',
        "export const y: B = 'b'",
        '',
        "export { C as z } from './types'",
        '',
      ].join('\n'),
    )
    expect(fixtureTypeErrors(file, output)).toEqual([])
    const [again] = await eslint.lintText(output, { filePath: result!.filePath })
    expect(again?.output).toBeUndefined()
    expect(again?.messages).toEqual([])
  })
})

describe('import rules', () => {
  it.each([
    ['a JavaScript-only project', {}, {}, ['import-x/named', 'import-x/namespace']],
    [
      'a JavaScript file with type information',
      {
        'tsconfig.json': '{ "compilerOptions": { "allowJs": true }, "include": ["src"] }\n',
        'src/c.ts': 'export const c = 1\n',
      },
      { typeAware: { javascript: true } },
      [],
    ],
  ] as const)(
    'report a missing named import and namespace member in %s',
    { timeout: 30_000 },
    async (_name, files, options, expected) => {
      await using project = await withProject({
        ...files,
        'package.json': '{ "name": "app", "private": true, "type": "module" }\n',
        'src/a.js': 'export const a = 1\n',
        'src/b.js':
          "import { a, missing } from './a.js'\nimport * as ns from './a.js'\n\nexport const values = [a, missing, ns.a, ns.nope]\n",
      })
      const eslint = await createESLint(project.dir, { gitignore: false, ...options })
      const messages = await lint(eslint, ['src/b.js'], ruleIdOf)
      expect(messages['src/b.js']?.filter((rule) => rule.startsWith('import-x/n'))).toEqual(
        expected,
      )
    },
  )

  it('leave named imports to TypeScript in TypeScript files, and off in code blocks', async () => {
    await using project = await withProject({ 'src/a.js': '' })
    const eslint = await createESLint(project.dir, { gitignore: false })
    for (const file of ['src/b.ts', 'README.md/0.js']) {
      expect(await ruleSeverity(eslint, path.join(project.dir, file), 'import-x/named')).toBe(0)
    }
    expect(await ruleSeverity(eslint, path.join(project.dir, 'src/b.js'), 'import-x/named')).toBe(2)
  })

  it(
    'report a relative import of another package, outside config and test files, without fixing it',
    { timeout: 30_000 },
    async () => {
      const importA = "import { a } from '../../a/src/index.js'\n\nexport const copy = a + 1\n"
      await using project = await withProject({
        'package.json': '{ "name": "repo", "private": true, "type": "module" }\n',
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        'packages/a/package.json':
          '{ "name": "a", "type": "module", "exports": "./src/index.js" }\n',
        'packages/a/src/index.js': 'export const a = 1\n',
        'packages/b/package.json': '{ "name": "b", "type": "module" }\n',
        'packages/b/src/index.js': importA,
        'packages/b/vite.config.js':
          "import { a } from '../a/src/index.js'\n\nexport default { a }\n",
        'packages/b/tests/a.test.js': importA,
      })
      const eslint = await createESLint(project.dir, { gitignore: false }, { fix: true })
      const results = await eslint.lintFiles(['packages/b'])
      expect(
        Object.fromEntries(
          results.map((result) => [
            path.relative(project.dir, result.filePath),
            [result.output, result.messages.map(ruleIdOf)],
          ]),
        ),
      ).toMatchObject({
        'packages/b/src/index.js': [undefined, ['import-x/no-relative-packages']],
        'packages/b/vite.config.js': [undefined, []],
        'packages/b/tests/a.test.js': [undefined, []],
      })
    },
  )
})

describe('json and yaml files', () => {
  it('lint JSON, JSON5 and tsconfig files as JSONC', async () => {
    const eslint = await sharedESLint('json')
    expect(await lint(eslint, ['.'])).toEqual({
      'data.json': [expect.stringMatching(/^json\/no-duplicate-keys: /)],
      'data.json5': [expect.stringMatching(/^json\/no-duplicate-keys: /)],
      'tsconfig.json': [],
    })
  })

  const COMMENT = '{\n  // A comment\n  "a": 1\n}\n'
  const TRAILING_COMMA = '{\n  "a": 1,\n}\n'

  it.each([
    ['tsconfig.build.json', true, true],
    ['.devcontainer/devcontainer.json', true, true],
    ['biome.json', true, false],
    ['data.json', false, false],
  ])('parse %s, comments %s, trailing commas %s', async (file, comments, trailingCommas) => {
    const eslint = await sharedESLint('json')
    const fatal = [expect.stringMatching(/^fatal: /)]
    expect(await lintText(eslint, file, COMMENT)).toEqual(comments ? [] : fatal)
    expect(await lintText(eslint, file, TRAILING_COMMA)).toEqual(trailingCommas ? [] : fatal)
  })

  it('lint YAML files and pnpm catalogs', async () => {
    const messages = await lintFixture('yaml', ['.'], { pnpm: true, packageJson: false })
    expect(messages).toEqual({
      'clean.yml': [],
      'package.json': [
        'pnpm/json-valid-catalog',
        'pnpm/json-valid-catalog',
        'pnpm/json-prefer-workspace-settings',
      ],
      'pnpm-workspace.yaml': [
        'pnpm/yaml-no-unused-catalog-item',
        'pnpm/yaml-no-unused-catalog-item',
      ],
      'workflow.yml': ['yml/no-empty-sequence-entry'],
    })
  })

  it('run the pnpm checks found from pnpm-workspace.yaml with JSON and YAML linting off', async () => {
    expect(
      await lintFixture('yaml', ['package.json'], { json: false, packageJson: false }),
    ).toEqual({
      'package.json': [
        'pnpm/json-valid-catalog',
        'pnpm/json-valid-catalog',
        'pnpm/json-prefer-workspace-settings',
      ],
    })
    expect(
      await lintFixture('yaml', ['pnpm-workspace.yaml', 'clean.yml'], { yaml: false }),
    ).toEqual({
      'clean.yml': ['File ignored because no matching configuration was supplied.'],
      'pnpm-workspace.yaml': [
        'pnpm/yaml-no-unused-catalog-item',
        'pnpm/yaml-no-unused-catalog-item',
      ],
    })
  })
})
