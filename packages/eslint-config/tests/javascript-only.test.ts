import tseslint from 'typescript-eslint'

import { defineConfig } from '@/index'
import { ESLINT_RECOMMENDED_TYPESCRIPT_RULES } from '@/internal/configs/typescript-core'
import { resolveOptions } from '@/internal/resolve'

import { createESLint, lint, lintText, ruleSeverity, withProject } from './helpers'

/**
 * Whether the project of `files` is JavaScript-only with `options`
 */
async function isJavascriptOnly(
  files: Record<string, string>,
  options: Record<string, unknown> = {},
): Promise<boolean> {
  await using project = await withProject(files)
  return resolveOptions({ root: project.dir, ...options }).javascriptOnly
}

describe('a JavaScript-only project', () => {
  it('has JavaScript files only, and no tsconfig.json or jsconfig.json at `root`', async () => {
    expect(await isJavascriptOnly({ 'src/a.js': '', 'src/b.cjs': '', 'src/c.jsx': '' })).toBe(true)
    expect(await isJavascriptOnly({ 'src/a.js': '', 'src/b.ts': '' })).toBe(false)
    expect(await isJavascriptOnly({ 'src/a.js': '', 'tsconfig.json': '{}' })).toBe(false)
    // Files that the ignores leave out don't count
    expect(await isJavascriptOnly({ 'src/a.js': '', 'dist/a.d.ts': '' })).toBe(true)
  })

  it.each([
    ['typeAware.javascript', { typeAware: { javascript: true } }],
    [
      'typescript.rules',
      { typescript: { rules: { '@typescript-eslint/no-explicit-any': 'off' } } },
    ],
    [
      'an `extends` of `configs`',
      { configs: [{ extends: [{ plugins: { '@typescript-eslint': {} } }] }] },
    ],
  ])("isn't with %s, which needs typescript-eslint", async (_name, options) => {
    expect(await isJavascriptOnly({ 'src/a.js': '' }, options)).toBe(false)
  })

  it("isn't when the walk doesn't run, so its files are unknown", async () => {
    expect(
      await isJavascriptOnly(
        { 'src/a.js': '' },
        { gitignore: false, typeAware: false, imports: false },
      ),
    ).toBe(false)
  })

  it('lints JavaScript files with the core twins of typescript-eslint rules, with their options', async () => {
    const files = {
      'src/a.js': [
        'const a = 1',
        'const _b = 2',
        'export function f(c, _d) {',
        '  return new Array(1, 2)',
        '}',
        'export class C {',
        '  constructor() {}',
        '}',
        'export function g() {}',
        'const { x, ...rest } = { x: 1, y: 2 }',
        'export { rest }',
        'try {',
        '  f()',
        '} catch (error) {',
        '  // Ignored',
        '}',
        '',
      ].join('\n'),
    }
    await using project = await withProject(files)
    const eslint = await createESLint(project.dir, { unicorn: false, sonarjs: false })
    expect(
      await lint(
        eslint,
        ['src/a.js'],
        (message) => `${String(message.line)} ${message.ruleId ?? message.message}`,
      ),
    ).toEqual({
      'src/a.js': [
        '1 no-unused-vars',
        '3 no-unused-vars',
        '4 no-array-constructor',
        '7 no-useless-constructor',
        '7 no-empty-function',
        '9 no-empty-function',
        '14 no-unused-vars',
      ],
    })
    expect(
      await ruleSeverity(eslint, 'src/a.js', '@typescript-eslint/no-unused-vars'),
    ).toBeUndefined()
  })

  it('removes an unused import with `imports.removeUnused`, keeping a side-effect import', async () => {
    const files = {
      'src/a.js': "import { unused } from './b.js'\nimport './c.js'\n\nexport const a = 1\n",
      'src/b.js': 'export const unused = 1\n',
      'src/c.js': '',
    }
    const options = { imports: { removeUnused: true }, unicorn: false, sonarjs: false }
    expect(await isJavascriptOnly(files, options)).toBe(true)
    await using project = await withProject(files)
    const eslint = await createESLint(project.dir, options, { fix: true })
    const [result] = await eslint.lintFiles(['src/a.js'])
    expect(result?.output).toBe("import './b.js'\nimport './c.js'\n\nexport const a = 1\n")
    expect(result?.messages).toEqual([])
  })

  it('parses a TypeScript file it has after all, without the core twins of typescript-eslint rules', async () => {
    await using project = await withProject({ 'src/a.js': '' })
    const eslint = await createESLint(project.dir)
    const code = 'export class A {\n  constructor(private readonly a: number) {}\n}\nvar b = 2\n'
    expect(await lintText(eslint, 'src/late.ts', code)).toEqual([
      'no-var: Unexpected var, use let or const instead.',
    ])
  })

  it("parses with typescript-eslint's parser what ESLint's rejects, such as JSX and decorators", async () => {
    await using project = await withProject({ 'src/a.js': '' })
    const eslint = await createESLint(project.dir, { gitignore: false })
    const code = 'function sealed(target) {\n  return target\n}\n\n@sealed\nexport class A {}\n'
    expect(await lintText(eslint, 'src/a.js', code)).toEqual([])
    expect(await lintText(eslint, 'src/c.js', 'export const a = <div />\n')).toEqual([])
    expect(await lintText(eslint, 'src/b.js', 'export const a = (\n')).toEqual([
      'fatal: Parsing error: Unexpected token',
    ])
  })

  it('reports ESM syntax in a CommonJS file with `@gpahal/no-esm-in-commonjs`', async () => {
    await using project = await withProject({ 'src/a.js': '' })
    const eslint = await createESLint(project.dir)
    expect(await lintText(eslint, 'src/b.cjs', 'export const a = 1\n')).toEqual([
      expect.stringMatching(/^@gpahal\/no-esm-in-commonjs: /),
    ])
  })

  it("names typescript-eslint's configs as missing with the reason", async () => {
    await using project = await withProject({ 'src/a.js': '' })
    const composer = defineConfig({ root: project.dir, isInEditor: false }).override(
      'gpahal/typescript/rules-ts',
      (config) => config,
    )
    await expect(composer).rejects.toThrow(
      "@gpahal/eslint-config: `.override('gpahal/typescript/rules-ts')`: no config has the name `gpahal/typescript/rules-ts`. `gpahal/typescript/rules-ts` needs typescript-eslint or type information, which a JavaScript-only project, one without TypeScript files or a tsconfig.json or jsconfig.json at `root`, is linted without",
    )
  })
})

// The copy that keeps typescript-eslint from loading. Update it from typescript-eslint's
// `configs.eslintRecommended` when this fails
test("ESLINT_RECOMMENDED_TYPESCRIPT_RULES is typescript-eslint's eslint-recommended", () => {
  expect(ESLINT_RECOMMENDED_TYPESCRIPT_RULES).toEqual(tseslint.configs.eslintRecommended.rules)
})
