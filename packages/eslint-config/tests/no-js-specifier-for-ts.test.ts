import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Linter, RuleTester } from 'eslint'
import { parser as tsEslintParser } from 'typescript-eslint'

import { runNodeOk } from '@gpahal/internal/node/testing'

import { GPAHAL_PLUGIN } from '@/internal/plugin'

/**
 * The files the specifiers name, since the rule reads the file system
 */
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'no-js-specifier-for-ts-')))
for (const file of [
  'a.ts',
  'b.ts',
  'c.js',
  'c.ts',
  'd.mts',
  'e.cts',
  'lib/f.ts',
  'g.ts',
  'g.js/index.js',
]) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), '')
}

/**
 * `encodedDir` holds `a b.js` beside an unrelated `a%20b.ts`; `decodedDir` holds only `a b.ts`
 */
const encodedDir = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'no-js-specifier-for-ts-')),
)
const decodedDir = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'no-js-specifier-for-ts-')),
)
fs.writeFileSync(path.join(encodedDir, 'a b.js'), 'export default 42\n')
fs.writeFileSync(path.join(encodedDir, 'a%20b.ts'), 'export default 0\n')
fs.writeFileSync(path.join(decodedDir, 'a b.ts'), 'export default 42\n')

afterAll(() => {
  for (const folder of [dir, encodedDir, decodedDir]) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

const filename = path.join(dir, 'a.ts')
const ctsFilename = path.join(dir, 'e.cts')
const errors = [{ messageId: 'tsSpecifier' }]

function fix(code: string, output: string, file = filename) {
  return { code, output, filename: file, errors }
}

const tester = new RuleTester({ languageOptions: { parser: tsEslintParser } })

tester.run('no-js-specifier-for-ts', GPAHAL_PLUGIN.rules['no-js-specifier-for-ts'], {
  valid: [
    // A real `c.js`
    { code: "import { c } from './c.js'", filename },
    { code: "import { b } from 'pkg/b.js'", filename },
    { code: "import { x } from './x.js'", filename },
    { code: "import b from './b.js?raw'", filename },
    { code: "const b = require('./b.js', 1)", filename },
    // A binding named `require` can be any callback, not Node's loader
    { code: "function load(require) { return require('./b.js') }", filename },
    { code: "import require from 'custom-loader'; require('./b.js')", filename },
    // A local loader can resolve from another folder
    {
      code: "import { createRequire } from 'node:module'; const require = createRequire('/other/a.js'); require('./b.js')",
      filename,
    },
    // Type stripping erases type-only imports
    { code: "import type { B } from './b.js'", filename },
    { code: "export type B = import('./b.js').B", filename },
    { code: "require.resolve('./b.js', { paths: ['/other'] })", filename: ctsFilename },
    // Node's CommonJS loader loads a folder `g.js` by its `index.js`
    { code: "const g = require('./g.js')", filename: ctsFilename },
    // `fs.statSync` throws on a NUL byte even with `throwIfNoEntry: false`
    { code: "import b from './b%00.js'", filename },
    // eslint-disable-next-line no-template-curly-in-string -- the linted code's template literal
    { code: 'export const b = await import(`./${name}.js`)', filename },
  ],
  invalid: [
    fix("import { b } from './b.js'", "import { b } from './b.ts'"),
    fix("import { d } from './d.mjs'", "import { d } from './d.mts'"),
    fix("import { f } from './lib/f.js'", "import { f } from './lib/f.ts'"),
    fix("export * from './b.js'", "export * from './b.ts'"),
    fix('export const b = await import(`./b.js`)', 'export const b = await import(`./b.ts`)'),
    fix("import b = require('./b.js')", "import b = require('./b.ts')"),
    // An ES module import of a folder fails
    fix("import { g } from './g.js'", "import { g } from './g.ts'"),
    fix("const b = import.meta.resolve('./b.js')", "const b = import.meta.resolve('./b.ts')"),
    fix("const e = require('./e.cjs')", "const e = require('./e.cts')", ctsFilename),
    fix("const b = require.resolve('./b.js')", "const b = require.resolve('./b.ts')", ctsFilename),
    // Node's loader for this file, made by `createRequire` or typed by `declare`
    ...[
      "import { createRequire as make } from 'module'; const require = make(import.meta.filename)",
      "import * as module from 'node:module'; const require = module.createRequire(import.meta.url)",
      'declare const require: NodeJS.Require',
    ].map((declaration) =>
      fix(
        `${declaration}; const b = require('./b.js')`,
        `${declaration}; const b = require('./b.ts')`,
      ),
    ),
    // ESM specifiers are URLs, which Node percent-decodes; `require()` specifiers are paths
    fix(
      "import x from './a%20b.js'",
      "import x from './a%20b.ts'",
      path.join(decodedDir, 'main.ts'),
    ),
    fix(
      "const x = require('./a%20b.js')",
      "const x = require('./a%20b.ts')",
      path.join(encodedDir, 'main.cts'),
    ),
    // An escape in the extension isn't rewritten
    { code: String.raw`import { b } from './b.\u006as'`, output: null, filename, errors },
  ],
})

test('keeps a percent-encoded import that Node loads', async () => {
  const code = "import x from './a%20b.js'\nconsole.log(x)\n"
  const main = path.join(encodedDir, 'main.ts')
  fs.writeFileSync(main, code)
  expect(await runNodeOk([main])).toBe('42\n')
  const { output } = new Linter({ configType: 'flat', cwd: encodedDir }).verifyAndFix(
    code,
    {
      files: ['**/*.ts'],
      languageOptions: { parser: tsEslintParser },
      plugins: { '@gpahal': GPAHAL_PLUGIN },
      rules: { '@gpahal/no-js-specifier-for-ts': 'error' },
    },
    main,
  )
  fs.writeFileSync(main, output)
  expect(await runNodeOk([main])).toBe('42\n')
})
