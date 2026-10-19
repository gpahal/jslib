import { createRequire } from 'node:module'
import path from 'node:path'

import { createGlobMatcher } from '@/internal/globs'
import { IgnoreLayers } from '@/internal/walk'

describe('IgnoreLayers', () => {
  it('gives the layers above a path in order, including one added after a lookup', () => {
    const root = path.resolve('/project')
    const layers = new IgnoreLayers([{ basePath: root, ignores: ['a'] }])
    const file = path.join(root, 'packages', 'p', 'index.ts')
    expect(layers.above(file).map(({ ignores }) => ignores)).toEqual([['a']])
    layers.add({ basePath: path.join(root, 'packages', 'p'), ignores: ['b'] })
    layers.add({ basePath: path.join(root, 'packages'), ignores: ['c'] }, -1)
    expect(layers.above(file).map(({ ignores }) => ignores)).toEqual([['c'], ['a'], ['b']])
  })
})

describe('createGlobMatcher', () => {
  // The minimatch that ESLint matches `files` and `ignores` with
  const { minimatch } = createRequire(createRequire(import.meta.url).resolve('eslint'))(
    'minimatch',
  ) as { minimatch: (path: string, pattern: string, options: { dot: boolean }) => boolean }

  // picomatch, which this package used before, reads `[!a]` as `!` or `a`, and differs on the rest
  it.each([
    ['[!t]*-cache', 'tmp-cache'],
    ['[!x]*', 'app'],
    ['[!a]', '!'],
    [String.raw`a\b`, 'ab'],
    ['a[/]b', 'a/b'],
    ['a?b', 'a.b'],
    ['*', '.env'],
  ])('matches %j against %j as ESLint does', (glob, filePath) => {
    expect(createGlobMatcher(glob)(filePath)).toBe(minimatch(filePath, glob, { dot: true }))
  })
})
