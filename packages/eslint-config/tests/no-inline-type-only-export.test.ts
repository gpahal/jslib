import { RuleTester } from 'eslint'
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
