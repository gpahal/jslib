import { execFileSync } from 'node:child_process'
import syncFs from 'node:fs'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import type { ESLint, Linter } from 'eslint'
import { defineConfig as eslintDefineConfig } from 'eslint/config'

import {
  assertBuildIsCurrent,
  minCpuMs,
  runNodeOk,
  withTmpProject,
  writeFiles,
} from '@gpahal/internal/node/testing'

import { defineConfig, type EslintConfigOptions } from '@/index'
import { IGNORES } from '@/internal/configs/ignores'
import { findGitCommonDir, readGitModules } from '@/internal/git'
import { scanProject } from '@/internal/project-scan'
import { resolveOptions } from '@/internal/resolve'
import { createIgnoreCheck, IgnoreLayers } from '@/internal/walk'

import {
  BUILD_DIR,
  collator,
  createESLint,
  eslintWith,
  FIXTURES_DIR,
  lint,
  lintText,
  ruleSeverity,
  severityOf,
  withProject,
} from './helpers'

/**
 * Makes `fs[method]` throw a permission error for `target` until disposed, whatever the user running
 * the tests. The named exports of `node:fs` follow, for modules that import them
 */
function failReads(
  method: 'readdirSync' | 'readFileSync',
  target: string,
): Disposable & { error: NodeJS.ErrnoException } {
  const error: NodeJS.ErrnoException = Object.assign(
    new Error(`EACCES: permission denied, open '${target}'`),
    {
      code: 'EACCES',
      errno: -13,
      syscall: method === 'readdirSync' ? 'scandir' : 'open',
      path: target,
    },
  )
  const original = syncFs[method] as (...args: Array<unknown>) => unknown
  const spy = vi.spyOn(syncFs, method).mockImplementation(((
    file: unknown,
    ...rest: Array<unknown>
  ) => {
    if (typeof file === 'string' && path.resolve(file) === target) {
      throw error
    }
    return original.call(syncFs, file, ...rest)
  }) as never)
  syncBuiltinESMExports()
  return {
    error,
    [Symbol.dispose]() {
      spy.mockRestore()
      syncBuiltinESMExports()
    },
  }
}

/**
 * The rules on for `file` that need type information
 */
async function typeAwareRules(eslint: ESLint, file: string) {
  const config = (await eslint.calculateConfigForFile(file)) as Linter.Config
  const typeAware = Object.entries(config.rules ?? {}).filter(([name, entry]) => {
    if (severityOf(entry) === 0) {
      return false
    }
    const slash = name.lastIndexOf('/')
    const plugin = slash === -1 ? undefined : config.plugins?.[name.slice(0, slash)]
    const rule = plugin?.rules?.[name.slice(slash + 1)]
    return (
      (rule?.meta?.docs as { requiresTypeChecking?: boolean } | undefined)?.requiresTypeChecking ===
      true
    )
  })
  return {
    rules: typeAware.map(([name]) => name),
    parserOptions: config.languageOptions?.['parserOptions'] as Linter.ParserOptions | undefined,
    settings: config.settings?.['vitest'],
  }
}

/**
 * Runs git in `cwd` without the user's or the system's git config, which may sign commits or run
 * hooks
 */
function git(cwd: string, ...args: Array<string>): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' },
    },
  )
}

/**
 * The untracked files that git ignores in the repository at `dir`
 */
function gitIgnoredFiles(dir: string): Set<string> {
  return new Set(
    git(dir, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z')
      .split('\0')
      .filter((file) => file !== ''),
  )
}

/**
 * Whether git and ESLint ignore each of `checked`, in a new repository with `files`, with ESLint's
 * root at `root`
 */
async function compare(files: Record<string, string>, root: string, checked: Array<string>) {
  await using project = await withProject()
  git(project.dir, 'init', '--quiet')
  await writeFiles(project.dir, { [`${root}/eslint.config.mjs`]: 'export default []\n', ...files })
  const eslint = await createESLint(path.join(project.dir, root))
  return await Promise.all(
    checked.map(async (file) => {
      let isGitIgnored = true
      try {
        git(project.dir, 'check-ignore', '--quiet', file)
      } catch {
        isGitIgnored = false
      }
      return {
        file,
        git: isGitIgnored,
        eslint: await eslint.isPathIgnored(path.join(project.dir, file)),
      }
    }),
  )
}

/**
 * The folders `readdirSync` read, relative to `dir`
 */
function readFoldersOf(readdirSync: { mock: { calls: Array<Array<unknown>> } }, dir: string) {
  return readdirSync.mock.calls.map(([folder]) => path.relative(dir, String(folder)))
}

describe('packageJson area', () => {
  it('skips fixture manifests for the package-json and pnpm rules, its own and yours', async () => {
    await using project = await withProject({ 'pnpm-workspace.yaml': 'packages: []\n' })
    const rules = {
      packageJson: { rules: { 'package-json/require-license': 'error' } },
      pnpm: { rules: { 'pnpm/json-prefer-workspace-settings': 'warn' } },
    } as const
    const manifest = '{"pnpm":{"overrides":{"a":"1"}}}\n'
    for (const json of [true, false]) {
      const eslint = await createESLint(project.dir, { typeAware: false, json, ...rules })
      for (const file of ['test/fixtures/package.json', 'x/__fixtures__/package.json']) {
        // With `json: false`, ESLint only warns that the file is ignored, instead of linting it as
        // JavaScript
        const messages = await lintText(eslint, file, manifest)
        expect(
          messages.filter((message) => !message.startsWith('fatal: File ignored because')),
          `${file}, json: ${String(json)}`,
        ).toEqual([])
      }
      expect(await lintText(eslint, 'package.json', manifest)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^package-json\/require-name:/),
          expect.stringMatching(/^package-json\/require-license:/),
          expect.stringMatching(/^pnpm\/json-prefer-workspace-settings:/),
        ]),
      )
    }
  })

  it('is on by default, leaves sorting to Prettier, and is off with packageJson: false', async () => {
    const manifest = '{\n  "version": "1.0.0",\n  "dependencies": { "b": "1", "a": "1" }\n}\n'
    const messages = await lintText(await createESLint('json'), 'pkg/package.json', manifest)
    expect(messages).toContainEqual(expect.stringMatching(/^package-json\/require-name: /))
    expect(messages).not.toContainEqual(expect.stringMatching(/sort-collections/))
    const off = await createESLint('json', { packageJson: false })
    expect(await lintText(off, 'pkg/package.json', manifest)).toEqual([])
  })
})

