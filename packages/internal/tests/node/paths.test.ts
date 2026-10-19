import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { isRelativePath, resolvePathOrFileUrl } from '@/node/paths'

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
