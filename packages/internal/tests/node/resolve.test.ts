import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  findInstalledPackage,
  formatPeerSpecifier,
  isResolvable,
  missingPeersError,
  resolveFile,
  resolveFromNodeModules,
  resolvePath,
} from '@/node/resolve'
import { assertBuildIsCurrent, withTmpProject } from '@/node/testing'

const BUILD_DIR = path.join(import.meta.dirname, '../../build')

test('resolves from the caller, as its `import.meta.resolve` does', () => {
  const resolve = (specifier: string) => import.meta.resolve(specifier)
  expect(resolvePath(resolve, './resolve.test.ts')).toBe(import.meta.filename)
  expect(() => resolvePath(resolve, 'missing-package')).toThrow(/missing-package/)
  expect(isResolvable(resolve, 'zod')).toBe(true)
  expect(isResolvable(resolve, 'missing-package')).toBe(false)
})

test('names the missing peers of an option with the install command of `dir`', async () => {
  const cause = new Error('not found')
  const one = missingPeersError(['a'], { prefix: '@scope/config', option: 'react', cause })
  expect(one).toEqual(
    new Error(
      "@scope/config: `react`: needs `a`, which isn't installed. Install it as a dev dependency, as in `pnpm add -D a`",
    ),
  )
  expect(one.cause).toBe(cause)
  expect(
    missingPeersError(['typescript', 'a'], {
      prefix: '@scope/config',
      option: 'typescript',
      ranges: { typescript: '~6.0.3', a: '^2' },
    }).message,
  ).toBe(
    '@scope/config: `typescript`: needs `typescript` and `a`, which aren\'t installed. Install them as dev dependencies, as in `pnpm add -D "typescript@~6.0.3" "a@^2"`',
  )
  await using project = await withTmpProject('internal-resolve', { 'package-lock.json': '' })
  expect(
    missingPeersError(['a'], { prefix: '@scope/config', option: 'react', dir: project.dir })
      .message,
  ).toMatch(/as in `npm install -D a`$/)
})

// zsh with `extended_glob` reads an unquoted `^` as a glob, and cmd.exe as its escape character
test.each([
  ['eslint', undefined, 'eslint'],
  ['@scope/a_b.c', '1.2.3-rc.1', '@scope/a_b.c@1.2.3-rc.1'],
  ['eslint', '^10.11', '"eslint@^10.11"'],
  ['a', '$HOME', "'a@$HOME'"],
  ['a', `1"x'`, String.raw`'a@1"x'\'''`],
])('formats the peer `%s` with range `%s` as %s', (name, range, expected) => {
  expect(formatPeerSpecifier(name, range)).toBe(expected)
})

function pkg(manifest: Record<string, unknown>): string {
  return JSON.stringify(manifest)
}

/**
 * The path that `resolve` gives, or `'error'` when it throws
 */
function outcome(resolve: () => string | undefined): string | undefined {
  try {
    return resolve()
  } catch {
    return 'error'
  }
}

