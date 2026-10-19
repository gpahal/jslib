import { parseForESLint, type ParserOptions } from '@typescript-eslint/parser'
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { Linter } from 'eslint'
import eslintPluginImportX from 'eslint-plugin-import-x'

import { patchUnsafeFixes } from '@/internal/fixes'

import { createESLint, FIXTURES_DIR, lintText, sharedESLint } from './helpers'

describe('publishing rules', () => {
  it('say how an app skips the checks of a missing `type` and `description`', async () => {
    const eslint = await createESLint('json')
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
    const eslint = await sharedESLint('rules')
    const messages = await lintText(eslint, file, [...lines, ''].join('\n'))
    return messages.filter((text) => text.startsWith(`${rule}:`))
  }

  it.each([
    [
      'x.js',
      "import { Agent as HttpsAgent } from 'https'",
      'export const a = new HttpsAgent({ rejectUnauthorized: false })',
    ],
    [
      'x.js',
      "import { Agent } from 'undici'",
      'export const a = new Agent({ connect: { rejectUnauthorized: false } })',
    ],
    [
      'x.js',
      "import tls from 'node:tls'",
      "export const s = tls.connect(443, 'a.dev', { rejectUnauthorized: false })",
    ],
    [
      'x.cjs',
      "const { Agent: A } = require('https')",
      'module.exports = new A({ rejectUnauthorized: false })',
    ],
  ])('reports %s: %s, once', async (file, ...lines) => {
    expect(await reports(file, lines)).toEqual([
      `${rule}: Enable server certificate validation on this SSL/TLS connection.`,
    ])
  })

  it.each([
    [
      'x.cjs',
      'function require() {',
      '  return {}',
      '}',
      "const { Agent } = require('https')",
      'module.exports = new Agent({ rejectUnauthorized: false })',
    ],
    // undici ignores the option outside `connect`
    [
      'x.js',
      "import { Agent } from 'undici'",
      'export const a = new Agent({ rejectUnauthorized: false })',
    ],
    [
      'x.js',
      "import https from 'node:https'",
      'export function agent(secure) {',
      '  let options = { rejectUnauthorized: false }',
      '  options = secure',
      '  return new https.Agent(options)',
      '}',
    ],
  ])('leaves %s: %s', async (file, ...lines) => {
    expect(await reports(file, lines)).toEqual([])
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
  // tests independent of the machine's speed. A quadratic pairing reads each about 2,000 times
  it.each([
    [
      'source',
      (index: number) =>
        `import { a${index} } from 'm${index}'\nimport { b${index} } from 'm${index}'\n`,
      4000,
    ],
    ['specifiers', (index: number) => `import { a${index} } from 'm'\n`, 2000],
  ] as const)('checks 2,000 duplicates by their %s in linear work', (key, line, reportCount) => {
    let reads = 0
    const code = Array.from({ length: 2000 }, (_, index) => line(index)).join('')
    const messages = lintDuplicates(code, key, () => {
      reads++
    })
    expect(messages).toHaveLength(reportCount)
    expect(reads / reportCount).toBeLessThan(20)
  })
})