describe('typeAware', () => {
  it('false lints a TypeScript project without a tsconfig and no type-aware rules', async () => {
    await using project = await withProject({
      'package.json': '{ "name": "untyped", "private": true, "type": "module" }\n',
      'src/index.ts': 'export function sum(a: number, b: number): number {\n  return a + b\n}\n',
      'src/app.tsx': 'export function App() {\n  return <div>App</div>\n}\n',
      'src/page.astro': "---\nconst title = 'Page'\n---\n\n<h1>{title}</h1>\n",
      'src/index.test.ts': "test('sum', () => {\n  expect(1 + 1).toBe(2)\n})\n",
    })
    const eslint = await createESLint(project.dir, {
      typeAware: false,
      vitest: true,
      astro: true,
      react: true,
    })
    expect(Object.values(await lint(eslint, ['src'])).flat()).toEqual([])
    for (const file of ['src/index.ts', 'src/app.tsx', 'src/index.test.ts', 'src/page.astro']) {
      const { rules, parserOptions, settings } = await typeAwareRules(
        eslint,
        path.join(project.dir, file),
      )
      expect(rules, file).toEqual([])
      expect(parserOptions, file).not.toHaveProperty('project', true)
      expect(parserOptions?.['projectService'], file).toBeFalsy()
      expect(settings, file).toBeUndefined()
    }
  })

  it('typescript.rulesTypeAware reaches the files with type information only', async () => {
    const rule = '@typescript-eslint/prefer-readonly-parameter-types'
    const eslint = await createESLint('typescript', {
      markdown: true,
      typescript: { rulesTypeAware: { [rule]: 'error' } },
    })
    expect(await ruleSeverity(eslint, 'src/index.ts', rule)).toBe(2)
    for (const file of ['index.js', 'README.md/0.ts']) {
      expect((await ruleSeverity(eslint, file, rule)) ?? 0, file).toBe(0)
    }
  })

  it('javascript lints JavaScript files with type information and the type-aware rules', async () => {
    const eslint = await createESLint('checkjs', { typeAware: { javascript: true } })
    expect(await lint(eslint, ['src'])).toEqual({
      // `require-await` is off, as in TypeScript files
      'src/index.js': [expect.stringMatching(/^@typescript-eslint\/no-floating-promises: /)],
    })
  })
})

describe('ignores', () => {
  // `.gitignore` files are read from `root` up to the repository root, and this repo's ignores
  // `build` and the like, so the tests use a directory outside it
  let tmpDir: string
  beforeAll(async () => {
    const project = await withProject()
    tmpDir = project.dir
    return async () => project[Symbol.asyncDispose]()
  })

  it('ignore generated, build and lockfile paths by default, but not pnpm-workspace.yaml', async () => {
    const eslint = await createESLint(tmpDir, { typeAware: false })
    for (const file of [
      'src/api.gen.ts',
      'public/vendor.min.js',
      'packages/a/dist/index.js',
      'apps/web/.next/index.js',
      'vite.config.ts.timestamp-1700000000000-4f2a.mjs',
      'pnpm-lock.yaml',
    ]) {
      expect(await eslint.isPathIgnored(file), file).toBe(true)
    }
    for (const file of ['pnpm-workspace.yaml', 'src/commands/build/index.js']) {
      expect(await eslint.isPathIgnored(file), file).toBe(false)
    }
  })

  it('take a function of the defaults, or an array in place of them', async () => {
    const added = await createESLint(tmpDir, {
      ignores: (defaults) => [...defaults, '**/generated'],
    })
    expect(await added.isPathIgnored('src/generated/index.js')).toBe(true)
    expect(await added.isPathIgnored('dist/index.js')).toBe(true)
    const globs: ReadonlyArray<string> = Object.freeze(['**/generated'])
    const replaced = await createESLint(tmpDir, { typeAware: false, ignores: globs })
    expect(await replaced.isPathIgnored('src/generated/index.js')).toBe(true)
    expect(await replaced.isPathIgnored('dist/index.js')).toBe(false)
  })

  it("read the repository's .gitignore files and info/exclude, but none above its root", async () => {
    await using project = await withProject({
      '.gitignore': '*\n',
      'repo/.git/info/exclude': 'local.js\n',
      'repo/.gitignore': 'secret.js\n',
      'repo/eslint.config.mjs': 'export default []\n',
      'repo/app/.gitignore': 'out/\n',
    })
    const eslint = await createESLint(path.join(project.dir, 'repo'))
    expect(await eslint.isPathIgnored('index.js')).toBe(false)
    expect(await eslint.isPathIgnored('secret.js')).toBe(true)
    expect(await eslint.isPathIgnored('local.js')).toBe(true)
    expect(await eslint.isPathIgnored('app/out/index.js')).toBe(true)
  })

  it('skip a folder it cannot read', async () => {
    await using project = await withProject({ '.git/HEAD': '', 'pgdata/.gitignore': 'x\n' })
    using _failure = failReads('readdirSync', path.join(project.dir, 'pgdata'))
    await expect(createESLint(project.dir)).resolves.toBeDefined()
  })

  it.each(['app/.gitignore', '.git/info/exclude'])(
    'throw an error that names an ignore file it cannot read and keeps the cause, %s',
    async (file) => {
      await using project = await withProject({ '.git/HEAD': '', [file]: 'x\n' })
      using failure = failReads('readFileSync', path.join(project.dir, file))
      expect(() => resolveOptions({ root: project.dir })).toThrow(
        expect.objectContaining({
          message: `@gpahal/eslint-config: \`gitignore\`: \`${file}\`: can't read the file: ${failure.error.message}. Make it readable, or set \`gitignore: false\``,
          cause: failure.error,
        }),
      )
    },
  )
})