describe('resolveFromNodeModules', () => {
  const context = { prefix: '@scope/config' }

  it('resolves from the nearest `node_modules` that has the package, with its version', async () => {
    await using project = await withTmpProject('internal-resolve', {
      // The project's own `exports` don't apply
      'package.json': pkg({ name: '@s/b', exports: { './theme.css': './own.css' } }),
      'node_modules/a/package.json': pkg({ name: 'a', version: '1.0.0', main: 'lib/index.js' }),
      'node_modules/a/lib/index.js': '',
      'app/node_modules/a/package.json': pkg({ name: 'a', version: '2.0.0' }),
      'app/node_modules/a/index.js': '',
      'node_modules/@s/b/package.json': pkg({
        name: '@s/b',
        version: '1.0.0',
        exports: { './theme.css': './dist/theme.css' },
      }),
      'node_modules/@s/b/dist/theme.css': '',
      'node_modules/events/package.json': pkg({ name: 'events', version: '3.3.0' }),
      'node_modules/events/index.js': '',
    })
    const app = path.join(project.dir, 'app/src/file.js')
    const other = path.join(project.dir, 'other/file.js')
    expect(resolveFromNodeModules('a', app, context)).toEqual({
      path: path.join(project.dir, 'app/node_modules/a/index.js'),
      version: '2.0.0',
    })
    expect(resolveFromNodeModules('a', other, context)).toEqual({
      path: path.join(project.dir, 'node_modules/a/lib/index.js'),
      version: '1.0.0',
    })
    expect(resolveFromNodeModules('@s/b/theme.css', other, context)?.path).toBe(
      path.join(project.dir, 'node_modules/@s/b/dist/theme.css'),
    )
    // Named like a Node builtin, which `require.resolve` gives as the builtin
    expect(resolveFromNodeModules('events', other, context)?.path).toBe(
      path.join(project.dir, 'node_modules/events/index.js'),
    )
    expect(resolveFromNodeModules('missing', other, context)).toBeUndefined()
  })

  it("finds nothing for a specifier that isn't a valid package name", async () => {
    await using project = await withTmpProject('internal-resolve', {
      'package.json': pkg({ name: 'app', version: '1.0.0', main: 'index.js' }),
      'index.js': '',
      'node_modules/_a/package.json': pkg({ name: '_a', version: '1.0.0' }),
      'node_modules/_a/index.js': '',
    })
    const parent = path.join(project.dir, 'src/file.js')
    for (const specifier of ['', '.', '../x', '_a', '@s', '@s/..', String.raw`a\b`]) {
      expect(resolveFromNodeModules(specifier, parent, context)).toBeUndefined()
      expect(findInstalledPackage(specifier, parent, context)).toBeUndefined()
    }
  })

  it('ignores `NODE_PATH`', async () => {
    await using project = await withTmpProject('internal-resolve', {
      'hoisted/node_modules/a/package.json': pkg({ name: 'a', version: '1.0.0' }),
      'hoisted/node_modules/a/index.js': '',
      'app/file.js': '',
    })
    // The build, since the source is TypeScript that imports with `@/`
    await assertBuildIsCurrent(BUILD_DIR)
    const resolveModule = pathToFileURL(path.join(BUILD_DIR, 'node/resolve.js')).href
    const code = `
      const { resolveFromNodeModules } = await import(${JSON.stringify(resolveModule)})
      const parent = ${JSON.stringify(path.join(project.dir, 'app/file.js'))}
      const { createRequire } = await import('node:module')
      let required = null
      try { required = createRequire(parent).resolve('a') } catch {}
      console.log(JSON.stringify([required, resolveFromNodeModules('a', parent, { prefix: 'p' }) ?? null]))
    `
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', code], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        NODE_PATH: path.join(project.dir, 'hoisted/node_modules'),
      },
    })
    // `require.resolve` finds the hoisted copy through `NODE_PATH`, and the walk doesn't
    expect(JSON.parse(output)).toEqual([
      path.join(project.dir, 'hoisted/node_modules/a/index.js'),
      null,
    ])
  })

  it('resolves a pnpm-style symlinked package to its real path, and rejects a subpath outside it', async () => {
    await using project = await withTmpProject('internal-resolve', {
      'node_modules/.pnpm/a@1.0.0/node_modules/a/package.json': pkg({
        name: 'a',
        version: '1.0.0',
      }),
      'node_modules/.pnpm/a@1.0.0/node_modules/a/index.js': '',
      'node_modules/a/theme.css': '',
      'app/file.js': '',
    })
    const real = path.join(project.dir, 'node_modules/.pnpm/a@1.0.0/node_modules/a')
    await fs.mkdir(path.join(project.dir, 'app/node_modules'))
    await fs.symlink(real, path.join(project.dir, 'app/node_modules/a'), 'dir')
    const parent = path.join(project.dir, 'app/file.js')
    expect(resolveFromNodeModules('a', parent, context)).toEqual({
      path: path.join(real, 'index.js'),
      version: '1.0.0',
    })
    expect(findInstalledPackage('a', parent, context)).toEqual({
      dir: path.join(project.dir, 'app/node_modules/a'),
      version: '1.0.0',
    })
    expect(() => resolveFromNodeModules('a/theme.css', parent, context)).toThrow(
      `@scope/config: \`a/theme.css\`: resolving it from \`${path.join(project.dir, 'app')}\` failed: it resolves to \`${path.join(project.dir, 'node_modules/a/theme.css')}\`, outside the package's folder \`${real}\``,
    )
  })

  it('names the manifest it fails to read, and the specifier it fails to resolve', async () => {
    await using project = await withTmpProject('internal-resolve', {
      'node_modules/a/package.json': '{',
      'node_modules/b/package.json': pkg({ name: 'b', version: '1.0.0', exports: {} }),
      'node_modules/c/package.json': pkg({ name: 'c', version: '1.0.0', main: 'missing.js' }),
    })
    const parent = path.join(project.dir, 'file.js')
    const manifest = path.join(project.dir, 'node_modules/a/package.json')
    expect(() => resolveFromNodeModules('a', parent, context)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          `@scope/config: \`${manifest}\`: reading \`a\`'s manifest failed: `,
        ) as unknown,
        cause: expect.any(SyntaxError) as unknown,
      }),
    )
    expect(() => findInstalledPackage('a', parent, context)).toThrow(
      `@scope/config: \`${manifest}\`: reading \`a\`'s manifest failed: `,
    )
    expect(() => resolveFromNodeModules('b/c', parent, context)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          `@scope/config: \`b/c\`: resolving it from \`${project.dir}\` failed: `,
        ) as unknown,
        cause: expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }) as unknown,
      }),
    )
    // `findInstalledPackage` reads the version without resolving the entry
    expect(() => resolveFromNodeModules('c', parent, context)).toThrow(/failed/)
    expect(findInstalledPackage('c', parent, context)?.version).toBe('1.0.0')
  })

  describe('with conditions and main fields', () => {
    const esm = { ...context, conditions: ['node', 'import'], mainFields: ['module', 'main'] }

    it('resolves conditional `exports` with the given conditions and `default`', async () => {
      await using project = await withTmpProject('internal-resolve', {
        'node_modules/a/package.json': pkg({
          name: 'a',
          version: '1.0.0',
          exports: {
            '.': { import: './esm.mjs', require: './cjs.cjs', default: './default.js' },
            './sub': { node: { import: './sub.mjs' }, default: ['invalid', './sub.js'] },
            './features/*.js': { import: './f/*.mjs', require: './f/*.cjs' },
            './private': null,
            './p/*': './short/*',
            './p/*.js': './long/*.js',
          },
        }),
        'node_modules/a/esm.mjs': '',
        'node_modules/a/cjs.cjs': '',
        'node_modules/a/default.js': '',
        'node_modules/a/sub.mjs': '',
        'node_modules/a/sub.js': '',
        'node_modules/a/f/x.mjs': '',
        'node_modules/a/private.js': '',
        'node_modules/a/short/y.js': '',
        'node_modules/a/long/y.js': '',
      })
      const parent = path.join(project.dir, 'file.js')
      const resolved = (specifier: string, options: typeof esm | typeof context = esm) =>
        resolveFromNodeModules(specifier, parent, options)?.path
      const file = (name: string) => path.join(project.dir, 'node_modules/a', name)
      expect(resolved('a', context)).toBe(file('cjs.cjs'))
      expect(resolved('a')).toBe(file('esm.mjs'))
      expect(resolved('a', { ...context, conditions: ['browser'] })).toBe(file('default.js'))
      expect(resolved('a/sub')).toBe(file('sub.mjs'))
      expect(resolved('a/sub', { ...context, conditions: ['browser'] })).toBe(file('sub.js'))
      expect(resolved('a/features/x.js')).toBe(file('f/x.mjs'))
      // A tie on the prefix goes to the longer key
      expect(resolved('a/p/y.js')).toBe(file('long/y.js'))
      expect(() => resolved('a/private')).toThrow(
        `@scope/config: \`a/private\`: resolving it from \`${project.dir}\` failed: \`a\` doesn't export \`./private\` for the conditions \`node\`, \`import\` and \`default\``,
      )
      expect(() => resolved('a/features/y.js')).toThrow(
        `failed: it resolves to \`${file('f/y.mjs')}\`, which doesn't exist`,
      )
    })

    it('resolves a package without `exports` from its first main field that names a file', async () => {
      await using project = await withTmpProject('internal-resolve', {
        'node_modules/a/package.json': pkg({
          name: 'a',
          main: 'lib/main.js',
          module: 'lib/module',
        }),
        'node_modules/a/lib/main.js': '',
        'node_modules/a/lib/main.mjs': '',
        'node_modules/a/lib/module.mjs': '',
        'node_modules/a/lib/sub/index.js': '',
        'node_modules/c/package.json': pkg({ name: 'c', module: 'missing.mjs' }),
        'node_modules/c/index.js': '',
        'node_modules/d/package.json': pkg({ name: 'd' }),
      })
      const parent = path.join(project.dir, 'file.js')
      const resolved = (specifier: string, options: object = esm) =>
        resolveFromNodeModules(specifier, parent, { ...context, ...options })?.path
      const file = (name: string) => path.join(project.dir, 'node_modules', name)
      expect(resolved('a', context)).toBe(file('a/lib/main.js'))
      expect(resolved('a')).toBe(file('a/lib/module.mjs'))
      expect(resolved('a/lib/sub')).toBe(file('a/lib/sub/index.js'))
      expect(resolved('a/lib/main')).toBe(file('a/lib/main.js'))
      expect(resolved('a/lib/main', { ...esm, extensions: ['.mjs', '.js'] })).toBe(
        file('a/lib/main.mjs'),
      )
      expect(resolved('c')).toBe(file('c/index.js'))
      // The whole message, without a cause
      expect(() => resolved('d')).toThrow(
        new Error(
          `@scope/config: \`d\`: resolving it from \`${project.dir}\` failed: \`d\` has no entry file for the main fields \`module\` and \`main\``,
        ),
      )
      expect(() => resolved('a/missing')).toThrow(`failed: \`a\` has no file \`./missing\``)
    })

    // As Tailwind's resolver, enhanced-resolve with these settings, does, so stylelint-config's
    // `defineConfig` follows `@import 'ui/theme'`
    it('resolves a `style` export that names a folder to its `index.css`', async () => {
      await using project = await withTmpProject('internal-resolve', {
        'node_modules/ui/package.json': pkg({
          name: 'ui',
          exports: { './theme': { style: './theme' }, './empty': { style: './empty' } },
        }),
        'node_modules/ui/theme/index.css': '',
        'node_modules/ui/empty/a.txt': '',
      })
      const style = {
        ...context,
        conditions: ['style'],
        mainFields: ['style'],
        extensions: ['.css'],
      }
      const parent = path.join(project.dir, 'a.css')
      expect(resolveFromNodeModules('ui/theme', parent, style)?.path).toBe(
        path.join(project.dir, 'node_modules/ui/theme/index.css'),
      )
      expect(() => resolveFromNodeModules('ui/empty', parent, style)).toThrow(
        `failed: it resolves to \`${path.join(project.dir, 'node_modules/ui/empty')}\`, which isn't a file and has no entry file`,
      )
    })

    it.each([
      [
        { '.': './a.js', node: './b.js' },
        '`a` has an invalid `exports`: its keys mix subpaths, which start with `.`, and conditions',
      ],
      [{ '.': { node: 1 } }, "`a`'s `exports` has an invalid target `1`"],
      [{ '.': './../b/index.js' }, "`a`'s `exports` has an invalid target `./../b/index.js`"],
    ])('rejects the `exports` %j', async (exports, message) => {
      await using project = await withTmpProject('internal-resolve', {
        'node_modules/a/package.json': pkg({ name: 'a', exports }),
        'node_modules/a/a.js': '',
        'node_modules/b/index.js': '',
      })
      expect(() => resolveFromNodeModules('a', path.join(project.dir, 'file.js'), esm)).toThrow(
        `failed: ${message}`,
      )
    })

    it('resolves `exports` with given conditions as `require.resolve` does with its own', async () => {
      // The conditions that `require.resolve` matches
      const nodeCjs = {
        ...context,
        conditions: ['node', 'require', 'module-sync', 'node-addons'],
        mainFields: ['main'],
        extensions: [],
      }
      // Each case has its own package name, since Node caches each `package.json` it reads
      const cases: ReadonlyArray<{ exports: unknown; subpaths: ReadonlyArray<string> }> = [
        {
          // An object's conditions apply in its key order, so `default` first always wins
          exports: {
            '.': { default: './a.js', require: './lib/b.js' },
            './r': { require: './lib/b.js', default: './a.js' },
          },
          subpaths: ['.', './r'],
        },
        {
          // An array skips invalid targets and `null`, but not a missing file
          exports: {
            '.': ['not-relative.js', null, './a.js'],
            './m': ['./missing.js', './a.js'],
            './e': [],
          },
          subpaths: ['.', './m', './e'],
        },
        {
          // Invalid segments in the target, or in the `*` match in any case
          exports: { './*': './lib/*.js', './n': './node_modules/a.js', './d': './lib/./b.js' },
          subpaths: ['./NODE_MODULES/b', './n', './d'],
        },
        {
          // A subpath with a `*` isn't an exact match, and every `*` of a target is replaced
          exports: { './lib/*': './lib/*/*.js', './*.js': './lib/*.js' },
          subpaths: ['./lib/*', './lib/x', './b.js', './lib/x/y.js'],
        },
      ]
      const files = ['a.js', 'lib/b.js', 'lib/x.js', 'lib/x/y.js', 'lib/x/x.js']
      await using project = await withTmpProject(
        'internal-resolve',
        Object.fromEntries(
          cases.flatMap(({ exports }, index) => [
            [`node_modules/p${index}/package.json`, pkg({ name: `p${index}`, exports })],
            ...files.map((file) => [`node_modules/p${index}/${file}`, ''] as const),
          ]),
        ),
      )
      const parent = path.join(project.dir, 'index.js')
      const require = createRequire(parent)
      for (const [index, { subpaths }] of cases.entries()) {
        for (const subpath of subpaths) {
          const specifier = `p${index}${subpath.slice(1)}`
          expect
            .soft(
              outcome(() => resolveFromNodeModules(specifier, parent, nodeCjs)?.path),
              specifier,
            )
            .toBe(outcome(() => require.resolve(specifier)))
        }
      }
    })
  })
})

