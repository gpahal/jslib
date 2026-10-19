import { readdirSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import ts from 'typescript'

import { runNode, runNodeOk, withTmpProject, writeFiles } from '@gpahal/internal/node/testing'

const PRESETS_DIR = path.join(import.meta.dirname, '..')

const PRESETS = readdirSync(PRESETS_DIR).filter(
  (name) => name.endsWith('.json') && name !== 'package.json' && name !== 'tsconfig.json',
)

const require = createRequire(import.meta.url)

const TSC_BIN = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc')

/**
 * `tsc`'s defaults for unset options, and its `--showConfig` output. Internal, but what `tsc` uses
 */
const { computedOptions, convertToTSConfig } = ts as typeof ts & {
  computedOptions: Record<string, { computeValue: (options: ts.CompilerOptions) => unknown }>
  convertToTSConfig: (
    parsed: ts.ParsedCommandLine,
    configFileName: string,
    host: ts.System,
  ) => { compilerOptions: unknown }
}

/**
 * The errors that `tsc` reports for the project `config` in `dir`, as `<file>: TS<code>`
 */
async function tscErrors(dir: string, config = 'tsconfig.json'): Promise<Array<string>> {
  const { stdout, stderr } = await runNode([TSC_BIN, '-p', config], { cwd: dir })
  expect(stderr).toBe('')
  return stdout
    .matchAll(/^(?<file>\S+)\(\d+,\d+\): error (?<code>TS\d+)/gm)
    .map(({ groups }) => `${groups!['file']!}: ${groups!['code']!}`)
    .toArray()
}

/**
 * Virtual, but inside the repo so that `@types/node` resolves
 */
const PROJECT_DIR = path.join(import.meta.dirname, 'virtual-project')

/**
 * Lib files and `@types/node`, parsed once for all tests
 */
const SHARED_SOURCE_FILES = new Map<string, ts.SourceFile>()

/**
 * Typecheck an in-memory project whose tsconfig extends `presets`, ESM unless `packageJson` says
 * otherwise
 *
 * @returns The diagnostics as `TS<code>` strings.
 */
function typecheck(
  presets: Array<string>,
  files: Record<string, string>,
  packageJson?: Record<string, unknown>,
): Array<string> {
  const tsconfig = {
    extends: presets.map((preset) => path.join(PRESETS_DIR, preset)),
    files: Object.keys(files).filter((name) => /\.(?:[cm]?ts|tsx)$/.test(name)),
  }
  const projectFiles = {
    'package.json': JSON.stringify(packageJson ?? { type: 'module' }),
    'tsconfig.json': JSON.stringify(tsconfig),
    ...files,
  }
  // On a case-insensitive disk TypeScript looks files up by their lowercased path
  const toKey = (fileName: string) =>
    ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase()
  const virtualFiles = new Map<string, string>()
  for (const [name, content] of Object.entries(projectFiles)) {
    virtualFiles.set(toKey(path.join(PROJECT_DIR, name)), content)
  }
  const overrides = {
    readFile: (fileName: string) => virtualFiles.get(toKey(fileName)) ?? ts.sys.readFile(fileName),
    fileExists: (fileName: string) =>
      virtualFiles.has(toKey(fileName)) || ts.sys.fileExists(fileName),
    directoryExists: (dirName: string) =>
      toKey(dirName) === toKey(PROJECT_DIR) || ts.sys.directoryExists(dirName),
  }

  const parsed = parseConfig(path.join(PROJECT_DIR, 'tsconfig.json'), overrides)
  const host = Object.assign(ts.createCompilerHost(parsed.options), overrides)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    if (fileName.startsWith(`${PROJECT_DIR}${path.sep}`)) {
      return getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
    }
    const options =
      typeof languageVersionOrOptions === 'object'
        ? languageVersionOrOptions
        : { languageVersion: languageVersionOrOptions }
    const key = [
      fileName,
      options.languageVersion,
      options.impliedNodeFormat,
      options.jsDocParsingMode,
    ].join('\0')
    let sourceFile = SHARED_SOURCE_FILES.get(key)
    if (!sourceFile) {
      sourceFile = getSourceFile(fileName, languageVersionOrOptions, onError)
      if (sourceFile) {
        SHARED_SOURCE_FILES.set(key, sourceFile)
      }
    }
    return sourceFile
  }
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, host })
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(
    (diagnostic) => `TS${diagnostic.code}`,
  )
}

