import fs from 'node:fs'
import path from 'node:path'

import { readJsonFile as readJsonFileOrThrow } from '@gpahal/internal/node/json'
import { isRecord } from '@gpahal/std/objects'

/**
 * As Node's resolvers walk the folders, whatever the package's `exports` say. Unlike
 * `require.resolve`, it never falls back to `NODE_PATH`, which pnpm sets for package scripts, or
 * global folders, where ES module imports don't look. A package resolving its own name comes first
 */
export function findPackageJson(name: string, dir: string): string | undefined {
  // A package resolves its own name through `exports` before Node looks in `node_modules`
  const scope = findUp('package.json', dir)
  if (scope !== undefined && isSelfNamed(scope, name)) {
    return scope
  }
  for (let current = path.resolve(dir); ;) {
    const candidate = path.join(current, 'node_modules', name, 'package.json')
    // Node skips a `node_modules` folder's own `node_modules`
    if (path.basename(current) !== 'node_modules' && fs.existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

function isSelfNamed(file: string, name: string): boolean {
  const manifest = readJsonFile(file)
  return isRecord(manifest) && manifest['name'] === name && manifest['exports'] !== undefined
}

/**
 * `undefined` when it isn't a regular file or doesn't parse. The check guards against a committed
 * symbolic link to a FIFO or device, whose read never ends
 */
export function readJsonFile(file: string): unknown {
  try {
    const stats = fs.statSync(file, { throwIfNoEntry: false })
    return stats?.isFile() === true ? readJsonFileOrThrow(file) : undefined
  } catch {
    return undefined
  }
}

export function findUp(fileName: string, dir: string): string | undefined {
  let current = path.resolve(dir)
  for (;;) {
    const candidate = path.join(current, fileName)
    if (fs.existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}
