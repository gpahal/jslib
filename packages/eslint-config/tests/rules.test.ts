import path from 'node:path'

import type { ESLint } from 'eslint'
import ts from 'typescript'

import type { EslintConfigOptions } from '@/index'

import {
  CORE_AREAS_OFF,
  createESLint,
  createFocusedESLint,
  FIXTURES_DIR,
  lint,
  lintText,
  ruleIdOf,
  ruleSeverity,
  sharedESLint,
  withProject,
} from './helpers'

const RULES_DIR = path.join(FIXTURES_DIR, 'rules')

async function lintFixture(
  fixture: string,
  files: Array<string>,
  options: Partial<EslintConfigOptions> = {},
) {
  const eslint = await sharedESLint(fixture, options)
  return lint(eslint, files, ruleIdOf)
}

/**
 * The rules fixture's messages for `files` with `typescript`, and slop rules off
 */
async function lintRules(files: Array<string>, typescript: EslintConfigOptions['typescript']) {
  // An empty `typescript` is the default, so it drops out of `sharedESLint`'s key
  return lintFixture('rules', files, {
    antislop: { slop: false },
    typescript: Object.keys(typescript ?? {}).length === 0 ? undefined : typescript,
  })
}

/**
 * The TypeScript errors in the rules fixture with `code` in place of `file`'s text, as
 * `TS<code>: <message>`
 */
function fixtureTypeErrors(file: string, code: string): Array<string> {
  const { config } = ts.readConfigFile(path.join(RULES_DIR, 'tsconfig.json'), (name) =>
    ts.sys.readFile(name),
  ) as { config: unknown }
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, RULES_DIR)
  const filePath = path.join(RULES_DIR, file)
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  host.readFile = (name) => (path.resolve(name) === filePath ? code : readFile(name))
  const program = ts.createProgram({
    rootNames: [filePath],
    // TypeScript's libs can't hold an error that the fix made, and checking them takes most of the
    // time
    options: { ...options, skipLibCheck: true },
    host,
  })
  return ts
    .getPreEmitDiagnostics(program)
    .map(
      (diagnostic) =>
        `TS${String(diagnostic.code)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    )
}

/**
 * Each file holds one problem, so its messages are exactly the rules that report it, once each
 */
const CASES: Record<string, Array<string>> = {
  'src/unused-disable.ts': [
    "Unused eslint-disable directive (no problems were reported from 'no-console').",
  ],
  'src/inverted-equality.ts': ['unicorn/no-negated-comparison'],
  'src/unused-private-member.ts': ['@typescript-eslint/no-unused-private-class-members'],
  'src/object-has-own.ts': ['e18e/prefer-object-has-own'],
  // Overlapping rules that each also report code the others miss
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

  it.each([
    ['src/strict-boolean.ts', {}, ['@typescript-eslint/strict-boolean-expressions']],
    ['src/strict-boolean.ts', { strictBooleanExpressions: false }, []],
    ['src/switch-default.ts', {}, ['@typescript-eslint/switch-exhaustiveness-check']],
    ['src/switch-default.ts', { exhaustiveSwitch: 'default' }, []],
  ] as const)('report %s with typescript %j', async (file, typescript, expected) => {
    expect(await lintRules([file], typescript)).toEqual({ [file]: expected })
  })

  it('merge duplicate imports into TypeScript that compiles', async () => {
    const file = 'src/imports/duplicates.ts'
    const eslint = await createESLint(RULES_DIR, {}, { fix: true })
    const code = [
      "import type { A } from './types'",
      "import { C, type B } from './types'",
      '',
      'export const x: A = 1',
      "export const y: B = 'b'",
      'export const z = C',
      '',
    ].join('\n')
    // The stock merge, `import type { A, C, type B }`, would make `C` type-only
    const [result] = await eslint.lintText(code, { filePath: path.join(RULES_DIR, file) })
    const output = result?.output ?? code
    expect(output.match(/^import .*$/gm)).toEqual([
      expect.stringMatching(/^import type \{ A,\s*B\s*\} from '\.\/types'$/),
      expect.stringMatching(/^import \{\s*C\s*\} from '\.\/types'$/),
    ])
    expect(fixtureTypeErrors(file, output)).toEqual([])
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
    async (_name, files, options, expected) => {
      await using project = await withProject({
        ...files,
        'package.json': '{ "name": "app", "private": true, "type": "module" }\n',
        'src/a.js': 'export const a = 1\n',
        'src/b.js':
          "import { a, missing } from './a.js'\nimport * as ns from './a.js'\n\nexport const values = [a, missing, ns.a, ns.nope]\n",
      })
      const eslint = await createFocusedESLint(
        project.dir,
        (ruleId) => ruleId.startsWith('import-x/n'),
        { gitignore: false, ...options },
      )
      const messages = await lint(eslint, ['src/b.js'], ruleIdOf)
      expect(messages['src/b.js']?.filter((rule) => rule.startsWith('import-x/n'))).toEqual(
        expected,
      )
    },
  )

  it('leave named imports off in code blocks', async () => {
    await using project = await withProject({ 'src/a.js': '' })
    const eslint = await createFocusedESLint(project.dir, new Set(['import-x/named']), {
      gitignore: false,
    })
    expect(
      await ruleSeverity(eslint, path.join(project.dir, 'README.md/0.js'), 'import-x/named'),
    ).toBe(0)
  })
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

/**
 * The problems of `code` linted as `filePath`, as `line:column rule`
 */
async function problemsOf(eslint: ESLint, filePath: string, code: string): Promise<Array<string>> {
  const results = await eslint.lintText(code, { filePath })
  return results.flatMap((result) =>
    result.messages.map(
      (message) =>
        `${String(message.line)}:${String(message.column)} ${message.ruleId ?? message.message}`,
    ),
  )
}

describe('the toml area', () => {
  // TOML and Markdown, without the core areas, which lint neither
  const options = { ...CORE_AREAS_OFF, markdown: true } as const

  it('lints a ```toml code block in Markdown', async () => {
    const eslint = await sharedESLint('toml', options)
    const block = ['```toml', 'name  =  "a"', '```']
    expect(await problemsOf(eslint, 'docs.md', ['# Title', '', ...block, ''].join('\n'))).toEqual([
      '4:5 toml/key-spacing',
      '4:7 toml/key-spacing',
    ])
  })

  it('lints no TOML file with `toml: false`', async () => {
    const eslint = await sharedESLint('toml', { ...options, toml: false })
    expect(await eslint.calculateConfigForFile('wrangler.toml')).toBeUndefined()
    expect(
      await problemsOf(
        eslint,
        'docs.md',
        ['# Title', '', '```toml', 'a  =  1', '```', ''].join('\n'),
      ),
    ).toEqual([])
  })
})