function parseConfig(configPath: string, overrides: Partial<ts.System> = {}): ts.ParsedCommandLine {
  return ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      ...overrides,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    },
  )!
}

/**
 * Inside the repo, so that `@types/node` resolves, and gitignored
 */
const SNIPPETS_DIR = path.join(import.meta.dirname, 'tmp')

afterAll(async () => {
  await fs.rm(SNIPPETS_DIR, { recursive: true, force: true })
})

/**
 * Write `files` to a new folder under `SNIPPETS_DIR`
 */
async function writeProject(
  prefix: string,
  files: Record<string, string>,
): Promise<AsyncDisposable & { path: string }> {
  await fs.mkdir(SNIPPETS_DIR, { recursive: true })
  const dir = await fs.mkdtempDisposable(path.join(SNIPPETS_DIR, prefix))
  await writeFiles(dir.path, files)
  return dir
}

// Catches an option flipped or dropped by mistake. Review a changed snapshot against the README
test.concurrent.for(PRESETS)(
  '%s resolves to the options in the snapshot',
  { timeout: 30_000 },
  async (preset, { expect }) => {
    await using dir = await writeProject('show-config-', {
      'tsconfig.json': JSON.stringify({ extends: path.join(PRESETS_DIR, preset) }),
      'a.ts': 'export {}\n',
    })
    const configPath = path.join(dir.path, 'tsconfig.json')
    const parsed = parseConfig(configPath)
    expect(parsed.errors).toEqual([])
    // What `tsc --showConfig` prints. The JSON round trip drops `undefined` values as `tsc` does
    // eslint-disable-next-line unicorn/prefer-structured-clone -- `structuredClone` keeps `undefined`
    const shown = JSON.parse(JSON.stringify(convertToTSConfig(parsed, configPath, ts.sys))) as {
      compilerOptions: unknown
    }
    expect(shown.compilerOptions).toMatchSnapshot()
  },
)

// tsconfck, which Vite 7, Vitest 4 and vite-tsconfig-paths use, throws on a `null` in an extended
// config
test('no preset has a null value', () => {
  const hasNull = (value: unknown): boolean =>
    value === null ||
    (typeof value === 'object' && Object.values(value).some((item) => hasNull(item)))
  expect(
    PRESETS.filter((preset) =>
      hasNull(JSON.parse(readFileSync(path.join(PRESETS_DIR, preset), 'utf8'))),
    ),
  ).toEqual([])
})

test('base.json types ES2025 APIs without Node or the DOM', { timeout: 30_000 }, () => {
  expect(typecheck(['base.json'], { 'a.ts': 'void Promise.try(() => 1)' })).toEqual([])
  expect(typecheck(['base.json'], { 'a.ts': 'export const a = document' })).toEqual(['TS2584'])
})

test(
  'nodenext.json rejects relative imports that fail at runtime in Node',
  { timeout: 30_000 },
  () => {
    const files = { 'b.ts': 'export const b = 1' }
    expect(
      typecheck(['base.json', 'nodenext.json'], {
        ...files,
        'a.ts': "import { b } from './b'\nexport const a = b",
      }),
    ).toEqual(['TS2835'])
    expect(
      typecheck(['base.json', 'nodenext.json', 'node.json'], {
        ...files,
        'a.ts':
          "import { readFile } from 'node:fs/promises'\nimport { b } from './b.js'\nexport const a = [b, readFile]",
      }),
    ).toEqual([])
  },
)

test('node.json types only the ESNext APIs that Node 24 has', { timeout: 30_000 }, () => {
  const presets = ['base.json', 'node.json']
  expect(
    typecheck(presets, {
      'a.ts':
        'Atomics.pause()\nexport const a = [await Array.fromAsync([1]), Error.isError(new Error())]',
    }),
  ).toEqual([])
  expect(typecheck(presets, { 'a.ts': 'new Map<number, number>().getOrInsert(1, 2)' })).toEqual([
    'TS2550',
  ])
})

