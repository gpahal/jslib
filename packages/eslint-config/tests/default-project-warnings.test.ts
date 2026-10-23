import syncFs from 'node:fs'
import path from 'node:path'

import { defineConfig, type EslintConfigOptions } from '@/index'
import { checkDefaultProjectTsconfig } from '@/internal/default-project'

import { captureWarnings, warningsOf, withProject, type Warnings } from './helpers'

const TSCONFIG_DIR = path.join(import.meta.dirname, '..', '..', 'tsconfig')

const TYPES_NODE = {
  'node_modules/@types/node/package.json': '{ "name": "@types/node", "version": "24.0.0" }\n',
}

const NODE_TSCONFIG = '{ "compilerOptions": { "types": ["node"] }, "include": ["src"] }\n'

const SRC = { 'src/a.ts': 'export const a = 1\n' }

/**
 * The tsconfigs of the Astro recipe, as `@gpahal/tsconfig` installs them
 */
const ASTRO_TSCONFIG = Object.fromEntries(
  ['package.json', 'base.json', 'node.json', 'astro.json', 'astro-app.json'].map((name) => [
    `node_modules/@gpahal/tsconfig/${name}`,
    syncFs.readFileSync(path.join(TSCONFIG_DIR, name), 'utf8'),
  ]),
)

/**
 * The projects whose setup warnings `warns of …` snapshots: each project's files, the folder of it
 * that is `root`, and the options
 */
const WARNING_PROJECTS: Array<
  [
    name: string,
    files: Record<string, string>,
    root: string,
    options: Omit<EslintConfigOptions, 'root'>,
  ]
> = [
  [
    'a package without a root tsconfig, a Playwright testDir its files miss, and a slow .gitignore rule, in a folder a parent .gitignore ignores',
    {
      '.git/HEAD': '',
      '.gitignore': 'app/\n',
      'app/eslint.config.mjs': 'export default []\n',
      'app/package.json': '{ "type": "module", "devDependencies": { "@playwright/test": "*" } }\n',
      'app/packages/a/tsconfig.json': '{ "include": ["src"] }\n',
      'app/packages/a/src/a.ts': 'export const a = 1\n',
      'app/playwright.config.ts': "export default { testDir: './tests' }\n",
      'app/tests/example.spec.ts': '',
      'app/src/.gitignore': `# Generated\n${'a*'.repeat(8)}b\n\n${'a*'.repeat(3)}c\n${'a*'.repeat(8)}b/\n`,
    },
    'app',
    { playwright: true },
  ],
  [
    'TypeScript files without a tsconfig, in a folder a parent .gitignore of `*` ignores',
    {
      '.git/HEAD': '',
      '.gitignore': '*\n',
      'app/eslint.config.mjs': 'export default []\n',
      'app/src/a.ts': 'export const a = 1\n',
    },
    'app',
    {},
  ],
  ['TypeScript files without a tsconfig', SRC, '.', {}],
  [
    "a root tsconfig without Node's types, and many files outside it",
    {
      'tsconfig.json': '{ "include": ["src"] }\n',
      ...SRC,
      ...Object.fromEntries(
        Array.from({ length: 16 }, (_, i) => [`c${String(i).padStart(2, '0')}.config.ts`, '']),
      ),
      ...Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `scripts/s${String(i).padStart(2, '0')}.ts`,
          'export const a = 1\n',
        ]),
      ),
    },
    '.',
    {},
  ],
  [
    "an Astro project with the recipe's tsconfig before `astro sync`",
    {
      'package.json': '{ "private": true, "type": "module" }\n',
      'src/pages/index.astro': '<h1>Hi</h1>\n',
      'tsconfig.json': '{ "extends": "@gpahal/tsconfig/astro-app" }\n',
      ...ASTRO_TSCONFIG,
    },
    '.',
    { astro: true },
  ],
]

test('warns of each setup problem once per root', async () => {
  const snapshot: Record<string, Array<[string | undefined, string]>> = {}
  for (const [name, files, root, options] of WARNING_PROJECTS) {
    await using project = await withProject(files)
    const dir = path.join(project.dir, root)
    snapshot[name] = warningsOf(dir, options).map(([message, code]) => [
      code,
      message.replaceAll(project.dir, '<project>'),
    ])
    expect(warningsOf(dir, options), name).toEqual([])
  }
  expect(snapshot).toMatchSnapshot()
})

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
})

describe('GPAHAL_ASTRO_TYPES_MISSING', () => {
  // As `pnpm create astro --template minimal` starts: no TypeScript file until `astro sync` writes
  // `.astro/types.d.ts`, which the Astro recipe's tsconfig includes
  it("doesn't warn of a project with only .astro sources once `astro sync` writes its types", async () => {
    await using project = await withProject({
      'package.json': '{ "private": true, "type": "module", "dependencies": { "astro": "*" } }\n',
      '.gitignore': 'node_modules\n.astro\ndist\n',
      '.astro/types.d.ts': '/// <reference types="astro/client" />\n',
      'astro.config.mjs': 'export default {}\n',
      'src/pages/index.astro': '---\nconst title = "Home"\n---\n\n<h1>{title}</h1>\n',
      'tsconfig.json':
        '{ "extends": "@gpahal/tsconfig/astro-app", "references": [{ "path": "./tsconfig.node.json" }] }\n',
      'tsconfig.node.json':
        '{ "extends": ["@gpahal/tsconfig/base", "@gpahal/tsconfig/node"], "compilerOptions": { "composite": true, "allowJs": true, "checkJs": true }, "include": ["*.config.*"] }\n',
      ...ASTRO_TSCONFIG,
      ...TYPES_NODE,
    })
    const warnings = await captureWarnings(async () => {
      await defineConfig({ root: project.dir, astro: true })
    })
    expect(warnings).toEqual([])
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
    [
      'the ignores leave the files out with a leading `./`, which ESLint drops',
      scripts(2),
      { ignores: (defaults) => [...defaults, './scripts/**'] },
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
    const namedFiles = (warnings: Warnings) =>
      warnings
        .filter(([, code]) => code === 'GPAHAL_FILES_OUTSIDE_TSCONFIG')
        .map(([message]) => message.match(/`[^`]+\.ts`/g))
    await captureWarnings(async (warnings) => {
      const composer = defineConfig({ root: project.dir }).insertBefore('gpahal/ignores/defaults', {
        ignores: ['scripts/**'],
      })
      expect(namedFiles(warnings)).toEqual([])
      await composer
      expect(namedFiles(warnings)).toEqual([['`tools/t.ts`']])
    })
  })
})
