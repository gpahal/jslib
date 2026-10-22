import syncFs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertBuildIsCurrent, runNode } from '@gpahal/internal/node/testing'
import { isRecord } from '@gpahal/std/objects'

import { defineConfig, type EslintConfigOptions } from '@/index'
import { checkDefaultProjectTsconfig } from '@/internal/default-project'

import { BUILD_DIR, CORE_AREAS_OFF_SOURCE, warningsOf, withProject } from './helpers'

const TSCONFIG_DIR = path.join(import.meta.dirname, '..', '..', 'tsconfig')

const TYPES_NODE = {
  'node_modules/@types/node/package.json': '{ "name": "@types/node", "version": "24.0.0" }\n',
}

const NODE_TSCONFIG = '{ "compilerOptions": { "types": ["node"] }, "include": ["src"] }\n'

const SRC = { 'src/a.ts': 'export const a = 1\n' }

const CONFIG_URL = pathToFileURL(path.join(BUILD_DIR, 'index.js')).href

// The areas that the config of ESLint's process turns off, which the warnings don't depend on,
// since loading them makes up most of the time each thread takes to build the config
describe('checkDefaultProjectTsconfig', () => {
  it.each<[string, Record<string, string>]>([
    [
      'lists `node` through `extends`',
      {
        'tsconfig.base.json': '{ "compilerOptions": { "types": ["node"] } }\n',
        'tsconfig.json': '{ "extends": "./tsconfig.base.json", "include": ["src"] }\n',
        ...TYPES_NODE,
      },
    ],
    // The check can't follow `typeRoots` folders, so it trusts them
    [
      'has `typeRoots`',
      {
        'tsconfig.json':
          '{ "compilerOptions": { "types": ["node"], "typeRoots": ["./typings"] }, "include": ["src"] }\n',
        'typings/node/index.d.ts': 'declare const process: unknown\n',
      },
    ],
  ])('accepts a root tsconfig that %s', async (_name, files) => {
    await using project = await withProject({ ...SRC, ...files })
    expect(checkDefaultProjectTsconfig(project.dir)).toBeUndefined()
  })

  it('reports a tsconfig that lists `node` without @types/node', async () => {
    await using project = await withProject({ 'tsconfig.json': NODE_TSCONFIG, ...SRC })
    expect(checkDefaultProjectTsconfig(project.dir)).toEqual({ kind: 'node-types-missing' })
  })
})