test(
  'node-strip-types.json allows the .ts imports that Node type stripping needs',
  { timeout: 30_000 },
  () => {
    const presets = ['base.json', 'nodenext.json', 'node.json', 'erasable.json']
    const files = {
      'b.ts': 'export const b = 1',
      'a.ts': "import { b } from './b.ts'\nexport const a = b",
    }
    expect(typecheck(presets, files)).toEqual(['TS5097'])
    expect(typecheck([...presets, 'node-strip-types.json'], files)).toEqual([])
  },
)

test('node-app.json checks code for Node type stripping', { timeout: 30_000 }, () => {
  expect(typecheck(['node-app.json'], { 'a.ts': 'export enum E {\n  A,\n}' })).toEqual(['TS1294'])
  expect(typecheck(['node-app.json'], { 'a.ts': 'export const a = document' })).toEqual(['TS2584'])
  // Without `"type": "module"`, `nodenext` treats `.ts` files as CommonJS, where
  // `verbatimModuleSyntax` rejects ESM syntax
  expect(
    typecheck(
      ['node-app.json'],
      { 'a.ts': "import { readFile } from 'node:fs/promises'\nexport const a = readFile" },
      {},
    ),
  ).toEqual(['TS1295', 'TS1287'])
})

/**
 * A minimal stand-in for `@types/react`'s JSX runtime
 */
const JSX_RUNTIME = {
  'jsx-runtime.d.ts': `declare module 'react/jsx-runtime' {
  export namespace JSX {
    type Element = { type: unknown }
    type IntrinsicElements = { div: { className?: string } }
  }
  export function jsx(type: unknown, props: unknown): JSX.Element
  export function jsxs(type: unknown, props: unknown): JSX.Element
  export const Fragment: unique symbol
}`,
}

test.each(['react-app.json', 'nextjs-app.json'])(
  '%s type-checks JSX',
  { timeout: 30_000 },
  (preset) => {
    expect(
      typecheck([preset], { ...JSX_RUNTIME, 'a.tsx': 'export const a = <div className="a" />' }),
    ).toEqual([])
    expect(
      typecheck([preset], { ...JSX_RUNTIME, 'a.tsx': 'export const a = <div clasName="a" />' }),
    ).toEqual(['TS2322'])
  },
)

test.each(['browser-app.json', 'react-app.json', 'nextjs-app.json', 'astro-app.json'])(
  '%s types ES2024 APIs and the DOM, but not ES2025 ones',
  { timeout: 30_000 },
  (preset) => {
    expect(
      typecheck([preset], {
        'a.ts':
          'export const a = [Object.groupBy([1], () => 1), Promise.withResolvers(), document]',
      }),
    ).toEqual([])
    expect(typecheck([preset], { 'a.ts': 'void Promise.try(() => 1)' })).toEqual(['TS2550'])
  },
)

test.each([
  [['base.json'], []],
  [['base.json', 'node.json'], ['node']],
  [['node-app.json'], ['node']],
  [['nextjs-app.json'], ['node']],
  [['react-app.json'], []],
  [['astro-app.json'], []],
] as const)('%j types %j', async (presets, types) => {
  await using dir = await writeProject('types-', {
    'tsconfig.json': JSON.stringify({
      extends: presets.map((preset) => path.join(PRESETS_DIR, preset)),
      files: [],
    }),
  })
  expect(parseConfig(path.join(dir.path, 'tsconfig.json')).options.types).toEqual(types)
})

// `next build` type-checks with these unless the tsconfig sets them, and doesn't rewrite a tsconfig
// that has `extends`
test('nextjs-app.json has the options that next build requires', () => {
  const options = parseConfig(path.join(PRESETS_DIR, 'nextjs-app.json')).options
  expect(options).toMatchObject({
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
  })
  for (const option of ['esModuleInterop', 'resolveJsonModule', 'isolatedModules']) {
    expect([option, computedOptions[option]!.computeValue(options)]).toEqual([option, true])
  }
})