describe('git ignore rules', () => {
  // Written at runtime: committed `.gitignore` fixtures would make git ignore files in this repo
  let repoDir: string
  beforeAll(async () => {
    const project = await withProject({
      '.git/info/exclude': '/scratch\n',
      '.gitignore': 'build\n/root-only\nscripts\n',
      'apps/web/.gitignore': 'generated/\n!scripts\n',
      'apps/web/eslint.config.mjs': 'export default []\n',
    })
    repoDir = project.dir
    return async () => project[Symbol.asyncDispose]()
  })

  it('honour .git/info/exclude and the .gitignore files under root', async () => {
    const eslint = await createESLint(repoDir)
    expect(await eslint.isPathIgnored('scratch/index.js')).toBe(true)
    expect(await eslint.isPathIgnored('build/index.js')).toBe(true)
    expect(await eslint.isPathIgnored('root-only/index.js')).toBe(true)
    expect(await eslint.isPathIgnored('apps/web/generated/index.js')).toBe(true)
    // Patterns in a nested `.gitignore` apply only under its folder, and can negate one above it
    expect(await eslint.isPathIgnored('generated/index.js')).toBe(false)
    expect(await eslint.isPathIgnored('scripts/index.js')).toBe(true)
    expect(await eslint.isPathIgnored('apps/web/scripts/index.js')).toBe(false)
    expect(await eslint.isPathIgnored('src/index.js')).toBe(false)
  })

  it("apply at the top level of ESLint's `defineConfig`, from root", async () => {
    const rootDir = path.join(repoDir, 'apps/web')
    const configs = eslintDefineConfig(
      ...(await defineConfig({ root: rootDir, isInEditor: false })),
    )
    const eslint = eslintWith(rootDir, configs)
    for (const file of ['build/index.js', 'generated/index.js']) {
      expect(await eslint.isPathIgnored(file), file).toBe(true)
    }
    for (const file of ['scratch/index.js', 'scripts/index.js', 'src/index.js']) {
      expect(await eslint.isPathIgnored(file), file).toBe(false)
    }
  })

  it('add `gitignore.files` after the files found, so their patterns win', async () => {
    await writeFiles(repoDir, {
      'extra.ignore': '!root-only\n',
      'config/extra.ignore': 'local-only\n',
    })
    const eslint = await createESLint(repoDir, {
      gitignore: { files: ['extra.ignore', 'config/extra.ignore'] },
    })
    expect(await eslint.isPathIgnored('build/index.js')).toBe(true)
    expect(await eslint.isPathIgnored('root-only/index.js')).toBe(false)
    // Relative to the extra file's folder, as in a `.gitignore`
    expect(await eslint.isPathIgnored('config/local-only/index.js')).toBe(true)
    expect(await eslint.isPathIgnored('local-only/index.js')).toBe(false)
  })

  // ESLint's minimatch matches a segment of `n` wildcards in time that grows with the name to the
  // power of `n`: 24 wildcards on 200 characters hung ESLint, where git takes 5 ms
  it('skip a rule with more than 3 `*` wildcards in a path segment, and warn of its line once', async () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined)
    try {
      const slow = `${'a*'.repeat(8)}b`
      const kept = `${'a*'.repeat(3)}c`
      await using project = await withProject({
        '.git/HEAD': '',
        'src/.gitignore': `# Generated\n${slow}\n\n${kept}\n${slow}/\n`,
      })
      const root = project.dir
      const scan = () =>
        scanProject({ root, gitignore: true, ignores: IGNORES, findsTsconfigFiles: false })
      const { gitignores } = scan()
      scan()
      const isIgnored = createIgnoreCheck(new IgnoreLayers(gitignores))
      const [ms = 0] = minCpuMs(
        [() => isIgnored(path.join(root, 'src', `${'a'.repeat(44)}.ts`), false)],
        1,
      )
      expect(ms).toBeLessThan(100)
      expect(gitignores.flatMap(({ ignores }) => ignores)).toEqual([`**/${kept}`])
      expect(emitWarning.mock.calls).toEqual([
        [
          "@gpahal/eslint-config: `gitignore`: `src/.gitignore`: the rules on lines 2 and 5 have more than 3 `*` wildcards in one path segment, which can take ESLint seconds per path to match, so they're skipped. Use at most 3, as in `*.log`",
          { code: 'GPAHAL_GITIGNORE_WILDCARDS' },
        ],
      ])
    } finally {
      emitWarning.mockRestore()
    }
  })

  it('keeps the braces of a `.gitignore` literal, as git does, so a huge range expands to nothing', async () => {
    await using project = await withProject({
      '.git/HEAD': '',
      '.gitignore': `x{1..2000000}y\n${'{a,'.repeat(5000)}b${'}'.repeat(5000)}\n`,
      'x5y.js': 'export const a = 1\n',
      'b.js': 'export const b = 1\n',
    })
    const eslint = await createESLint(project.dir, { typeAware: false })
    expect(await eslint.isPathIgnored(path.join(project.dir, 'x5y.js'))).toBe(false)
    expect(await eslint.isPathIgnored(path.join(project.dir, 'b.js'))).toBe(false)
  })

  it('match `[!x]*` rules as minimatch reads them, and rebase one from above root', async () => {
    await using project = await withProject({
      '.git/HEAD': '',
      '.gitignore': '[!t]*-cache/\npkgs/[!x]*/out/\n',
      'tmp-cache/.gitignore': 'secret.js\n',
      'pkgs/app/eslint.config.mjs': 'export default []\n',
    })
    const eslint = await createESLint(project.dir, { typeAware: false })
    expect(await eslint.isPathIgnored('tmp-cache/secret.js')).toBe(true)
    expect(await eslint.isPathIgnored('tmp-cache/kept.js')).toBe(false)
    expect(await eslint.isPathIgnored('abc-cache/a.js')).toBe(true)
    const app = await createESLint(path.join(project.dir, 'pkgs/app'), { typeAware: false })
    expect(await app.isPathIgnored('out/a.js')).toBe(true)
    expect(await app.isPathIgnored('src/a.js')).toBe(false)
  })
})

