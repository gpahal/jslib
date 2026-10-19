import path from 'node:path'

import type { Linter } from 'eslint'

import type { EslintConfigOptions } from '@/index'
import { resolveOptions } from '@/internal/resolve'

import { createESLint, lint, ruleIdOf, warningsOf, withProject } from './helpers'

const ASSERTED = "const s: string = 'a'\n\nexport const t = s as string\n"

const TSCONFIG = '{ "compilerOptions": { "strict": true, "types": [] }, "include": ["src"] }\n'

describe('typeAware.ignores', () => {
  it('lints its files without type information, which the project service never opens', async () => {
    await using project = await withProject({
      'tsconfig.json': TSCONFIG,
      'src/a.ts': ASSERTED,
      'src/gen/b.ts': ASSERTED,
      'generated/c.ts': ASSERTED,
    })
    const eslint = await createESLint(project.dir, {
      typeAware: { ignores: ['src/gen/**', 'generated/**'] },
    })
    const results = await lint(eslint, ['src/a.ts', 'src/gen/b.ts', 'generated/c.ts'], ruleIdOf)
    expect(results['src/a.ts']).toContain('@typescript-eslint/no-unnecessary-type-assertion')
    for (const file of ['src/gen/b.ts', 'generated/c.ts']) {
      expect(results[file]).not.toContain('@typescript-eslint/no-unnecessary-type-assertion')
      expect(results[file]?.filter((message) => message.startsWith('Parsing error'))).toEqual([])
      const config = (await eslint.calculateConfigForFile(
        path.join(project.dir, file),
      )) as Linter.Config
      expect(config.languageOptions?.['parserOptions']).toMatchObject({ projectService: false })
    }
  })

  it('leaves its files out of the files outside every tsconfig and the default project', async () => {
    await using project = await withProject({
      'tsconfig.json': TSCONFIG,
      'src/a.ts': 'export const a = 1\n',
      'generated/c.ts': 'export const c = 1\n',
      'generated/gen.config.ts': 'export default {}\n',
      'tool.config.ts': 'export default {}\n',
    })
    const options = { root: project.dir, typeAware: { ignores: ['generated/**'] } }
    const resolved = resolveOptions(options)
    expect(resolved.filesOutsideTsconfigs).toEqual([])
    expect(resolved.allowDefaultProject).toEqual(['eslint.config.mjs', 'tool.config.ts'])
    expect(resolved.defaultProjectFileCount).toBe(2)
    expect(
      warningsOf(project.dir, { typeAware: { ignores: ['generated/**'] } }).filter(
        ([, code]) => code === 'GPAHAL_FILES_OUTSIDE_TSCONFIG',
      ),
    ).toEqual([])
    const unignored = resolveOptions({ root: project.dir })
    expect(unignored.filesOutsideTsconfigs).toEqual(['generated/c.ts'])
    expect(unignored.allowDefaultProject).toContain('generated/gen.config.ts')
  })

  it("doesn't warn of a missing tsconfig when its globs match every TypeScript file", async () => {
    await using project = await withProject({
      'generated/c.ts': 'export const c = 1\n',
    })
    const codes = (options: EslintConfigOptions['typeAware']) =>
      warningsOf(project.dir, { typeAware: options }).map(([, code]) => code)
    expect(codes({ ignores: ['generated/**'] })).not.toContain('GPAHAL_NO_TSCONFIG')
    expect(codes({})).toContain('GPAHAL_NO_TSCONFIG')
  })

  it.each<[string, EslintConfigOptions['configs']]>([
    ['a global ignores config', [{ ignores: ['generated/**'] }]],
    ['one with a `basePath`, nested', [[{ basePath: 'generated', ignores: ['**/*.ts'] }]]],
  ])(
    'leaves the files that %s of `configs` ignores out of the files outside every tsconfig',
    async (_name, configs) => {
      await using project = await withProject({
        'tsconfig.json': TSCONFIG,
        'src/a.ts': 'export const a = 1\n',
        'generated/c.ts': 'export const c = 1\n',
        'scripts/d.ts': 'export const d = 1\n',
      })
      const warnings = warningsOf(project.dir, { configs }).filter(
        ([, code]) => code === 'GPAHAL_FILES_OUTSIDE_TSCONFIG',
      )
      expect(warnings).toEqual([
        [
          expect.stringContaining('1 TypeScript file in the project, `scripts/d.ts`,'),
          expect.anything(),
        ],
      ])
    },
  )

  it('keeps out the files of a `!` glob, and takes a function of the defaults, `[]`', async () => {
    await using project = await withProject({
      'tsconfig.json': TSCONFIG,
      'src/a.ts': 'export const a = 1\n',
      'generated/c.ts': 'export const c = 1\n',
      'generated/typed/d.ts': 'export const d = 1\n',
    })
    const defaults: Array<ReadonlyArray<string>> = []
    const resolved = resolveOptions({
      root: project.dir,
      typeAware: {
        ignores: (globs) => {
          defaults.push([...globs])
          return [...globs, 'generated/**', '!generated/typed/**']
        },
      },
    })
    expect(defaults).toEqual([[]])
    expect(resolved.filesOutsideTsconfigs).toEqual(['generated/typed/d.ts'])
    expect(resolved.typeAware?.ignores.slice(-2)).toEqual(['generated/**', '!generated/typed/**'])
  })

  it.each<[EslintConfigOptions['typeAware'], string]>([
    [
      { ignores: ['/abs/**'] },
      '@gpahal/eslint-config: `typeAware.ignores`: glob `/abs/**` starts with `/`, but globs are relative to `root`. Write `abs/**`',
    ],
    [
      { ignores: ['src/*.css'] },
      '@gpahal/eslint-config: `typeAware.ignores`: glob `src/*.css` matches no JavaScript or TypeScript file',
    ],
    [
      // @ts-expect-error -- A JavaScript caller can pass a string
      { ignores: 'src/**' },
      '@gpahal/eslint-config: `typeAware.ignores`: expected an array of globs or a function',
    ],
  ])('throws on %j', async (typeAware, message) => {
    await using project = await withProject({ 'tsconfig.json': TSCONFIG })
    const { defineConfig } = await import('@/index')
    expect(() => defineConfig({ root: project.dir, typeAware })).toThrow(message)
  })
})
