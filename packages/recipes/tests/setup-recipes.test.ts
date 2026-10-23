import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import * as prettier from 'prettier'
import type { ExpectStatic } from 'vitest'

import {
  readCodeBlocks,
  readMarkdownSection,
  splitFileNameComment,
  withTmpProject,
  writeFiles,
} from '@gpahal/internal/node/testing'
import prettierConfig from '@gpahal/prettier-config'
import { describeValue, formatMessage } from '@gpahal/std/errors'

// Writes each setup recipe of the README into a project laid out as pnpm installs it and runs its
// check script. `FIXER_CASES` run the README's fixers first, and the check shows a second run
// would change nothing. `CHECK_CASES` start from sources as the fixers leave them

const PACKAGE_DIR = path.join(import.meta.dirname, '..')
const REPO_DIR = path.join(PACKAGE_DIR, '../..')
const README = await fs.readFile(path.join(REPO_DIR, 'README.md'), 'utf8')

/**
 * The folders whose `node_modules` hold the recipes' third-party packages, as this workspace installs
 * them: this package's for the apps' frameworks, and the config packages' for the linters and their
 * plugins
 */
const SOURCE_DIRS = ['recipes', 'stylelint-config', 'eslint-config', 'prettier-config'].map(
  (name) => path.join(REPO_DIR, 'packages', name),
)
SOURCE_DIRS.push(REPO_DIR)

/**
 * The text of the README section under `heading`, up to the next heading of its level or higher
 */
function section(heading: string): string {
  const text = readMarkdownSection(README, heading)
  if (text === undefined) {
    throw new Error(
      formatMessage(
        '@gpahal/recipes',
        ['README recipe'],
        `section ${describeValue(heading)} is missing`,
      ),
    )
  }
  return text
}

type Recipe = {
  /**
   * The packages of its `pnpm add -D` command, without version suffixes
   */
  packages: Array<string>
  /**
   * Its files, by the name in each block's first-line comment
   */
  files: Record<string, string>
}

function readRecipe(heading: string): Recipe {
  const recipe: Recipe = { packages: [], files: {} }
  const recipeBlocks = readCodeBlocks(section(heading))
  for (const { language, code } of recipeBlocks) {
    if (language === 'sh') {
      const words = code.replaceAll('\\\n', ' ').trim().split(/\s+/)
      expect(words.slice(0, 3)).toEqual(['pnpm', 'add', '-D'])
      // Flags such as `-w`, which installs in a workspace's root
      const names = words.slice(3).filter((word) => !word.startsWith('-'))
      recipe.packages = names.map((word) => {
        const at = word.lastIndexOf('@')
        return at > 0 ? word.slice(0, at) : word
      })
      continue
    }
    const { fileName, code: text } = splitFileNameComment(code)
    if (fileName === undefined) {
      const [first = ''] = code.split('\n', 1)
      throw new Error(
        formatMessage(
          '@gpahal/recipes',
          ['README recipe', describeValue(heading)],
          `expected a file name comment, received ${describeValue(first)}`,
        ),
      )
    }
    recipe.files[fileName] = text
  }
  return recipe
}

/**
 * The shared check and fixer scripts, which a recipe's own scripts replace
 */
function readScripts(): Record<string, string> {
  const [block] = readCodeBlocks(section('### Running the fixers'))
  const { scripts } = JSON.parse(block!.code) as { scripts: Record<string, string> }
  return Object.fromEntries(
    Object.entries(scripts).filter(([name]) => /^(?:check|fix)(?::|$)/.test(name)),
  )
}

/**
 * `check` with `--max-warnings 0` on its Stylelint command, if it has one. ESLint and Prettier
 * already fail on anything their fixers would change, and with this Stylelint does too, so a
 * passing check after one fix run stands in for a second fix run that changes nothing. The
 * README's check leaves warnings out so `plugin/use-baseline` can't fail it
 */