describe('git ignore precedence, as git check-ignore has it', () => {
  it.each(['.gitignore', '.gitmodules'])(
    'does not follow an in-tree %s symlink',
    async (filename) => {
      await using project = await withProject({
        '.git/HEAD': '',
        outside: filename === '.gitignore' ? 'src/a.js\n' : '[submodule "src"]\npath = src\n',
        'src/a.js': '',
      })
      await fs.symlink(path.join(project.dir, 'outside'), path.join(project.dir, filename))
      const eslint = await createESLint(project.dir, { typeAware: false })
      expect(await eslint.isPathIgnored(path.join(project.dir, 'src/a.js'))).toBe(false)
    },
  )

  it.each([
    [
      'a .gitignore negates info/exclude',
      { '.git/info/exclude': 'keep.js\n', '.gitignore': '!keep.js\n', 'keep.js': '' },
      '.',
      ['keep.js'],
    ],
    [
      'a deeper .gitignore negates a shallower one',
      { '.gitignore': 'shared.js\n', 'app/.gitignore': '!shared.js\n', 'app/shared.js': '' },
      'app',
      ['app/shared.js'],
    ],
    [
      'a negated file stays ignored in an ignored folder',
      { '.gitignore': 'dir/\n', 'dir/.gitignore': '!x.js\n', 'dir/x.js': '' },
      '.',
      ['dir/x.js'],
    ],
    [
      'the patterns of a .gitignore above root apply to the paths under it',
      {
        '.gitignore': 'app/out/\n*/gen.js\n**/app/tmp/\n/top.js\n**/**/app/generated/**\n',
        'app/out/a.js': '',
        'app/gen.js': '',
        'app/src/gen.js': '',
        'app/tmp/a.js': '',
        'app/top.js': '',
        'app/generated/a.js': '',
      },
      'app',
      [
        'app/out/a.js',
        'app/gen.js',
        'app/src/gen.js',
        'app/tmp/a.js',
        'app/top.js',
        'app/generated/a.js',
      ],
    ],
    [
      'the negations of a deeper .gitignore come after a merged sibling config',
      {
        'a/.gitignore': 'x.js\n',
        'b/.gitignore': 'x.js\n',
        'a/sub/.gitignore': '!x.js\n',
        'c/.gitignore': '!x.js\n',
      },
      '.',
      ['a/x.js', 'b/x.js', 'a/sub/x.js', 'c/x.js'],
    ],
  ])('%s', { timeout: 30_000 }, async (_name, files, root, checked) => {
    const results = await compare(files, root, checked)
    expect(results.map(({ file, eslint }) => ({ file, eslint }))).toEqual(
      results.map(({ file, git }) => ({ file, eslint: git })),
    )
  })

  // Git turns `core.ignorecase` on when it makes a repository on a case-insensitive file system
  it.each([true, false])(
    'matches ignore rules in any case with core.ignorecase %s, as git does',
    { timeout: 30_000 },
    async (ignoreCase) => {
      await using project = await withProject({
        '.gitignore': 'Secret.JS\n[X-Z]*.js\n',
        'src/.gitignore': 'Gen/\n',
        'secret.js': '',
        'y.js': '',
        'src/gen/a.js': '',
        'kept.js': '',
      })
      git(project.dir, 'init', '--quiet')
      git(project.dir, 'config', 'core.ignorecase', String(ignoreCase))
      await writeFiles(project.dir, { '.git/info/exclude': 'Excluded.JS\n', 'excluded.js': '' })
      const gitIgnored = gitIgnoredFiles(project.dir)
      const eslint = await createESLint(project.dir, { typeAware: false })
      for (const file of ['secret.js', 'y.js', 'src/gen/a.js', 'excluded.js', 'kept.js']) {
        expect({ file, ignored: await eslint.isPathIgnored(file) }).toEqual({
          file,
          ignored: gitIgnored.has(file),
        })
      }
      expect(gitIgnored.has('secret.js')).toBe(ignoreCase)
    },
  )

  it("lints a root inside a git submodule as its own repository, with the submodule's info/exclude", async () => {
    await using project = await withProject({
      '.git/HEAD': '',
      '.gitmodules': '[submodule "sub"]\n\tpath = sub\n',
      '.gitignore': 'local.js\n',
      '.git/modules/sub/info/exclude': 'scratch\n',
      'sub/.git': 'gitdir: ../.git/modules/sub\n',
      'sub/.gitignore': 'out/\n',
      'sub/eslint.config.mjs': 'export default []\n',
    })
    const eslint = await createESLint(path.join(project.dir, 'sub'))
    // The outer repository's .gitignore doesn't apply in the submodule
    expect(await eslint.isPathIgnored('src/local.js')).toBe(false)
    expect(await eslint.isPathIgnored('out/index.js')).toBe(true)
    expect(await eslint.isPathIgnored('scratch/index.js')).toBe(true)
  })

  // As `git submodule status` has it, a listed folder without a `.git` holds tracked files
  it('ignores the submodules .gitmodules lists, relative to the repository root, but no other folder', async () => {
    await using project = await withProject({
      '.git/HEAD': '',
      '.gitmodules':
        '[submodule "b"]\n  path=packages/app/sub//\n[submodule "c"]\n\tpath = packages/app/src\n',
      'packages/app/sub/.git': 'gitdir: ../../../.git/modules/b\n',
      'packages/app/sub/index.js': '',
      'packages/app/src/index.js': '',
      'packages/app/eslint.config.mjs': 'export default []\n',
    })
    const eslint = await createESLint(path.join(project.dir, 'packages/app'))
    expect(await eslint.isPathIgnored(path.join(project.dir, 'packages/app/sub/index.js'))).toBe(
      true,
    )
    expect(await eslint.isPathIgnored(path.join(project.dir, 'packages/app/src/index.js'))).toBe(
      false,
    )
  })
})