describe('the default project warnings', () => {
  it('warns once that a missing root tsconfig leaves config files without Node types', async () => {
    // TypeScript files, without which a JavaScript config file isn't typed
    await using project = await withProject({
      'packages/a/tsconfig.json': '{ "include": ["src"] }\n',
      'packages/a/src/a.ts': 'export const a = 1\n',
    })
    const tsconfig = path.join(project.dir, 'tsconfig.json')
    expect(warningsOf(project.dir)).toEqual([
      [
        `@gpahal/eslint-config: \`typeAware\`: config files that no tsconfig includes, such as \`eslint.config.mjs\`, get type information from the compiler options of \`${tsconfig}\`, which doesn't exist, so they're checked without Node's types. Add a tsconfig.json at \`root\` with \`"compilerOptions": { "types": ["node"] }\`, or list those files in a tsconfig, and install @types/node`,
        'GPAHAL_DEFAULT_PROJECT_NODE_TYPES',
      ],
    ])
    expect(warningsOf(project.dir)).toEqual([])
  })

  it('warns of a root tsconfig whose `types` lacks `node`, listing at most 3 files', async () => {
    await using project = await withProject({
      'tsconfig.json': '{ "include": ["src"] }\n',
      ...SRC,
      ...Object.fromEntries(['a', 'b', 'c', 'd'].map((name) => [`${name}.config.ts`, ''])),
    })
    const tsconfig = path.join(project.dir, 'tsconfig.json')
    expect(warningsOf(project.dir)).toEqual([
      [
        `@gpahal/eslint-config: \`typeAware\`: config files that no tsconfig includes, such as \`a.config.ts\`, \`b.config.ts\`, \`c.config.ts\` and 2 more, get type information from the compiler options of \`${tsconfig}\`, whose "types" doesn't list "node", so they're checked without Node's types. Add "node" to its "types", or list those files in a tsconfig that does, and install @types/node`,
        'GPAHAL_DEFAULT_PROJECT_NODE_TYPES',
      ],
    ])
  })

  it.each<[string, Record<string, string>, Omit<EslintConfigOptions, 'root'>]>([
    [
      'the root tsconfig lists `node`',
      { ...TYPES_NODE, 'tsconfig.json': NODE_TSCONFIG, ...SRC },
      {},
    ],
    ['type information is off', SRC, { typeAware: false }],
    ['the project is JavaScript', { 'src/a.js': 'export const a = 1\n' }, {}],
  ])("doesn't warn when %s", async (_name, files, options) => {
    await using project = await withProject(files)
    expect(warningsOf(project.dir, options)).toEqual([])
  })

  it('warns once, of the missing tsconfig only, for TypeScript files without one', async () => {
    await using project = await withProject(SRC)
    expect(warningsOf(project.dir)).toEqual([
      [
        `@gpahal/eslint-config: \`typeAware\`: no tsconfig.json was found at or under \`${project.dir}\`, so typescript-eslint's project service can't type TypeScript files and reports each as not found by the project service. Config files such as \`eslint.config.mjs\` get no Node types either, so type-checked rules report on them. Add a tsconfig.json at \`root\` with \`"compilerOptions": { "types": ["node"] }\`, which fixes both, or set \`typeAware: false\``,
        'GPAHAL_NO_TSCONFIG',
      ],
    ])
    expect(warningsOf(project.dir)).toEqual([])
  })

  // ESLint's `--concurrency` workers are worker threads that each load the config again
  it('warns once under ESLint --concurrency, from the main thread', async () => {
    await assertBuildIsCurrent(BUILD_DIR)
    const eslintBin = path.join(
      path.dirname(fileURLToPath(import.meta.resolve('eslint/package.json'))),
      'bin',
      'eslint.js',
    )
    await using project = await withProject({
      'package.json': '{ "private": true, "type": "module" }\n',
      'tsconfig.json': '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n',
      'vite.config.ts': 'export default {}\n',
      'eslint.config.mjs': `import { defineConfig } from ${JSON.stringify(CONFIG_URL)}\nexport default defineConfig({ root: import.meta.dirname, ${CORE_AREAS_OFF_SOURCE} })\n`,
      ...Object.fromEntries(
        [1, 2, 3, 4].map((index) => [`src/a${String(index)}.ts`, 'export const a = 1\n']),
      ),
    })
    const { stderr } = await runNode([eslintBin, '--concurrency', '2', '.'], { cwd: project.dir })
    expect(stderr.split('GPAHAL_DEFAULT_PROJECT_NODE_TYPES')).toHaveLength(2)
  })
})

describe('the large default project warning', () => {
  // A project of `count` files outside every tsconfig, counting `eslint.config.mjs`
  const configFiles = (count: number) => ({
    ...TYPES_NODE,
    'tsconfig.json': NODE_TSCONFIG,
    ...SRC,
    ...Object.fromEntries(
      Array.from({ length: count - 1 }, (_, i) => [`c${String(i).padStart(2, '0')}.config.ts`, '']),
    ),
  })

  it('warns once when more than 16 files are in the default project', async () => {
    await using project = await withProject(configFiles(17))
    expect(warningsOf(project.dir)).toEqual([
      [
        "@gpahal/eslint-config: `typeAware.allowDefaultProject`: 17 files, such as `c00.config.ts`, `c01.config.ts`, `c02.config.ts` and 14 more, get type information from typescript-eslint's default project, which takes about 8 times as long per file as a tsconfig's. Include them in a tsconfig, list the ones to type in `typeAware.allowDefaultProject`, or ignore folders such as fixtures with `ignores`",
        'GPAHAL_LARGE_DEFAULT_PROJECT',
      ],
    ])
    expect(warningsOf(project.dir)).toEqual([])
  })
})

