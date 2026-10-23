import fs from 'node:fs/promises'
import path from 'node:path'

import stylelint from 'stylelint'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'

// `defineConfig` checks that a `referenceFiles` entry of paths without glob syntax names a path that
// exists, so Stylelint doesn't fail with a stack trace on every run. These cases pin that its answer
// agrees with native Stylelint's resolution of the same entry, and that a glob passes to Stylelint
// unchecked

const project = await withTmpProject('stylelint-config-reference-paths', {
  'source.css': ':root {\n  --brand: red;\n}\n',
  'real/r.css': ':root {\n  --real: red;\n}\n',
})
const { dir } = project
await fs.mkdir(path.join(dir, 'tokens'))
await fs.symlink('../source.css', path.join(dir, 'tokens/link.css'))
await fs.symlink('real', path.join(dir, 'linked'))
await fs.symlink('missing.css', path.join(dir, 'broken.css'))

afterAll(async () => {
  await project[Symbol.asyncDispose]()
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
 * The texts of `defineConfig`'s errors for an entry none of whose paths exists
 */
const NO_MATCH_TEXTS = ["doesn't exist", 'exists. ']

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
  it.each<[string, ReadonlyArray<string>, boolean]>([
    ['a symlinked file', ['tokens/link.css'], true],
    ['a symlinked folder with CSS', ['linked'], true],
    ['a missing path', ['missing.css'], false],
    ['a broken link', ['broken.css'], false],
    ['a missing path and a glob', ['missing.css', 'tokens/*.css'], true],
  ])('agrees with Stylelint on %s', async (_name, files, expected) => {
    expect({ native: await nativeMatches(files), own: await ownMatches(files) }).toEqual({
      native: expected,
      own: expected,
    })
  })

  it('passes a glob that matches no file to Stylelint', async () => {
    const files = ['missing/*.css']
    expect({ native: await nativeMatches(files), own: await ownMatches(files) }).toEqual({
      native: false,
      own: true,
    })
  })
})