describe('git files that the scan reads', () => {
  it.each([
    ['.gitmodules', '', readGitModules],
    ['.git', 'gitdir: ../x\n', findGitCommonDir],
  ])('names an unreadable %s and keeps the error as the cause', async (file, content, read) => {
    await using project = await withProject({ [file]: content })
    await fs.chmod(path.join(project.dir, file), 0o000)
    expect(() => read(project.dir)).toThrow(
      expect.objectContaining({
        message: `@gpahal/eslint-config: \`${file}\`: can't read the file`,
        cause: expect.objectContaining({ code: 'EACCES' }) as unknown,
      }),
    )
  })

  it('reads .gitmodules paths as git-config does', async () => {
    await using project = await withProject(
      Object.fromEntries(
        ['a', 'b', String.raw`a "b" c\d`, 'vendor/a', 'c;d#e', 'old'].map((folder) => [
          `${folder}/.git`,
          'gitdir: x\n',
        ]),
      ),
    )
    await writeFiles(project.dir, {
      '.gitmodules': [
        '\tPath = a',
        '\tPATH=b',
        '\tpath = "a \\"b\\" c\\\\d"',
        '\tpath = vendor/a ; the a module',
        '\tpath = "c;d#e"',
        '\t# path = old',
      ]
        .map((line, index) => `[submodule "${String(index)}"]\n${line}\n`)
        .join(''),
    })
    expect(readGitModules(project.dir)).toEqual([
      'a/',
      'b/',
      String.raw`a "b" c\\d/`,
      'vendor/a/',
      'c;d#e/',
    ])
  })
})

/**
 * A tsconfig that the resolver fails to parse, as some packages publish
 */
const BROKEN_TSCONFIG = '{ "extends": "missing-tsconfig-package" }\n'

/**
 * The tsconfig files under `dir` that the import resolver gets with `ignores`, relative to `dir`
 */
function findTsconfigs(dir: string, ignores: EslintConfigOptions['ignores']) {
  return resolveOptions({ root: dir, gitignore: false, ignores })
    .tsconfigFiles.map((file) => path.relative(dir, file))
    .toSorted((a, b) => collator.compare(a, b))
}

