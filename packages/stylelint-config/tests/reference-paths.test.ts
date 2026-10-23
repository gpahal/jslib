import fs from 'node:fs/promises'
import path from 'node:path'

import stylelint from 'stylelint'

import { withTmpProject, writeFiles } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'

// `defineConfig` checks that each `referenceFiles` entry matches a file, so Stylelint doesn't fail
// with a stack trace on every run. These cases pin that its answer agrees with native Stylelint's
// resolution of the same entry

const project = await withTmpProject('stylelint-config-reference-paths', {
  'source.css': ':root {\n  --brand: red;\n}\n',
  'real/r.css': ':root {\n  --real: red;\n}\n',
  'only/o.css': ':root {\n  --only: red;\n}\n',
  '.env': 'API_KEY=secret\n',
})
const { dir } = project
const outside = await withTmpProject('stylelint-config-reference-paths-outside', {
  'pkg/theme.css': ':root {\n  --outside: red;\n}\n',
})
await fs.mkdir(path.join(dir, 'tokens'))
await fs.symlink('../source.css', path.join(dir, 'tokens/link.css'))
await fs.symlink('real', path.join(dir, 'linked'))
await fs.mkdir(path.join(dir, 'deep'))
await fs.symlink('../only', path.join(dir, 'deep/l'))
// A cycle, which a walk through symlinked folders must not follow forever
await fs.symlink('..', path.join(dir, 'deep/up'))
await fs.mkdir(path.join(dir, 'vendor'))
await fs.symlink(path.join(outside.dir, 'pkg'), path.join(dir, 'vendor/pkg'))
await fs.symlink('missing.css', path.join(dir, 'broken.css'))
await writeFiles(dir, { 'dangling/.keep': '' })
await fs.symlink('missing.css', path.join(dir, 'dangling/x.css'))
await fs.mkdir(path.join(dir, 'empty'))

afterAll(async () => {
  await project[Symbol.asyncDispose]()
  await outside[Symbol.asyncDispose]()
})

/**
 * Whether native Stylelint, given `files` as a reference entry from `dir`, finds a file for it
 */
async function nativeMatches(files: ReadonlyArray<string>): Promise<boolean> {
  try {
    await stylelint.lint({
      code: 'a {}\n',
      config: {
        referenceFiles: [{ files: [...files] }],
        rules: { 'no-unknown-custom-properties': true },
      },
      configBasedir: dir,
    })
    return true
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No files matching the pattern')) {
      return false
    }
    throw error
  }
}

/**
 * The texts of `defineConfig`'s errors for an entry that matches no file
 */
const NO_MATCH_TEXTS = [
  'matches no file',
  'matches a file',
  "doesn't exist",
  'exists. ',
  'folder with no file',
]

/**
 * Whether `defineConfig` takes `files` as a reference entry from `dir`
 */
async function ownMatches(files: ReadonlyArray<string>): Promise<boolean> {
  try {
    await defineConfig({ root: dir, referenceFiles: [{ files: [...files] }] })
    return true
  } catch (error) {
    if (error instanceof TypeError && NO_MATCH_TEXTS.some((text) => error.message.includes(text))) {
      return false
    }
    throw error
  }
}

describe('referenceFiles paths', () => {
  it.each<[string, () => ReadonlyArray<string>, boolean]>([
    ['a glob matching a symlinked file', () => ['tokens/*.css'], true],
    ['a glob through a symlinked folder', () => ['linked/*.css'], true],
    ['a wildcard segment through a symlinked folder', () => ['deep/*/o.css'], true],
    ['a globstar through a symlinked folder', () => ['deep/**/o.css'], true],
    ['a glob through a symlink out of root', () => ['vendor/*/theme.css'], true],
    ['a broken link', () => ['broken.css'], false],
    // Stylelint's globby skips dotfiles, as `fs.promises.glob` does
    ['a glob matching only a dotfile', () => ['*.env'], false],
    ['a glob matching only a broken link', () => ['dangling/*.css'], false],
    ['a literal path that its exclusion removes', () => ['source.css', '!source.css'], false],
    ['a missing path and a glob', () => ['missing.css', 'tokens/*.css'], true],
    ['an absolute exclusion of a glob', () => ['*.css', `!${path.join(dir, '*.css')}`], false],
    ['an empty folder', () => ['empty'], false],
    ['a symlinked folder with CSS', () => ['linked'], true],
    ['a folder whose files are excluded', () => ['real', '!real/*.css'], false],
  ])('agrees with Stylelint on %s', async (_name, filesOf, expected) => {
    const files = filesOf()
    expect({ native: await nativeMatches(files), own: await ownMatches(files) }).toEqual({
      native: expected,
      own: expected,
    })
  })

  // Stylelint makes every glob absolute, and its globby then drops some `!` globs, so its files
  // depend on the working directory. `defineConfig` applies each one, as written
  it.each<[string, () => ReadonlyArray<string>]>([
    ['a literal path and a glob', () => ['source.css', 'real/*.css', '!*.css', '!real/*.css']],
    ['an absolute glob', () => [path.join(dir, 'real/*.css'), `!${path.join(dir, 'real/r.css')}`]],
  ])('rejects %s that its exclusions remove, which Stylelint keeps', async (_name, filesOf) => {
    const files = filesOf()
    expect({ native: await nativeMatches(files), own: await ownMatches(files) }).toEqual({
      native: true,
      own: false,
    })
  })

  // Each workspace package links to every other, as pnpm links workspace dependencies, so a walk of
  // every path through the links reads millions of entries
  it('rejects a glob that matches no file in a pnpm workspace', async () => {
    const pnpm = await withTmpProject('stylelint-config-reference-paths-pnpm', {
      'src/tokens.css': ':root {\n  --brand: red;\n}\n',
    })
    try {
      const names = Array.from({ length: 8 }, (_, index) => `pkg-${index}`)
      for (const name of names) {
        const modules = path.join(pnpm.dir, 'packages', name, 'node_modules')
        await writeFiles(pnpm.dir, { [`packages/${name}/index.css`]: '' })
        await fs.mkdir(modules)
        for (const other of names) {
          if (other !== name) await fs.symlink(`../../${other}`, path.join(modules, other))
        }
      }
      await expect(
        defineConfig({ root: pnpm.dir, referenceFiles: ['**/tokns.css'] }),
      ).rejects.toThrow(/`\*\*\/tokns\.css` matches no file/)
      // A glob that names `node_modules` still walks it
      await defineConfig({
        root: pnpm.dir,
        referenceFiles: ['packages/pkg-0/node_modules/*/index.css'],
      })
    } finally {
      await pnpm[Symbol.asyncDispose]()
    }
  })
})