describe('resolveFile', () => {
  const css = { mainFields: ['style'], extensions: ['.css'] }

  it('resolves a path as enhanced-resolve does a relative request, ignoring `exports`', async () => {
    await using project = await withTmpProject('internal-resolve', {
      'a.css': '',
      'b/package.json': pkg({ exports: { '.': { style: './exports.css' } }, style: 'dist/b' }),
      'b/dist/b.css': '',
      'b/index.css': '',
      'd/package.json': pkg({ exports: { '.': { style: './exports.css' } } }),
      'd/exports.css': '',
      'd/index.css': '',
      'e/package.json': pkg({ style: 'missing.css' }),
    })
    const resolved = (file: string) => resolveFile(path.join(project.dir, file), css)
    const file = (name: string) => ({ path: path.join(project.dir, name) })
    expect(resolved('a')).toEqual(file('a.css'))
    expect(resolved('b')).toEqual(file('b/dist/b.css'))
    expect(resolved('d')).toEqual(file('d/index.css'))
    expect(resolved('e')).toBeUndefined()
    expect(resolved('missing')).toBeUndefined()
  })

  it("gives the reason a folder's `package.json` can't be read", async () => {
    await using project = await withTmpProject('internal-resolve', {
      'a/package.json': '{',
      'a/index.css': '',
    })
    expect(resolveFile(path.join(project.dir, 'a'), css)).toEqual({
      reason: expect.stringContaining(
        `reading \`${path.join(project.dir, 'a/package.json')}\` failed: `,
      ) as unknown,
      cause: expect.any(SyntaxError) as unknown,
    })
  })
})