function strictCheck(check: string): string {
  const parts = check.split(/(?<=^|&& )stylelint /)
  if (parts.length > 2) {
    throw new Error(
      formatMessage(
        '@gpahal/recipes',
        ['README recipe', '`check`'],
        `expected at most one Stylelint command, received ${describeValue(check)}`,
      ),
    )
  }
  return parts.join('stylelint --max-warnings 0 ')
}

type Manifest = {
  name: string
  version: string
  files?: Array<string>
  dependencies?: Record<string, string>
  bin?: string | Record<string, string>
}

async function readManifest(dir: string): Promise<Manifest> {
  return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as Manifest
}

async function symlink(target: string, link: string) {
  await fs.mkdir(path.dirname(link), { recursive: true })
  await fs.symlink(target, link)
}

/**
 * The real folder of the third-party package `name`, as this workspace installs it. pnpm keeps its
 * dependencies next to it
 */
async function findInstalled(name: string): Promise<string | undefined> {
  for (const dir of SOURCE_DIRS) {
    try {
      return await fs.realpath(path.join(dir, 'node_modules', name))
    } catch {
      // Not installed for this package
    }
  }
  return undefined
}

/**
 * Lays out projects as pnpm does: each package in a folder of `node_modules/.pnpm`, next to the
 * links to its dependencies, and the project's own dependencies linked in `node_modules`
 */
class Installer {
  readonly #storeDir: string
  readonly #installed = new Map<string, Promise<string>>()

  constructor(projectDir: string) {
    this.#storeDir = path.join(projectDir, 'node_modules/.pnpm')
  }

  /**
   * The folder of `name` in the store. A workspace package gets its published files: the build,
   * with `@gpahal/std` installed the same way, and no sources
   */
  async package(name: string): Promise<string> {
    let dir = this.#installed.get(name)
    if (dir === undefined) {
      dir = this.#install(name)
      this.#installed.set(name, dir)
    }
    return dir
  }

  async #install(name: string): Promise<string> {
    if (!name.startsWith('@gpahal/')) {
      const dir = await findInstalled(name)
      if (dir === undefined) {
        throw new Error(
          formatMessage(
            '@gpahal/recipes',
            ['README recipe', describeValue(name)],
            `isn't installed in the workspace`,
          ),
        )
      }
      return dir
    }
    const sourceDir = path.join(REPO_DIR, 'packages', name.slice('@gpahal/'.length))
    const manifest = await readManifest(sourceDir)
    const dir = path.join(this.#storeDir, name.replace('/', '+'), 'node_modules', name)
    await fs.mkdir(dir, { recursive: true })
    const files = ['package.json', ...(manifest.files ?? [])]
    for (const file of files) {
      if (file !== 'src' && !file.startsWith('!')) {
        await fs.cp(path.join(sourceDir, file), path.join(dir, file), { recursive: true })
      }
    }
    const dependencies = Object.keys(manifest.dependencies ?? {})
    for (const dependency of dependencies) {
      const target = dependency.startsWith('@gpahal/')
        ? await this.package(dependency)
        : await fs.realpath(path.join(sourceDir, 'node_modules', dependency))
      await symlink(
        target,
        path.join(this.#storeDir, name.replace('/', '+'), 'node_modules', dependency),
      )
    }
    return dir
  }
}

/**
 * Runs `pnpm run <script>` in `dir` without the test runner's `NODE_PATH`, which pnpm points at the
 * workspace's packages and would hide a missing link, or its `NODE_OPTIONS`. The concurrent cases
 * can keep eslint-plugin-better-tailwindcss's Tailwind CSS workers past their 30 seconds on a CI
 * runner, so `SYNCKIT_TIMEOUT` raises it, as the task's script raises the test timeout
 */
async function runScript(
  dir: string,
  script: string,
): Promise<{ status: number | null; output: string }> {
  const child = spawn('pnpm', ['run', script], {
    cwd: dir,
    env: {
      ...process.env,
      NODE_PATH: '',
      NODE_OPTIONS: '',
      ASTRO_TELEMETRY_DISABLED: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      // Under the test timeout, so a worker that hangs still fails the case with its own error
      SYNCKIT_TIMEOUT: '300000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk
  })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (status) => {
      resolve({ status, output })
    })
  })
}