test(
  'library-tests.json lets tests export values without explicit types',
  { timeout: 30_000 },
  () => {
    const files = {
      'a.ts': 'export function sum(a: number, b: number) {\n  return a + b\n}',
    }
    expect(typecheck(['base.json', 'library.json'], files)).toEqual(['TS9007'])
    expect(typecheck(['base.json', 'library.json', 'library-tests.json'], files)).toEqual([])
  },
)

test.each([
  ['emitDeclarationOnly', { emitDeclarationOnly: true }, {}],
  // The preset can't clear `declarationDir`, so the tests' tsconfig does, as the README says
  ['declarationDir', { declarationDir: 'types' }, { declarationDir: null }],
  ['composite', { composite: true }, {}],
] as const)(
  'library-tests.json type-checks tests inheriting %s without emitting',
  { timeout: 60_000 },
  async (_, compilerOptions, testsCompilerOptions) => {
    await using dir = await writeProject('library-tests-', {
      'tsconfig.json': JSON.stringify({
        extends: ['base.json', 'library.json'].map((preset) => path.join(PRESETS_DIR, preset)),
        compilerOptions: { noEmit: false, rootDir: 'src', outDir: 'dist', ...compilerOptions },
        include: ['src'],
      }),
      'tests/tsconfig.json': JSON.stringify({
        extends: ['../tsconfig.json', path.join(PRESETS_DIR, 'library-tests.json')],
        compilerOptions: { rootDir: '..', ...testsCompilerOptions },
        include: ['**/*'],
      }),
      'src/a.ts': 'export const a: number = 1\n',
      'tests/a.test.ts':
        "import { a } from '../src/a.js'\n\nexport function b() {\n  return a\n}\n",
    })
    await expect(tscErrors(dir.path, 'tests')).resolves.toEqual([])
    await expect(fs.readdir(path.join(dir.path, 'tests'))).resolves.toEqual(
      expect.not.arrayContaining([expect.stringMatching(/\.(?:js|d\.ts)$/)]),
    )
  },
)

/**
 * A `node-app` with a relative `.ts` import, a type-only import, a JSON import, `using` and ES2025
 * and ESNext APIs
 */
const NODE_APP = {
  'package.json': JSON.stringify({ type: 'module' }),
  'tsconfig.json': JSON.stringify({ extends: path.join(PRESETS_DIR, 'node-app.json') }),
  'src/data.json': '{ "n": 2 }\n',
  'src/lib.ts':
    'export type Box = { n: number }\n\nexport const double = (n: number): number => n * 2\n',
  'src/main.ts': [
    "import data from './data.json' with { type: 'json' }",
    "import type { Box } from './lib.ts'",
    "import { double } from './lib.ts'",
    '',
    'const box: Box = data',
    'const log: Array<unknown> = []',
    '{',
    '  using stack = new DisposableStack()',
    "  stack.defer(() => log.push('disposed'))",
    '}',
    'log.push(double(box.n), Error.isError(new Error()), await Promise.try(() => 1))',
    'console.log(JSON.stringify(log))',
    '',
  ].join('\n'),
}

const NODE_APP_OUTPUT = ['disposed', 4, true, 1]

test(
  'Node runs the node-app sources, and tsc emits them for Node',
  { timeout: 60_000 },
  async () => {
    await using dir = await writeProject('node-app-', NODE_APP)
    await expect(tscErrors(dir.path)).resolves.toEqual([])
    expect(JSON.parse(await runNodeOk(['src/main.ts'], { cwd: dir.path }))).toEqual(NODE_APP_OUTPUT)

    await writeFiles(dir.path, {
      'tsconfig.json': JSON.stringify({
        extends: path.join(PRESETS_DIR, 'node-app.json'),
        compilerOptions: { noEmit: false, rootDir: 'src', outDir: 'dist' },
      }),
    })
    await expect(tscErrors(dir.path)).resolves.toEqual([])
    expect(JSON.parse(await runNodeOk(['dist/main.js'], { cwd: dir.path }))).toEqual(
      NODE_APP_OUTPUT,
    )
  },
)

