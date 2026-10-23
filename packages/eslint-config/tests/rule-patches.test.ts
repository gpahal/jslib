import { parseForESLint, type ParserOptions } from '@typescript-eslint/parser'
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { Linter } from 'eslint'
import eslintPluginImportX from 'eslint-plugin-import-x'

import { patchUnsafeFixes } from '@/internal/fixes'

import { createFocusedESLint } from './fix-helpers'
import { FIXTURES_DIR, lintText } from './helpers'

/**
 * The patched rules of the probes below, the only ones that run
 */
const PATCHED_RULES = new Set([
  'sonarjs/unverified-certificate',
  '@typescript-eslint/no-meaningless-void-operator',
  '@typescript-eslint/promise-function-async',
])

const patchedESLint: { promise?: ReturnType<typeof createFocusedESLint> } = {}

/**
 * ESLint for the rules fixture with only `PATCHED_RULES`, made once
 */
async function getPatchedESLint(): ReturnType<typeof createFocusedESLint> {
  patchedESLint.promise ??= createFocusedESLint('rules', PATCHED_RULES)
  return patchedESLint.promise
}

describe('publishing rules', () => {
  it('say how an app skips the checks of a missing `type` and `description`', async () => {
    const eslint = await createFocusedESLint(
      'json',
      new Set(['package-json/require-description', 'package-json/require-type']),
    )
    const manifest = '{\n  "name": "app",\n  "version": "1.0.0"\n}\n'
    const hint = 'An app, which isn\'t published, sets `"private": true`, which skips this check.'
    const messages = await lintText(eslint, 'app/package.json', manifest)
    expect(messages).toEqual(
      expect.arrayContaining([
        `package-json/require-description: Property 'description' is required. ${hint}`,
        `package-json/require-type: Property 'type' is required. ${hint}`,
      ]),
    )
  })
})

describe('`sonarjs/unverified-certificate`', () => {
  const rule = 'sonarjs/unverified-certificate'

  async function reports(file: string, lines: Array<string>): Promise<Array<string>> {
    const eslint = await getPatchedESLint()
    const messages = await lintText(eslint, file, [...lines, ''].join('\n'))
    return messages.filter((text) => text.startsWith(`${rule}:`))
  }

  // A row reports once or not at all
  it.each<['reports' | 'leaves', string, ...Array<string>]>([
    [
      'reports',
      'x.js',
      "import { Agent as HttpsAgent } from 'https'",
      'export const a = new HttpsAgent({ rejectUnauthorized: false })',
    ],
    [
      'reports',
      'x.js',
      "import { Agent } from 'undici'",
      'export const a = new Agent({ connect: { rejectUnauthorized: false } })',
    ],
    [
      'reports',
      'x.js',
      "import tls from 'node:tls'",
      "export const s = tls.connect(443, 'a.dev', { rejectUnauthorized: false })",
    ],
    [
      'reports',
      'x.cjs',
      "const { Agent: A } = require('https')",
      'module.exports = new A({ rejectUnauthorized: false })',
    ],
    [
      'leaves',
      'x.cjs',
      'function require() {',
      '  return {}',
      '}',
      "const { Agent } = require('https')",
      'module.exports = new Agent({ rejectUnauthorized: false })',
    ],
    // undici ignores the option outside `connect`
    [
      'leaves',
      'x.js',
      "import { Agent } from 'undici'",
      'export const a = new Agent({ rejectUnauthorized: false })',
    ],
    [
      'leaves',
      'x.js',
      "import https from 'node:https'",
      'export function agent(secure) {',
      '  let options = { rejectUnauthorized: false }',
      '  options = secure',
      '  return new https.Agent(options)',
      '}',
    ],
  ])('%s %s: %s', async (verb, file, ...lines) => {
    const message = `${rule}: Enable server certificate validation on this SSL/TLS connection.`
    expect(await reports(file, lines)).toEqual(verb === 'reports' ? [message] : [])
  })
})