/**
 * The files of `dir` outside `node_modules`, by relative path
 */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    const file = path.relative(dir, path.join(entry.parentPath, entry.name))
    if (entry.isFile() && !file.split(path.sep).includes('node_modules')) {
      files[file.replaceAll(path.sep, '/')] = await fs.readFile(path.join(dir, file), 'utf8')
    }
  }
  return files
}

/**
 * The commands of the recipes' scripts, linked into `node_modules/.bin`
 */
const BINS = new Set(['eslint', 'prettier', 'stylelint', 'tsc', 'astro', 'next', 'tsdown'])

/**
 * CSS with a media query range for `media-feature-range-notation` to fix
 */
const CSS = '@media (max-width:100px){a{color:red}}\n'

/**
 * `CSS` as the fixers leave it
 */
const FIXED_CSS = '@media (width <= 100px) {\n  a {\n    color: red;\n  }\n}\n'

/**
 * The Astro case's `shout.ts` as the fixers leave it
 */
const FIXED_SHOUT = [
  'export function shout(name: string): string {',
  '  const text = name.toUpperCase()',
  '  return text',
  '}',
  '',
].join('\n')

/**
 * A lockfile as pnpm writes it, whose flow mappings and blank lines Prettier would rewrite
 */
const PNPM_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      eslint:
        specifier: ^10.11.0
        version: 10.11.0

packages:

  eslint@10.11.0:
    resolution: {integrity: sha512-AAAA}
    engines: {node: ^20.19.0 || ^22.13.0 || >=24}
    hasBin: true