// Canary for the README's warnings in "A Node app that strips types": node-app type-checks this
// code, which Node can't run. Fails when Node starts running it, so the warning can go
test(
  'Node fails to run code that node-app type-checks, as the README warns',
  { timeout: 30_000 },
  async () => {
    await using dir = await writeProject('node-app-unrunnable-', {
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
        const { status, stderr } = await runNode([file], { cwd: dir.path })
        return [file, status, /ERR_MODULE_NOT_FOUND|SyntaxError/.exec(stderr)?.[0]]
      }),
    )
    expect(failures).toEqual([
      ['src/js-specifier.ts', 1, 'ERR_MODULE_NOT_FOUND'],
      ['src/decorator.ts', 1, 'SyntaxError'],
      ['src/accessor.ts', 1, 'SyntaxError'],
    ])
  },
)

/**
 * The files of a consumer in `apps/web` of a workspace
 */
const CONSUMER_FILES = [
  'next-env.d.ts',
  'vite.config.ts',
  'src/a.ts',
  'src/a.config.ts',
  'dist/a.ts',
  'build/a.ts',
  'coverage/a.ts',
  'out/a.ts',
  'node_modules/x/a.ts',
  '.next/types/a.ts',
  '.next/dev/types/a.ts',
  '.next/cache/a.ts',
  '.astro/types.d.ts',
]

// The browser presets other than `nextjs-app`, whose types include Node's, leave root config files
// to a Node tsconfig
test.each([
  ['browser-app.json', ['next-env.d.ts', 'src/a.ts', 'src/a.config.ts']],
  ['react-app.json', ['next-env.d.ts', 'src/a.ts', 'src/a.config.ts']],
  [
    'nextjs-app.json',
    [
      'next-env.d.ts',
      'vite.config.ts',
      'src/a.ts',
      'src/a.config.ts',
      '.next/types/a.ts',
      '.next/dev/types/a.ts',
    ],
  ],
  ['astro-app.json', ['next-env.d.ts', 'src/a.ts', 'src/a.config.ts', '.astro/types.d.ts']],
  ['node-app.json', ['next-env.d.ts', 'vite.config.ts', 'src/a.ts', 'src/a.config.ts']],
])('%s includes the files of the folder of the tsconfig that extends it', async (preset, files) => {
  const tsconfig = { extends: path.join(PRESETS_DIR, preset), compilerOptions: { types: [] } }
  await using project = await withTmpProject('tsconfig-include', {
    ...Object.fromEntries(
      [...CONSUMER_FILES.map((name) => `apps/web/${name}`), 'apps/other/a.ts'].map((file) => [
        file,
        'export {}\n',
      ]),
    ),
    'apps/web/tsconfig.json': JSON.stringify(tsconfig),
  })
  const consumerDir = path.join(project.dir, 'apps/web')
  const parsed = parseConfig(path.join(consumerDir, 'tsconfig.json'))
  expect(parsed.errors).toEqual([])
  expect(relativeFiles(consumerDir, parsed.fileNames)).toEqual(new Set(files))
})

/**
 * The JSON code blocks of the README, each with the file name of its first-line comment, if any
 */
const README_JSON_BLOCKS = readFileSync(path.join(PRESETS_DIR, 'README.md'), 'utf8')
  .matchAll(/^```json\n(?:\/\/ (?<name>\S+)\n)?(?<code>.*?)^```$/gms)
  .map(({ groups }) => ({ name: groups!['name'], code: groups!['code']! }))
  .toArray()

/**
 * The README's unnamed root tsconfig snippets, without the tests' ones
 */
const README_SNIPPETS = README_JSON_BLOCKS.filter(
  ({ name, code }) =>
    name === undefined && code.includes('"extends"') && !code.includes('"../tsconfig.json"'),
).map(({ code }) => [JSON.stringify((JSON.parse(code) as { extends: unknown }).extends), code])

/**
 * The files of the README's root config files recipe, by name
 */
const ROOT_CONFIG_RECIPE = Object.fromEntries(
  README_JSON_BLOCKS.flatMap(({ name, code }) => (name === undefined ? [] : [[name, code]])),
)