describe('the project walk', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never reads a gitignored folder or a submodule, and reads only .gitignore files in a dot folder', async () => {
    // Without a config file, which would load TypeScript to look for a project that includes it
    await using project = await withTmpProject('eslint-config', {
      '.git/HEAD': '',
      '.git/hooks/.gitignore': 'x\n',
      '.gitignore': 'target/\n',
      'target/debug/deps/tsconfig.json': BROKEN_TSCONFIG,
      '.venv/lib/site/tsconfig.json': BROKEN_TSCONFIG,
      '.venv/lib/.gitignore': 'x\n',
      '.gitmodules': '[submodule "sub"]\n\tpath = sub\n',
      'sub/.git': 'gitdir: ../.git/modules/sub\n',
      'sub/deep/tsconfig.json': BROKEN_TSCONFIG,
      'app/.gitignore': 'generated/\n',
      'app/generated/deep/tsconfig.json': BROKEN_TSCONFIG,
      'app/tsconfig.json': '{}\n',
    })
    const readdirSync = vi.spyOn(syncFs, 'readdirSync')
    const globSync = vi.spyOn(syncFs, 'globSync')
    const resolved = resolveOptions({ root: project.dir })
    const readFolders = readFoldersOf(readdirSync, project.dir)
    expect(globSync).not.toHaveBeenCalled()
    expect(readFolders).toContain('.venv/lib')
    expect(
      readFolders.filter((folder) => /^(?:\.git|target|sub|app\/generated)(?:\/|$)/.test(folder)),
    ).toEqual([])
    expect(resolved.tsconfigFiles.map((file) => path.relative(project.dir, file))).toEqual([
      'app/tsconfig.json',
    ])
  })

  // A tsconfig whose `include` names the home folder made the config load take 17 s instead of
  // 0.6 s, and `/**/*` walks the whole disk
  it("doesn't read the folders outside root that a nested tsconfig includes", async () => {
    await using outside = await withTmpProject('eslint-config-outside', {
      'deep/er/x.ts': 'export {}\n',
    })
    await using project = await withProject({
      'src/a.ts': 'export const a = 1\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { types: ['node'] }, include: ['src'] }),
      'vendor/x/tsconfig.json': JSON.stringify({ include: [`${outside.dir}/**/*`] }),
      'vendor/y/tsconfig.json': JSON.stringify({
        extends: '/no/such/tsconfig.json',
        references: [{ path: '/' }],
        include: [],
      }),
    })
    const readdirSync = vi.spyOn(syncFs, 'readdirSync')
    resolveOptions({ root: project.dir })
    const outsideReads = readdirSync.mock.calls
      .map(([folder]) => path.resolve(String(folder)))
      .filter((folder) => !folder.startsWith(project.dir))
    expect(outsideReads).toEqual([])
  })

  it.each<[string, EslintConfigOptions['ignores']]>([
    ['your ignores keep', (defaults) => defaults.filter((glob) => glob !== '**/dist')],
    ['a `!` glob of your ignores un-ignores', (defaults) => [...defaults, '!**/dist']],
  ])(
    'enters a default-ignored folder that %s, and reads no folder only your ignores match',
    async (_, ignores) => {
      await using project = await withProject({
        '.git/HEAD': '',
        'dist/.gitignore': 'secret.js\n',
        'ignored/a/.gitignore': 'x\n',
        'node_modules/pkg/tsconfig.json': '{}\n',
      })
      const readdirSync = vi.spyOn(syncFs, 'readdirSync')
      // Without the defaults, so that only the walk keeps out `node_modules`
      resolveOptions({ root: project.dir, ignores: () => ['ignored'] })
      const readFolders = readFoldersOf(readdirSync, project.dir)
      expect(
        readFolders.filter((folder) => /^(?:ignored|node_modules)(?:\/|$)/.test(folder)),
      ).toEqual([])
      vi.restoreAllMocks()
      const eslint = await createESLint(project.dir, { ignores })
      expect(await eslint.isPathIgnored('dist/secret.js')).toBe(true)
      expect(await eslint.isPathIgnored('dist/index.js')).toBe(false)
    },
  )

  it('reads each folder and each .gitignore file once in a large monorepo', async () => {
    const count = 20
    await using project = await withTmpProject('eslint-config', {
      '.git/HEAD': '',
      '.gitignore': 'dist\n',
      ...Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          [`packages/${String(index)}/.gitignore`, 'generated/\n*.log\n!keep.log\n'] as const,
          ...['src/lib/deep/b.ts', 'tests/a.test.ts'].map(
            (file) => [`packages/${String(index)}/${file}`, ''] as const,
          ),
        ]).flat(),
      ),
    })
    const readdirSync = vi.spyOn(syncFs, 'readdirSync')
    const readFileSync = vi.spyOn(syncFs, 'readFileSync')
    const resolved = resolveOptions({ root: project.dir })
    const folders = readdirSync.mock.calls.map(([folder]) => String(folder))
    const gitignores = readFileSync.mock.calls
      .map(([file]) => String(file))
      .filter((file) => path.basename(file) === '.gitignore')
    vi.restoreAllMocks()
    // The root, `packages`, and each package's own folder, `src`, `src/lib`, `src/lib/deep` and
    // `tests`
    expect(folders).toHaveLength(2 + count * 5)
    expect(new Set(folders).size).toBe(folders.length)
    expect(gitignores).toHaveLength(1 + count)
    expect(new Set(gitignores).size).toBe(gitignores.length)
    // The root's, the packages' merged into one, and the empty `info/exclude` and `.gitmodules`
    // configs, which are always there
    expect(resolved.gitignores).toHaveLength(4)
  })

  it('reads no .gitignore file and enters no dot folder with gitignore: false', async () => {
    await using project = await withProject({
      '.git/HEAD': '',
      '.gitignore': 'generated/\n',
      'generated/tsconfig.json': '{}\n',
      '.venv/tsconfig.json': '{}\n',
    })
    const readdirSync = vi.spyOn(syncFs, 'readdirSync')
    const resolved = resolveOptions({ root: project.dir, gitignore: false })
    expect(readFoldersOf(readdirSync, project.dir)).not.toContain('.venv')
    expect(resolved.gitignores).toEqual([])
    expect(resolved.tsconfigFiles.map((file) => path.relative(project.dir, file))).toEqual([
      'generated/tsconfig.json',
    ])
  })

  it("types the .astro files under each folder with a tsconfig.json, or all with root's", async () => {
    await using project = await withProject({
      'apps/[slug]/tsconfig.json': '{}\n',
      'apps/web/tsconfig.json': '{}\n',
      'apps/web/dist/tsconfig.json': '{}\n',
      'apps/docs/jsconfig.json': '{}\n',
    })
    expect(
      resolveOptions({ root: project.dir, astro: true }).typedAstroFiles.toSorted(collator.compare),
    ).toEqual([String.raw`apps/\[slug\]/**/*.astro`, 'apps/web/**/*.astro'])
    await fs.writeFile(path.join(project.dir, 'tsconfig.json'), '{}\n')
    expect(resolveOptions({ root: project.dir, astro: true }).typedAstroFiles).toEqual([
      '**/*.astro',
    ])
    expect(
      resolveOptions({ root: project.dir, astro: true, typeAware: false }).typedAstroFiles,
    ).toEqual([])
  })
})

describe('sibling .gitignore files', () => {
  it('merge the same patterns of sibling folders into one config, escaping extglob characters', async () => {
    await using project = await withProject({
      '.git/HEAD': '',
      'packages/a/.gitignore': 'generated/\n!keep.tmp.js\n',
      'packages/b/.gitignore': 'generated/\n!keep.tmp.js\n',
      'packages/(c)/.gitignore': 'generated/\n!keep.tmp.js\n',
      'packages/d/.gitignore': 'other/\n',
    })
    const configs = await defineConfig({ root: project.dir, isInEditor: false })
    expect(
      configs
        .filter(({ name }) => name === 'gpahal/ignores/gitignore')
        .map(({ ignores }) => ignores),
    ).toEqual([
      [
        String.raw`packages/@(\(c\)|a|b)/**/generated/`,
        String.raw`!packages/@(\(c\)|a|b)/**/keep.tmp.js`,
      ],
      ['packages/d/**/other/'],
    ])
  })

  it(
    'merge under package names with glob characters as git reads them',
    { timeout: 30_000 },
    async () => {
      await using project = await withProject()
      git(project.dir, 'init', '--quiet')
      const names = ['a', 'b', 'c', '[id]', '#h', 'a b', 'q,r', '{z}', '!n', 'a|b']
      const perPackage = ['dist2/x.js', 'a.cache', 'keep.cache', 'a.log', 'out/x.js', 'sub/a.log']
      const checked = names.flatMap((name) => perPackage.map((file) => `packages/${name}/${file}`))
      await writeFiles(project.dir, {
        '.gitignore': '*.log\n/packages/*/out/\n',
        ...Object.fromEntries(
          names.map((name) => [
            `packages/${name}/.gitignore`,
            name === 'c' ? 'dist2/\n*.cache\n' : 'dist2/\n*.cache\n!keep.cache\n',
          ]),
        ),
        'packages/a/sub/.gitignore': '!*.log\n',
        'packages/b/sub/.gitignore': '!*.log\n',
        ...Object.fromEntries(checked.map((file) => [file, ''])),
      })
      const ignored = gitIgnoredFiles(project.dir)
      // The last config gives every file a config, since `isPathIgnored` is `true` for a file that
      // no config's `files` matches
      const eslint = await createESLint(project.dir, {
        typeAware: false,
        extraConfigs: [{ files: ['**/*.*'] }],
      })
      for (const file of checked) {
        expect({ file, ignored: await eslint.isPathIgnored(file) }).toEqual({
          file,
          ignored: ignored.has(file),
        })
      }
    },
  )
})