describe("`@typescript-eslint/no-meaningless-void-operator`'s patch", () => {
  it("doesn't report `void` of a value that isn't a call, which `no-unused-expressions` needs", async () => {
    const eslint = await getPatchedESLint()
    const code = [
      'export function run(record: () => void, el: { offsetHeight: number }): void {',
      '  record()',
      '  void (1 + 2)',
      '  void el.offsetHeight',
      // The one report, which shows that the rule runs with type information
      '  void record()',
      '}',
      '',
    ].join('\n')
    const rule = '@typescript-eslint/no-meaningless-void-operator'
    // In place of a file of the project, which the project service needs
    const messages = await lintText(eslint, 'src/void-promise.ts', code)
    expect(messages.filter((text) => text.startsWith(`${rule}:`))).toHaveLength(1)
  })
})

describe("`@typescript-eslint/promise-function-async`'s patch", () => {
  it("doesn't report a function that returns React's `ReactNode`, whose promise React awaits", async () => {
    const eslint = await getPatchedESLint()
    const code = [
      // As `@types/react` 19 declares them
      'type AwaitedReactNode = string | null | undefined',
      'type ReactNode = AwaitedReactNode | Promise<AwaitedReactNode>',
      '',
      'export function Layout({ children }: { children: ReactNode }) {',
      '  return children',
      '}',
      '',
      'export const Slot = ({ children, on }: { children: ReactNode; on: boolean }) =>',
      '  on ? children : null',
      '',
      // The one report, a union with a promise of something else
      'export function load(cached: boolean) {',
      '  return cached ? 1 : Promise.resolve(1)',
      '}',
      '',
    ].join('\n')
    const rule = '@typescript-eslint/promise-function-async'
    // In place of a file of the project, which the project service needs
    const messages = await lintText(eslint, 'src/void-promise.ts', code)
    expect(messages.filter((text) => text.startsWith(`${rule}:`))).toHaveLength(1)
  })
})

function countReads(
  node: TSESTree.ImportDeclaration,
  key: 'source' | 'specifiers',
  onRead: () => void,
): void {
  const value = node[key]
  Object.defineProperty(node, key, {
    get: () => {
      onRead()
      return value
    },
    enumerable: true,
    configurable: true,
  })
}

/**
 * The messages of the patched `import-x/no-duplicates` for `code`, with each import's `key`
 * calling `onRead` on each read
 */
function lintDuplicates(
  code: string,
  key: 'source' | 'specifiers',
  onRead: () => void,
): Array<Linter.LintMessage> {
  const parser = {
    meta: { name: 'counting-parser' },
    parseForESLint: (text: string, options?: ParserOptions) => {
      const result = parseForESLint(text, options)
      for (const node of result.ast.body) {
        if (node.type === AST_NODE_TYPES.ImportDeclaration) {
          countReads(node, key, onRead)
        }
      }
      return result
    },
  }
  const configs: Array<Linter.Config> = [
    {
      files: ['**/*.ts'],
      languageOptions: { parser },
      plugins: { 'import-x': eslintPluginImportX },
      rules: { 'import-x/no-duplicates': 'error' },
      settings: { 'import-x/resolver-next': [] },
    },
  ]
  configs.push(...patchUnsafeFixes(configs, FIXTURES_DIR))
  return new Linter({ configType: 'flat' }).verify(code, configs, 'a.ts')
}

describe("`import-x/no-duplicates`' patch", () => {
  // Counting reads of the imports' properties, which the pairing looks reports up by, keeps the
  // tests independent of the machine's speed. A quadratic pairing reads each about 500 times
  it.each([
    [
      'source',
      (index: number) =>
        `import { a${index} } from 'm${index}'\nimport { b${index} } from 'm${index}'\n`,
      1000,
    ],
    ['specifiers', (index: number) => `import { a${index} } from 'm'\n`, 500],
  ] as const)('checks 500 duplicates by their %s in linear work', (key, line, reportCount) => {
    let reads = 0
    const code = Array.from({ length: 500 }, (_, index) => line(index)).join('')
    const messages = lintDuplicates(code, key, () => {
      reads++
    })
    expect(messages).toHaveLength(reportCount)
    expect(reads / reportCount).toBeLessThan(20)
  })
})