`

const MINIMAL = '### A minimal project'
const MONOREPO = '### A pnpm monorepo'
const VITE = '### Vite with React'
const NEXTJS = '### Next.js with Tailwind CSS'
const ASTRO = '### Astro with React, Tailwind CSS and Vitest'

/**
 * An Astro page that imports an island component into its frontmatter
 */
const ASTRO_PAGE = [
  '---',
  "import Greeting from '../components/greeting.tsx'",
  '',
  "const title='Home'",
  '---',
  '<h1 class="p-4 text-brand">{title}</h1>',
  '<Greeting name="you" />',
  // `astro/no-unused-css-selector` reports a scoped style that no element uses
  '<a href="/">Home</a>',
  '<style>',
  'h1{margin:var(--space)}',
  CSS,
  '</style>',
  '',
].join('\n')

/**
 * A React island, which type-checks only against React's JSX
 */
const ASTRO_ISLAND = {
  'src/components/greeting.tsx':
    "export default function Greeting({name}:{name:string}){return <p className='text-brand'>Hello, {name}</p>}\n",
}

/**
 * A stand-in for React and its types, which the workspace doesn't install: the JSX runtime that
 * `jsxImportSource: 'react'` loads
 */
const REACT_STUB = {
  'node_modules/react/package.json': JSON.stringify({
    name: 'react',
    version: '19.2.0',
    exports: {
      './package.json': './package.json',
      './jsx-runtime': { types: './jsx-runtime.d.ts' },
    },
  }),
  'node_modules/react/jsx-runtime.d.ts': [
    'export namespace JSX {',
    '  type Element = { type: unknown }',
    '  interface ElementChildrenAttribute {',
    '    children: unknown',
    '  }',
    '  interface IntrinsicElements {',
    '    p: { className?: string; children?: unknown }',
    '  }',
    '}',
    'export function jsx(type: unknown, props: unknown): JSX.Element',
    'export function jsxs(type: unknown, props: unknown): JSX.Element',
    'export const Fragment: unique symbol',
    '',
  ].join('\n'),
}

/**
 * A global that a project's code doesn't get: its file, its source and the error of `check:types`
 */
type MissingGlobal = { file: string; source: string; error: string }

/**
 * Node's `process`, in code without Node's types
 */
function nodeGlobal(file: string): MissingGlobal {
  return {
    file,
    source: "export const mode: string = process.env['MODE'] ?? ''\n",
    error: "Cannot find name 'process'",
  }
}

/**
 * React and its types, which the Vite and Next.js apps install before their recipes
 */
const REACT_PACKAGES = ['react', 'react-dom']

const REACT_TYPES = ['@types/react', '@types/react-dom']

type Project = {
  heading: string
  /**
   * The packages the app installs before the recipe, which its command leaves out, in
   * `dependencies`
   */
  appDependencies?: Array<string>
  /**
   * The packages the app installs before the recipe in `devDependencies`
   */
  appDevDependencies?: Array<string>
  /**
   * The app's files before the recipe, such as its `.gitignore`, which the recipe's files replace
   */
  appFiles?: Record<string, string>
  sources: Record<string, string>
}

type Case = Project & {
  name: string
  /**
   * A source file with a type error, by name
   */
  invalidSource: Record<string, string>
  /**
   * Globals that the project's code mustn't type-check with
   */
  missingGlobals?: Array<MissingGlobal>
  /**
   * Sources with an error that ESLint reports and can't fix, and the files as the other fixers
   * leave them, for a `fix` run after the checks
   */
  failingFix?: { sources: Record<string, string>; rule: string; fixed: Record<string, string> }
}

/**
 * The `.gitignore` of an app that a framework's starter created
 */
const APP_GITIGNORE = 'node_modules\ndist\n*.tsbuildinfo\n'

const ASTRO_APP = {
  // As `astro add tailwind` installs it
  appDependencies: ['astro', 'tailwindcss'],
  appFiles: { '.gitignore': 'node_modules\n.astro\ndist\n', ...REACT_STUB },
}

/**
 * The cases that run the fixers before the checks, with sources unformatted and with a `let` for
 * `prefer-const` to fix
 */
const FIXER_CASES: Array<Case> = [
  {
    name: 'minimal',
    heading: MINIMAL,
    sources: {
      'src/sum.ts': 'export function sum(a:number,b:number):number{return a+b}\n',
      'src/index.ts': 'import {sum} from "./sum"\n\nlet total = sum(1,2)\n\nexport { total }\n',
      'src/styles.css': CSS,
      // Prettier adds trailing commas to the multi-line ```jsonc block, which ESLint must parse
      'README.md':
        '# Setup\n\n```jsonc\n{\n  "compilerOptions": {\n    "types": ["node"]\n  }\n}\n```\n',
    },
    invalidSource: { 'src/index.ts': 'export const title: string = 123\n' },
    // A `debugger` statement, and a `let` that `prefer-const` fixes
    failingFix: {
      sources: { 'src/debug.ts': 'let a = 1\ndebugger\nexport { a }\n', 'src/debug.css': CSS },
      rule: 'no-debugger',
      fixed: {
        'src/debug.ts': 'const a = 1\ndebugger\nexport { a }\n',
        'src/debug.css': FIXED_CSS,
      },
    },
  },
  {
    name: 'Astro',
    heading: ASTRO,
    ...ASTRO_APP,
    sources: {
      'src/lib/sum.ts': 'export function sum(a:number,b:number):number{return a+b}\n',
      'src/lib/sum.test.ts':
        "import {describe,expect,it} from 'vitest'\n\nimport {sum} from './sum'\n\ndescribe('sum',()=>{it('adds',()=>{expect(sum(1,2)).toBe(3)})})\n",
      'src/components/shout.ts':
        'export function shout(name:string):string{let text=name.toUpperCase()\nreturn text}\n',
      'src/pages/api/health.ts': "export function GET():Response{return new Response('ok')}\n",
      'src/pages/index.astro': ASTRO_PAGE,
      ...ASTRO_ISLAND,
      'src/styles/global.css': "@import 'tailwindcss';\n\n@theme{--color-brand:#f00}\n",
    },
    invalidSource: {
      'src/pages/index.astro': '---\nconst title: string = 123\n---\n<h1>{title}</h1>\n',
    },
    // Astro's client types reference Vite's, which reference Node's, so islands get `process`
    missingGlobals: [
      {
        file: 'src/components/suite.ts',
        source: "describe('suite',()=>{})\n",
        error: "Cannot find name 'describe'",
      },
    ],
  },
]