describe('GPAHAL_ASTRO_TYPES_MISSING', () => {
  const ASTRO_TSCONFIG = Object.fromEntries(
    ['package.json', 'base.json', 'astro.json', 'astro-app.json'].map((name) => [
      `node_modules/@gpahal/tsconfig/${name}`,
      syncFs.readFileSync(path.join(TSCONFIG_DIR, name), 'utf8'),
    ]),
  )

  it("warns with the recipe's tsconfig while the types it includes are missing", async () => {
    await using project = await withProject({
      'package.json': '{ "private": true, "type": "module" }\n',
      'src/pages/index.astro': '<h1>Hi</h1>\n',
      'tsconfig.json': '{ "extends": "@gpahal/tsconfig/astro-app" }\n',
      ...ASTRO_TSCONFIG,
    })
    const messages = warningsOf(project.dir, { astro: true })
      .filter(([, code]) => code === 'GPAHAL_ASTRO_TYPES_MISSING')
      .map(([message]) => message)
    expect(messages).toEqual([
      expect.stringContaining("includes `.astro/types.d.ts`, which doesn't exist"),
    ])
  })
})

describe('GPAHAL_FILES_OUTSIDE_TSCONFIG', () => {
  /**
   * `count` scripts that `NODE_TSCONFIG` leaves out
   */
  function scripts(count: number): Record<string, string> {
    return Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `scripts/s${String(index).padStart(2, '0')}.ts`,
        'export const a = 1\n',
      ]),
    )
  }

  const BASE = { ...TYPES_NODE, 'tsconfig.json': NODE_TSCONFIG, ...SRC }

  function outsideWarnings(root: string, options: Omit<EslintConfigOptions, 'root'> = {}) {
    return warningsOf(root, options).filter(([, code]) => code === 'GPAHAL_FILES_OUTSIDE_TSCONFIG')
  }

  it('names 10 files and counts the rest, once', async () => {
    await using project = await withProject({ ...BASE, ...scripts(12) })
    const names = Array.from({ length: 10 }, (_, index) => `\`scripts/s0${String(index)}.ts\``)
    expect(outsideWarnings(project.dir)).toEqual([
      [
        `@gpahal/eslint-config: \`typeAware\`: 12 TypeScript files in the project, ${names.join(', ')} and 2 more, are in no tsconfig's project, so typescript-eslint's project service reports each as not found when it lints them. Add them to a tsconfig's \`include\`, or to \`typeAware.allowDefaultProject\``,
        'GPAHAL_FILES_OUTSIDE_TSCONFIG',
      ],
    ])
    expect(outsideWarnings(project.dir)).toEqual([])
  })

  it.each<[string, Record<string, string>, Omit<EslintConfigOptions, 'root'>]>([
    [
      "a nested tsconfig includes the files that root's leaves out",
      { 'scripts/tsconfig.json': NODE_TSCONFIG.replace('"src"', '"*.ts"'), ...scripts(2) },
      {},
    ],
    [
      "a function's glob adds the files to the default project",
      scripts(2),
      { typeAware: { allowDefaultProject: (defaults) => [...defaults, 'scripts/*.ts'] } },
    ],
    [
      'the ignores leave the files out',
      scripts(2),
      { ignores: (defaults) => [...defaults, 'scripts'] },
    ],
  ])("doesn't warn when %s", async (_name, files, options) => {
    await using project = await withProject({ ...BASE, ...files })
    expect(outsideWarnings(project.dir, options)).toEqual([])
  })

  it('leaves out the files that a global ignores config of a composer method ignores, once ESLint awaits the composer', async () => {
    await using project = await withProject({
      ...BASE,
      'tools/t.ts': 'export const t = 1\n',
      ...scripts(2),
    })
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined)
    const namedFiles = () =>
      emitWarning.mock.calls
        .filter(
          ([, options]) => isRecord(options) && options.code === 'GPAHAL_FILES_OUTSIDE_TSCONFIG',
        )
        .map(([message]) => String(message).match(/`[^`]+\.ts`/g))
    try {
      const composer = defineConfig({ root: project.dir }).insertBefore('gpahal/ignores/defaults', {
        ignores: ['scripts/**'],
      })
      expect(namedFiles()).toEqual([])
      await composer
      expect(namedFiles()).toEqual([['`tools/t.ts`']])
    } finally {
      emitWarning.mockRestore()
    }
  })
})
