import { RuleTester } from 'eslint'
import ts from 'typescript'
import { parser as tsEslintParser } from 'typescript-eslint'

import { GPAHAL_PLUGIN } from '@/internal/plugin'

const tester = new RuleTester({ languageOptions: { parser: tsEslintParser } })

const errors = [{ messageId: 'typeOnlyReexport' }]
const localErrors = [{ messageId: 'typeOnly' }]

tester.run('no-inline-type-only-export', GPAHAL_PLUGIN.rules['no-inline-type-only-export'], {
  valid: [
    'export { type A, b }',
    "export type { A, B as C } from './a'",
    'export { type }',
    // Exports the value `type` as `as`
    'export { type as as }',
  ],
  invalid: [
    { code: 'export { type A }', output: 'export type { A }', errors: localErrors },
    {
      code: "export { type A, type B as C } from './a'",
      output: "export type { A, B as C } from './a'",
      errors,
    },
    { code: 'export { type type }', output: 'export type { type }', errors: localErrors },
    { code: 'export { type as as as }', output: 'export type { as as as }', errors: localErrors },
    { code: 'export { type\nA }', output: 'export type { A }', errors: localErrors },
    // The fix would delete the comment
    { code: "export { type /* A */ A } from './a'", output: null, errors },
    // TypeScript rejects import attributes on a type-only export
    { code: "export { type G } from './g.js' with { type: 'x' }", output: null, errors },
  ],
})

/**
 * The JavaScript that TypeScript emits for `code` under `verbatimModuleSyntax`
 */
function emit(code: string): string {
  return ts
    .transpileModule(code, {
      compilerOptions: {
        verbatimModuleSyntax: true,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
      },
    })
    .outputText.trim()
}

// The fix keeps the types, but drops the module load: a module that must run needs an import
describe('the emit before and after the fix, under verbatimModuleSyntax', () => {
  it.each([
    ["export { type A } from './a'", "export type { A } from './a'"],
    [
      "import { type A } from './a'\nexport type B = A",
      "import type { A } from './a'\nexport type B = A",
    ],
  ])('%s loads the module, and its fix does not', (before, after) => {
    expect(emit(before)).toMatch(/(?:export|import) \{\} from '\.\/a'|import '\.\/a'/)
    expect(emit(after)).not.toContain("'./a'")
  })
})