describe('import resolver', () => {
  // eslint-import-resolver-typescript 4.4.5 drops the tsconfig paths of multiple projects when
  // ESLint's `cwd` isn't the process's working directory
  const originalCwd = process.cwd()
  afterAll(() => {
    process.chdir(originalCwd)
  })

  const resolveConfig = {
    files: ['**/*.ts'],
    rules: { 'import-x/no-unresolved': 'error' },
  } satisfies Linter.Config

  it("resolves `@/*` with each package's own tsconfig, and reports unresolved ones", async () => {
    process.chdir(path.join(FIXTURES_DIR, 'monorepo'))
    const eslint = await createESLint('monorepo', {
      packageJson: false,
      extraConfigs: [resolveConfig],
    })
    expect(Object.values(await lint(eslint, ['.'])).flat()).toEqual([])
    const results = await eslint.lintText(
      "import { onlyInA } from '@/only-in-a'\n\nexport function b() {\n  return onlyInA\n}\n",
      { filePath: 'packages/b/src/index.ts' },
    )
    expect(
      results[0]!.messages
        .map((message) => message.ruleId)
        .filter((ruleId) => ruleId?.startsWith('import-x/') === true),
    ).toEqual(['import-x/no-unresolved'])
  })

  describe('tsconfig files', () => {
    let tmpDir: string
    beforeAll(async () => {
      // Real, as `withTmpProject` makes it, since the resolver drops the tsconfig paths when
      // ESLint's `cwd` isn't the process's working directory, which `process.cwd()` returns with
      // symlinks resolved
      const project = await withProject()
      tmpDir = project.dir
      await fs.cp(path.join(FIXTURES_DIR, 'monorepo'), tmpDir, { recursive: true })
      await writeFiles(tmpDir, {
        '.gitignore': 'generated/\n',
        'generated/tsconfig.json': BROKEN_TSCONFIG,
        'node_modules/dep/tsconfig.json': BROKEN_TSCONFIG,
        'fixtures/tsconfig.json': BROKEN_TSCONFIG,
      })
      return async () => {
        process.chdir(originalCwd)
        await project[Symbol.asyncDispose]()
      }
    })

    // The resolver expands globs from the working directory
    it('skip node_modules and ignored folders, from a working directory below root', async () => {
      const cwd = path.join(tmpDir, 'packages')
      process.chdir(cwd)
      const eslint = await createESLint(cwd, {
        root: tmpDir,
        ignores: (defaults) => [...defaults, 'fixtures'],
        extraConfigs: [resolveConfig],
      })
      expect(Object.values(await lint(eslint, ['.'])).flat()).toEqual([])
    })

    it('leave out the tsconfig files your folder ignores match, and only those', () => {
      const packages = ['packages/a/tsconfig.json', 'packages/b/tsconfig.json']
      const all = ['fixtures/tsconfig.json', 'generated/tsconfig.json', ...packages]
      expect(findTsconfigs(tmpDir, undefined)).toEqual(all)
      expect(findTsconfigs(tmpDir, (defaults) => [...defaults, '**/fixtures'])).toEqual(
        all.slice(1),
      )
      // Only folder ignores decide which folders the walk enters
      expect(findTsconfigs(tmpDir, (defaults) => [...defaults, '**/*.json'])).toEqual(all)
      // As in ESLint and git, a file in an ignored folder stays ignored
      expect(
        findTsconfigs(tmpDir, (defaults) => [...defaults, 'packages/', '!packages/b/']),
      ).toEqual(['fixtures/tsconfig.json', 'generated/tsconfig.json'])
    })
  })
})

/**
 * Lints `files` of each working directory of `process.env.RUNS`, in order, in one process, as an
 * editor's ESLint server does, and prints each file's fatal messages and those of `RULE`
 */
const PROJECT_SERVICE_SCRIPT = `
const { ESLint } = await import('eslint')
const results = {}
for (const { cwd, files, overrideConfigFile } of JSON.parse(process.env.RUNS)) {
  const eslint = new ESLint({ cwd, ...(overrideConfigFile && { overrideConfigFile }) })
  for (const result of await eslint.lintFiles(files)) {
    results[result.filePath] = result.messages
      .filter((message) => message.fatal || message.ruleId === process.env.RULE)
      .map((message) => message.message)
  }
}
console.log(JSON.stringify(results))
`

/**
 * An `eslint.config.mjs` that loads the build's `defineConfig` with `options`, a string of
 * JavaScript
 */
function buildConfigFile(options = '') {
  const configUrl = new URL('../build/index.js', import.meta.url).href
  return `import { defineConfig } from '${configUrl}'\n\nexport default defineConfig({ root: import.meta.dirname, ${options} })\n`
}

/**
 * A workspace package with a source file its tsconfig includes, and `config`, a config file that no
 * tsconfig includes
 */
function workspacePackage(name: string, config: string, eslintConfig = buildConfigFile()) {
  return {
    [`packages/${name}/package.json`]: `{ "name": "${name}", "private": true, "type": "module" }\n`,
    [`packages/${name}/tsconfig.json`]:
      '{ "compilerOptions": { "strict": true, "module": "nodenext", "noEmit": true }, "include": ["src"] }\n',
    [`packages/${name}/src/index.ts`]: 'export const value = 1\n',
    [`packages/${name}/${config}`]: 'export default {}\n',
    ...(eslintConfig && { [`packages/${name}/eslint.config.mjs`]: eslintConfig }),
  }
}