/**
 * The cases that run only the checks, with sources as the fixers leave them
 */
const CHECK_CASES: Array<Case> = [
  {
    name: 'pnpm monorepo',
    heading: MONOREPO,
    // No styled files, for the Stylelint commands' `--allow-empty-input`
    sources: {
      'packages/core/src/sum.ts': [
        'export function sum(a: number, b: number): number {',
        '  const total = a + b',
        '  return total',
        '}',
        '',
      ].join('\n'),
      'packages/core/src/index.ts': "export { sum } from './sum'\n",
      'packages/cli/src/index.ts': "const name = process.argv[2] ?? 'world'\nconsole.log(name)\n",
      // A package's config file, which the root `tsconfig.node.json` types
      'packages/cli/tsdown.config.ts': "export default { entry: ['src/index.ts'] }\n",
    },
    invalidSource: { 'packages/core/src/sum.ts': 'export const title: string = 123\n' },
    missingGlobals: [nodeGlobal('packages/core/src/env.ts')],
  },
  {
    name: 'Vite with React',
    heading: VITE,
    appDependencies: REACT_PACKAGES,
    appDevDependencies: ['vite', '@vitejs/plugin-react', ...REACT_TYPES],
    appFiles: { '.gitignore': APP_GITIGNORE },
    sources: {
      'vite.config.ts': [
        "import react from '@vitejs/plugin-react'",
        "import { defineConfig } from 'vite'",
        '',
        'export default defineConfig({ plugins: [react()] })',
        '',
      ].join('\n'),
      'index.html': [
        '<!doctype html>',
        '<html lang="en">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <title>App</title>',
        '  </head>',
        '  <body>',
        '    <div id="root"></div>',
        '    <script type="module" src="/src/main.tsx"></script>',
        '  </body>',
        '</html>',
        '',
      ].join('\n'),
      'src/main.tsx': [
        "import { StrictMode } from 'react'",
        "import { createRoot } from 'react-dom/client'",
        '',
        "import './index.css'",
        '',
        "import App from './app'",
        '',
        "const root = document.querySelector('#root')",
        'if (root) {',
        '  createRoot(root).render(',
        '    <StrictMode>',
        '      <App />',
        '    </StrictMode>,',
        '  )',
        '}',
        '',
      ].join('\n'),
      'src/app.tsx': [
        "import { useState } from 'react'",
        '',
        "import { shout } from './shout'",
        '',
        'export default function App() {',
        '  const [count, setCount] = useState(0)',
        '  return (',
        '    <button',
        '      type="button"',
        '      onClick={() => {',
        '        setCount((value) => value + 1)',
        '      }}',
        '    >',
        "      {shout('count')}: {count}",
        '    </button>',
        '  )',
        '}',
        '',
      ].join('\n'),
      'src/shout.ts': FIXED_SHOUT,
      'src/index.css': FIXED_CSS,
    },
    invalidSource: { 'src/shout.ts': 'export const title: string = 123\n' },
    missingGlobals: [nodeGlobal('src/env.ts')],
  },
  {
    name: 'Next.js',
    heading: NEXTJS,
    appDependencies: ['next', ...REACT_PACKAGES],
    appDevDependencies: ['tailwindcss', ...REACT_TYPES],
    appFiles: { '.gitignore': 'node_modules\n.next\nnext-env.d.ts\n*.tsbuildinfo\n' },
    sources: {
      'next.config.ts': [
        "import type { NextConfig } from 'next'",
        '',
        'const nextConfig: NextConfig = {}',
        '',
        'export default nextConfig',
        '',
      ].join('\n'),
      'postcss.config.mjs': [
        "const config = { plugins: { '@tailwindcss/postcss': {} } }",
        '',
        'export default config',
        '',
      ].join('\n'),
      'app/globals.css': [
        "@import 'tailwindcss';",
        '',
        '@theme inline {',
        '  --font-sans: var(--font-geist-sans);',
        '  --font-mono: var(--font-geist-mono);',
        '}',
        '',
        FIXED_CSS,
      ].join('\n'),
      'app/layout.tsx': [
        "import type { ReactNode } from 'react'",
        "import type { Metadata } from 'next'",
        '',
        "import './globals.css'",
        '',
        "export const metadata: Metadata = { title: 'App' }",
        '',
        'export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {',
        '  return (',
        '    <html lang="en">',
        '      <body className="font-sans antialiased">{children}</body>',
        '    </html>',
        '  )',
        '}',
        '',
      ].join('\n'),
      'app/page.tsx': [
        "import { shout } from '@/lib/shout'",
        '',
        'export default function Home() {',
        '  return (',
        '    <main className="p-4">',
        "      <h1>{shout('home')}</h1>",
        '    </main>',
        '  )',
        '}',
        '',
      ].join('\n'),
      'app/error.tsx': [
        "'use client'",
        '',
        'export default function ErrorPage({ error, reset }: Readonly<{ error: Error; reset: () => void }>) {',
        '  return (',
        '    <div>',
        '      <p>{error.message}</p>',
        '      <button type="button" onClick={reset}>',
        '        Try again',
        '      </button>',
        '    </div>',
        '  )',
        '}',
        '',
      ].join('\n'),
      'lib/shout.ts': FIXED_SHOUT,
    },
    invalidSource: { 'lib/shout.ts': 'export const title: string = 123\n' },
  },
]

