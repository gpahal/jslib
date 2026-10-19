import { RuleTester } from 'eslint'
import { parser as tsEslintParser } from 'typescript-eslint'

import { runNodeOk } from '@gpahal/internal/node/testing'

import { GPAHAL_PLUGIN } from '@/internal/plugin'

import { withProject } from './helpers'

const tester = new RuleTester({ languageOptions: { parser: tsEslintParser } })

/**
 * Code that Node's type stripping runs
 */
const VALID = [
  "import type Fs = require('node:fs')",
  "declare module 'm' { import fs = require('node:fs'); export = fs }",
  'declare class A { accessor x: number }',
  // Type stripping erases an abstract member, `accessor` included
  'abstract class A { abstract accessor x: number }',
  'declare const enum E { A }',
  // A namespace of only types, however nested, is erased
  'namespace N { export namespace M { export interface I {} } }',
  'declare global { namespace N { const x: number } }\nexport {}',
  "declare module 'x' {}",
  'class A { constructor(x: number) { console.error(x) } }',
]

const toNamespace = (output: string) => ({ messageId: 'useNamespace', output })

/**
 * Code that Node's type stripping can't run, with the rule's reports
 */
const INVALID: Array<{
  code: string
  errors: Array<{
    messageId: string
    line: number
    column: number
    suggestions?: Array<{ messageId: string; output: string }>
  }>
}> = [
  {
    code: "import fs = require('node:fs')",
    errors: [{ messageId: 'importEquals', line: 1, column: 1 }],
  },
  {
    code: 'const x = 1; export = x',
    errors: [{ messageId: 'exportAssignment', line: 1, column: 14 }],
  },
  {
    code: 'declare const d: any\nclass A { @d m() {} }',
    errors: [{ messageId: 'decorator', line: 2, column: 11 }],
  },
  {
    code: 'class A { accessor x = 1 }',
    errors: [{ messageId: 'accessor', line: 1, column: 11 }],
  },
  { code: 'export enum E { A }', errors: [{ messageId: 'enum', line: 1, column: 8 }] },
  // A declaration with `declare` inside a namespace without it isn't erased with it
  {
    code: 'namespace N { export declare const x: number }',
    errors: [{ messageId: 'namespace', line: 1, column: 1 }],
  },
  // Only the outermost namespace, and what else can't run inside it
  {
    code: 'namespace N { export namespace M { export enum E { A } } }',
    errors: [
      { messageId: 'namespace', line: 1, column: 1 },
      { messageId: 'enum', line: 1, column: 43 },
    ],
  },
  // Node rejects every `module` declaration named by an identifier, even one it would erase
  {
    code: 'declare namespace M { module N {} }',
    errors: [
      {
        messageId: 'moduleKeyword',
        line: 1,
        column: 23,
        suggestions: [toNamespace('declare namespace M { namespace N {} }')],
      },
    ],
  },
  // No suggestion where a namespace would have values that Node can't run either
  {
    code: 'module N { export const x = 1 }',
    errors: [{ messageId: 'moduleKeyword', line: 1, column: 1, suggestions: [] }],
  },
  {
    code: 'class A { constructor(readonly x: number, public y?: number) {} }',
    errors: [
      { messageId: 'parameterProperty', line: 1, column: 23 },
      { messageId: 'parameterProperty', line: 1, column: 43 },
    ],
  },
]

tester.run('no-unstrippable-syntax', GPAHAL_PLUGIN.rules['no-unstrippable-syntax'], {
  valid: VALID,
  invalid: INVALID,
})

test('matches what Node runs with type stripping', async () => {
  const cases = [...VALID, ...INVALID.map(({ code }) => code)]
  await using project = await withProject({
    ...Object.fromEntries(cases.map((code, index) => [`${String(index)}.mts`, code])),
    'check.mjs': [
      "import { pathToFileURL } from 'node:url'",
      'const failed = []',
      `for (let index = 0; index < ${String(cases.length)}; index += 1) {`,
      '  try {',
      // eslint-disable-next-line no-template-curly-in-string -- The code of the script
      '    await import(pathToFileURL(`${process.argv[2]}/${index}.mts`).href)',
      '  } catch (error) {',
      '    if (error instanceof SyntaxError) failed.push(index)',
      '  }',
      '}',
      'console.log(JSON.stringify(failed))',
      '',
    ].join('\n'),
  })
  const output = await runNodeOk(
    ['--disable-warning=ExperimentalWarning', 'check.mjs', project.dir],
    { cwd: project.dir },
  )
  const failed = (JSON.parse(output) as Array<number>).map((index) => cases[index])
  expect(failed).toEqual(INVALID.map(({ code }) => code))
})
