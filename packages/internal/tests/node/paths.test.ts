import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { isRelativePath, resolveFileOption, resolvePathOrFileUrl } from '@/node/paths'
import { withTmpProject } from '@/node/testing'

const root = path.resolve('/project')
const absolute = path.resolve('/project/src/a.css')

function invalid(cause?: unknown): never {
  throw new Error('invalid', { cause })
}

test('resolves a relative path against root, and keeps an absolute one', () => {
  expect(resolvePathOrFileUrl('src/a.css', root, invalid)).toBe(absolute)
  expect(resolvePathOrFileUrl(absolute, root, invalid)).toBe(absolute)
  expect(resolvePathOrFileUrl('/a.css', root, invalid)).toBe('/a.css')
})

test('takes a `file:` URL or URL string, whatever the scheme case', () => {
  const url = pathToFileURL(absolute)
  expect(resolvePathOrFileUrl(url, root, invalid)).toBe(absolute)
  expect(resolvePathOrFileUrl(url.href, root, invalid)).toBe(absolute)
  expect(resolvePathOrFileUrl(url.href.replace('file:', 'FILE:'), root, invalid)).toBe(absolute)
})

test.each([
  '',
  'https://example.com/a.css',
  // A URL parser reads it as `/p(x)/a.css`
  'file:p(x)/a.css',
  // Drive-relative, which Windows resolves against the drive's current folder
  'C:a.css',
])('calls `onInvalid` for %j', (value) => {
  expect(() => resolvePathOrFileUrl(value, root, invalid)).toThrow('invalid')
})

test('tells which values are paths relative to `root`', () => {
  expect(isRelativePath('src/a.css')).toBe(true)
  expect(isRelativePath('../a.css')).toBe(true)
  for (const value of ['', absolute, 'C:a.css', 'file:a.css', 'https://example.com/a.css']) {
    expect(isRelativePath(value)).toBe(false)
  }
})

test('without root, keeps an absolute path and reads a `file:` URL, but not a relative path', () => {
  expect(resolvePathOrFileUrl(absolute, undefined, invalid)).toBe(absolute)
  expect(resolvePathOrFileUrl(pathToFileURL(absolute), undefined, invalid)).toBe(absolute)
  expect(() => resolvePathOrFileUrl('src/a.css', undefined, invalid)).toThrow('invalid')
})

describe('resolveFileOption', () => {
  const context = { prefix: '@scope/config', name: 'a.entryPoint' }

  it('resolves a file, and names the resolved path when nothing or a folder is there', async () => {
    await using project = await withTmpProject('internal-paths', { 'src/a.css': '' })
    const file = path.join(project.dir, 'src/a.css')
    expect(resolveFileOption('src/a.css', project.dir, context)).toBe(file)
    expect(resolveFileOption(pathToFileURL(file), undefined, context)).toBe(file)
    for (const value of ['src/missing.css', 'src']) {
      expect(() => resolveFileOption(value, project.dir, context)).toThrow(
        new TypeError(
          `@scope/config: \`a.entryPoint\`: \`${path.join(project.dir, value)}\` isn't a file`,
        ),
      )
    }
  })

  it('keeps the filesystem error as the cause when the path cannot be read', async () => {
    await using project = await withTmpProject('internal-paths')
    const loop = path.join(project.dir, 'loop')
    await fs.symlink('loop', loop)
    expect(() => resolveFileOption('loop', project.dir, context)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          `@scope/config: \`a.entryPoint\`: reading \`${loop}\` failed: `,
        ) as unknown,
        cause: expect.objectContaining({ code: 'ELOOP' }) as unknown,
      }),
    )
  })

  it('throws the path error for a value that is no path', () => {
    expect(() => resolveFileOption('https://example.com/a.css', root, context)).toThrow(
      /^@scope\/config: `a\.entryPoint`: expected an absolute path or one relative to `root`, .*, received `https:\/\/example\.com\/a\.css`$/u,
    )
  })
})