/**
 * The README's `typecheck` script, split into words
 */
const [TYPECHECK_COMMAND, ...TYPECHECK_ARGS] = (
  JSON.parse(README_JSON_BLOCKS.find(({ code }) => code.includes('"typecheck"'))!.code) as {
    scripts: { typecheck: string }
  }
).scripts.typecheck.split(' ')

// Guards the snippet-driven tests against the README losing the snippets they run
test('the README has the snippets that the tests run', () => {
  expect(README_SNIPPETS.length).toBeGreaterThanOrEqual(7)
  expect(new Set(Object.keys(ROOT_CONFIG_RECIPE))).toEqual(
    new Set(['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']),
  )
  expect(TYPECHECK_COMMAND).toBe('tsc')
})

function relativeFiles(dir: string, fileNames: ReadonlyArray<string>): Set<string> {
  return new Set(fileNames.map((name) => path.relative(dir, name).replaceAll('\\', '/')))
}

/**
 * Replace the presets of a README snippet with their paths
 */
function resolveSnippet(snippet: string): string {
  return snippet.replaceAll(/@gpahal\/tsconfig\/([\w-]+)/g, (_, preset: string) =>
    path.join(PRESETS_DIR, `${preset}.json`),
  )
}

/**
 * A stand-in for Vite's `vite/client` types, which declare CSS and asset modules
 */
const VITE_CLIENT = {
  'node_modules/vite/package.json': JSON.stringify({
    name: 'vite',
    version: '0.0.0',
    exports: { './client': { types: './client.d.ts' } },
  }),
  'node_modules/vite/client.d.ts':
    "declare module '*.css' {}\ndeclare module '*.svg' {\n  const src: string\n  export default src\n}\n",
}

test.each(README_SNIPPETS)(
  'the README snippet extending %s compiles',
  { timeout: 30_000 },
  async (_, snippet) => {
    await using dir = await writeProject('snippet-', {
      ...VITE_CLIENT,
      'package.json': JSON.stringify({ type: 'module' }),
      'tsconfig.json': resolveSnippet(snippet),
      'src/a.ts': 'export const a: number = 1\n',
      'tests/a.test.ts': 'export const b: number = 1\n',
    })
    const parsed = parseConfig(path.join(dir.path, 'tsconfig.json'))
    // The apps include every file, and the others list their folders
    expect(relativeFiles(dir.path, parsed.fileNames)).toEqual(
      new Set(
        snippet.includes('"include": ["src"]') ? ['src/a.ts'] : ['src/a.ts', 'tests/a.test.ts'],
      ),
    )
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
    expect(
      [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      ),
    ).toEqual([])
  },
)

test.each([
  [
    'react-app',
    'vite.config.ts',
    "import path from 'node:path'\n\nexport default { root: path.join(import.meta.dirname, 'src') }\n",
  ],
  // A JavaScript root config file, as a stock Astro app has
  ['astro-app', 'astro.config.mjs', 'export default { site: process.env.SITE }\n'],
])(
  'the README root config files recipe type-checks %s and the root %s',
  { timeout: 30_000 },
  async (preset, configFile, config) => {
    const recipe = Object.fromEntries(
      Object.entries(ROOT_CONFIG_RECIPE).map(([name, code]) => [
        name,
        resolveSnippet(
          code.replaceAll('@gpahal/tsconfig/react-app', () => `@gpahal/tsconfig/${preset}`),
        ),
      ]),
    )
    await using dir = await writeProject('root-config-recipe-', {
      ...VITE_CLIENT,
      'package.json': JSON.stringify({ type: 'module' }),
      ...recipe,
      [configFile]: config,
      'src/a.ts': "export const link: HTMLAnchorElement | null = document.querySelector('a')\n",
    })
    const parsed = parseConfig(path.join(dir.path, 'tsconfig.node.json'))
    expect(relativeFiles(dir.path, parsed.fileNames)).toEqual(new Set([configFile]))
    await expect(runNodeOk([TSC_BIN, ...TYPECHECK_ARGS], { cwd: dir.path })).resolves.toBe('')
  },
)