/**
 * The messages of each file of `runs`, by path relative to `dir`
 */
async function lintRuns(
  dir: string,
  runs: ReadonlyArray<{
    cwd: string
    files: ReadonlyArray<string>
    overrideConfigFile?: string | undefined
  }>,
  rule = '',
): Promise<Record<string, Array<string>>> {
  const stdout = await runNodeOk(['--input-type=module', '--eval', PROJECT_SERVICE_SCRIPT], {
    cwd: path.join(import.meta.dirname, '..'),
    env: {
      RULE: rule,
      RUNS: JSON.stringify(runs.map((run) => ({ ...run, cwd: path.join(dir, run.cwd) }))),
    },
  })
  const results = JSON.parse(stdout) as Record<string, Array<string>>
  return Object.fromEntries(
    Object.entries(results).map(([file, messages]) => [path.relative(dir, file), messages]),
  )
}

// typescript-eslint keeps one project service per process, which the first config that uses it
// creates. These lint in a process of their own, from the build
describe('the project service', () => {
  beforeAll(async () => assertBuildIsCurrent(BUILD_DIR))

  const RUN_A = { cwd: 'packages/a', files: ['eslint.config.mjs', 'a.config.ts', 'src/index.ts'] }
  const RUN_B = { cwd: 'packages/b', files: ['eslint.config.mjs', 'b.config.ts', 'src/index.ts'] }

  it(
    'rejects the packages of a workspace with configs of their own, linted one after the other',
    { timeout: 60_000 },
    async () => {
      await using project = await withProject({
        ...workspacePackage('a', 'a.config.ts'),
        ...workspacePackage('b', 'b.config.ts'),
      })
      const results = await lintRuns(project.dir, [RUN_A, RUN_B])
      // The packages' other files match the same `allowDefaultProject` globs, relative to each
      // package, and get the same compiler options
      for (const file of [
        'packages/a/eslint.config.mjs',
        'packages/a/a.config.ts',
        'packages/b/eslint.config.mjs',
        'packages/b/src/index.ts',
      ]) {
        expect(results[file], file).toEqual([])
      }
      const file = path.join(project.dir, 'packages/b/b.config.ts')
      expect(results['packages/b/b.config.ts']).toEqual([
        `Parsing error: @gpahal/eslint-config: project service: \`${file}\`: the config of \`${path.join(project.dir, 'packages/b')}\` sets \`allowDefaultProject\` ["b.config.ts","eslint.config.mjs"], which matches the file, against ["a.config.ts","eslint.config.mjs"] in the config of \`${path.join(project.dir, 'packages/a')}\`, whose project service this process already uses. typescript-eslint keeps one project service per process, with the options of the first config that uses it. Lint the packages with one config at their common root, limiting presets with \`scope\` and settings with \`files\`, or run ESLint once per package`,
      ])
    },
  )

  it(
    'lints every package from one config at the workspace root, and again with the same options',
    { timeout: 60_000 },
    async () => {
      await using project = await withProject({
        'package.json': '{ "name": "workspace", "private": true, "type": "module" }\n',
        'eslint.config.mjs': buildConfigFile(),
        ...workspacePackage('a', 'a.config.ts', ''),
        ...workspacePackage('b', 'b.config.ts', ''),
      })
      const files = [
        'eslint.config.mjs',
        'packages/a/a.config.ts',
        'packages/a/src/index.ts',
        'packages/b/b.config.ts',
        'packages/b/src/index.ts',
      ]
      const results = await lintRuns(project.dir, [
        { cwd: '.', files },
        { cwd: '.', files },
      ])
      expect(results).toEqual(Object.fromEntries(files.map((file) => [file, []])))
    },
  )

  it(
    'rejects a higher default project file limit after a lower one',
    { timeout: 60_000 },
    async () => {
      await using project = await withProject({
        ...workspacePackage(
          'a',
          'a.config.ts',
          buildConfigFile("typeAware: { allowDefaultProject: ['*.config.ts'] }"),
        ),
        ...Object.fromEntries(
          Array.from('bcdefghij', (name) => [
            `packages/a/${name}.config.ts`,
            'export default {}\n',
          ]),
        ),
        'packages/a/small.config.mjs': buildConfigFile(
          "typeAware: { allowDefaultProject: ['a.config.ts'] }",
        ),
      })
      const large = { cwd: 'packages/a', files: ['a.config.ts'] }
      const small = { ...large, overrideConfigFile: 'small.config.mjs' }
      expect((await lintRuns(project.dir, [small, large]))['packages/a/a.config.ts']).toEqual([
        expect.stringContaining(
          "changed in this process, and now sets a default project file limit of 32, above 16 in the project service it set up first. typescript-eslint keeps one project service per process, with the options of the first config that uses it. Restart the ESLint server, as with VS Code's `ESLint: Restart ESLint Server` command, or run ESLint again",
        ),
      ])
    },
  )

  it('names the real path to run ESLint from for a file through a link to a folder below root', async () => {
    await using project = await withProject(workspacePackage('a', 'a.config.ts', ''))
    const root = path.join(project.dir, 'packages/a')
    const link = path.join(project.dir, 'src-link')
    await fs.symlink(path.join(root, 'src'), link)
    const configs = await defineConfig({ root })
    const { parser } = configs.find(
      (config) => config.name === 'gpahal/typescript/typescript-eslint/base',
    )!.languageOptions as { parser: { parseForESLint: (code: string, options: object) => unknown } }
    const file = path.join(link, 'index.ts')
    expect(() =>
      parser.parseForESLint('export const value = 1\n', {
        filePath: file,
        tsconfigRootDir: root,
        projectService: true,
      }),
    ).toThrow(
      `@gpahal/eslint-config: project service: \`${file}\`: reaches \`${root}\` through a symbolic link below it, which typescript-eslint's project service can't match to \`allowDefaultProject\`. Run ESLint from \`${root}\``,
    )
  })
})