/**
 * A root TypeScript config file with a type error, which the recipes' `check:types` checks too
 */
const INVALID_CONFIG = { 'a.config.ts': 'export const title: string = 123\n' }

const TYPE_ERROR = "Type 'number' is not assignable to type 'string'"

/**
 * `files`, with each `package.json` as the fixers lay it out, so that the cases without them pass
 * Prettier's check. Prettier sorts its keys and expands every object and array, unlike the README's
 * JSON blocks and the root one that `setUpRecipe` writes
 */
async function layOutManifests(
  dir: string,
  files: Record<string, string>,
): Promise<Record<string, string>> {
  const entries = Object.entries(files).map(async ([file, text]): Promise<[string, string]> => [
    file,
    path.basename(file) === 'package.json'
      ? await prettier.format(text, { ...prettierConfig, filepath: path.join(dir, file) })
      : text,
  ])
  return Object.fromEntries(await Promise.all(entries))
}

/**
 * A project with the app, its recipe and its sources, in a temporary folder of its own, so cases can
 * run concurrently
 */
async function setUpRecipe({
  heading,
  appDependencies = [],
  appDevDependencies = [],
  appFiles = {},
  sources,
}: Project): Promise<AsyncDisposable & { dir: string }> {
  const recipe = readRecipe(heading)
  const project = await withTmpProject('setup-recipe')
  const { dir } = project
  try {
    const installer = new Installer(dir)
    const install = async (names: Array<string>): Promise<Record<string, string>> => {
      const ranges: Record<string, string> = {}
      for (const name of names) {
        const packageDir = await installer.package(name)
        const manifest = await readManifest(packageDir)
        ranges[name] = `^${manifest.version}`
        await symlink(packageDir, path.join(dir, 'node_modules', name))
        const bins =
          typeof manifest.bin === 'string' ? { [name]: manifest.bin } : (manifest.bin ?? {})
        for (const [bin, file] of Object.entries(bins)) {
          if (BINS.has(bin)) {
            await symlink(path.join(packageDir, file), path.join(dir, 'node_modules/.bin', bin))
          }
        }
      }
      return ranges
    }
    const dependencies = await install(appDependencies)
    const devDependencies = await install([...appDevDependencies, ...recipe.packages])
    const { 'package.json': recipePackageJson = '{}', ...files } = recipe.files
    const recipeManifest = JSON.parse(recipePackageJson) as { scripts?: Record<string, string> }
    const packageJson = {
      name: 'recipe',
      version: '0.0.0',
      ...recipeManifest,
      scripts: Object.fromEntries(
        Object.entries({ ...readScripts(), ...recipeManifest.scripts }).map(([name, script]) => [
          name,
          name === 'check' ? strictCheck(script) : script,
        ]),
      ),
      ...(appDependencies.length > 0 && { dependencies }),
      devDependencies,
    }
    await writeFiles(dir, {
      ...appFiles,
      ...(await layOutManifests(dir, {
        ...files,
        ...sources,
        'package.json': JSON.stringify(packageJson),
      })),
      'pnpm-lock.yaml': PNPM_LOCK,
    })
  } catch (error) {
    await project[Symbol.asyncDispose]()
    throw error
  }
  return project
}

