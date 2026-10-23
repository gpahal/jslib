import { runNode, withTmpProject } from '@gpahal/internal/node/testing'

// Canary for the README's warnings in "A Node app that strips types": node-app type-checks this
// code, which Node can't run. Fails when Node starts running it, so the warning can go
test('Node fails to run code that node-app type-checks, as the README warns', async () => {
  // Outside the repo, unlike the type-checked projects, since running needs no `@types/node`
  await using project = await withTmpProject('node-app-unrunnable', {
    'package.json': JSON.stringify({ type: 'module' }),
    'src/b.ts': 'export const b = 1\n',
    'src/js-specifier.ts': "import { b } from './b.js'\n\nconsole.log(b)\n",
    'src/decorator.ts': [
      'function logged<T>(value: T, _context: ClassMethodDecoratorContext): T {',
      '  return value',
      '}',
      'export class A {',
      '  @logged',
      '  c(): number {',
      '    return 1',
      '  }',
      '}',
      '',
    ].join('\n'),
    'src/accessor.ts': 'export class A {\n  accessor b = 1\n}\n',
  })
  const failures = await Promise.all(
    ['src/js-specifier.ts', 'src/decorator.ts', 'src/accessor.ts'].map(async (file) => {
      const { status, stderr } = await runNode([file], { cwd: project.dir })
      return [file, status, /ERR_MODULE_NOT_FOUND|SyntaxError/.exec(stderr)?.[0]]
    }),
  )
  expect(
    failures,
    'Node runs code that node-app type-checks: for each file that now runs, remove its case from the README\'s warning in "A Node app that strips types", and the check that `@gpahal/eslint-config`\'s `node: { typeStripping: true }` adds for it, `@gpahal/no-js-specifier-for-ts` for the `.js` specifier or the decorator or `accessor` field check of `@gpahal/no-unstrippable-syntax`',
  ).toEqual([
    ['src/js-specifier.ts', 1, 'ERR_MODULE_NOT_FOUND'],
    ['src/decorator.ts', 1, 'SyntaxError'],
    ['src/accessor.ts', 1, 'SyntaxError'],
  ])
})