// The fixers' Stylelint commands read `.gitignore`, and pass without one
test('the minimal recipe writes a .gitignore', () => {
  expect(readRecipe(MINIMAL).files['.gitignore']).toBe('node_modules\n*.tsbuildinfo\n')
})

/**
 * Runs the strict `check`, then `check:types` on files with type errors, which must report each
 */
async function expectChecks(dir: string, testCase: Case, expect: ExpectStatic): Promise<void> {
  // Fails on anything a fix run would change, as `strictCheck` explains
  const checked = await runScript(dir, 'check')
  expect(checked.status, checked.output).toBe(0)
  // Such as `GPAHAL_DEFAULT_PROJECT_NODE_TYPES`, when the config files lack Node's types
  expect(checked.output).not.toContain('GPAHAL_')

  // One run reports every type error: a root config file's, each missing global's and a source's
  const missingGlobals = testCase.missingGlobals ?? []
  await writeFiles(dir, {
    ...INVALID_CONFIG,
    ...Object.fromEntries(missingGlobals.map(({ file, source }) => [file, source])),
    ...testCase.invalidSource,
  })
  const invalid = await runScript(dir, 'check:types')
  expect(invalid.status, invalid.output).not.toBe(0)
  expect(invalid.output).toContain('a.config.ts')
  for (const { error } of missingGlobals) {
    expect(invalid.output).toContain(error)
  }
  const [invalidFile] = Object.keys(testCase.invalidSource)
  expect(invalid.output).toContain(path.basename(invalidFile!))
  expect(invalid.output.split(TYPE_ERROR).length - 1).toBeGreaterThanOrEqual(2)
}

// Each case runs in a temporary project of its own, whose child processes dominate its time
test.concurrent.for(FIXER_CASES)(
  'the README recipe for $name passes the fixers and then its checks',
  async (testCase, { expect }) => {
    await using project = await setUpRecipe(testCase)
    const { dir } = project

    const before = await snapshot(dir)
    const first = await runScript(dir, 'fix')
    expect(first.status, first.output).toBe(0)
    const once = await snapshot(dir)
    expect(once).not.toEqual(before)
    expect(once['pnpm-lock.yaml']).toBe(PNPM_LOCK)
    const files = Object.entries(once)
    const styled = files.filter(([file]) => /\.(?:css|astro)$/.test(file))
    expect(styled.filter(([, code]) => code.includes('max-width'))).toEqual([])
    // Outside dot folders, which hold generated files, such as the types `astro sync` writes
    const scripts = files.filter(
      ([file]) => file.endsWith('.ts') && file.split('/').every((part) => !part.startsWith('.')),
    )
    expect(scripts.filter(([, code]) => code.includes('let '))).toEqual([])

    await expectChecks(dir, testCase, expect)

    // `fix` runs every fixer after one fails, and fails
    const { failingFix } = testCase
    if (failingFix === undefined) {
      return
    }
    await writeFiles(dir, failingFix.sources)
    const failed = await runScript(dir, 'fix')
    expect(failed.status, failed.output).not.toBe(0)
    expect(failed.output).toContain(failingFix.rule)
    for (const [file, text] of Object.entries(failingFix.fixed)) {
      expect(await fs.readFile(path.join(dir, file), 'utf8')).toBe(text)
    }
  },
)

test.concurrent.for(CHECK_CASES)(
  'the README recipe for $name passes its checks',
  async (testCase, { expect }) => {
    await using project = await setUpRecipe(testCase)
    await expectChecks(project.dir, testCase, expect)
  },
)
