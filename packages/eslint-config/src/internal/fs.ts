import fs from 'node:fs'
import path from 'node:path'

import { readJsonFile as readJsonFileOrThrow } from '@gpahal/internal/node/json'
import { findNodeModulesManifest } from '@gpahal/internal/node/resolve'
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
  return findNodeModulesManifest(name, path.resolve(dir))?.file
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

/**
 * `undefined` when it isn't a regular file or can't be read. The check guards against a symbolic
 * link to a FIFO or device, whose read never ends
 */
export function readTextFile(file: string): string | undefined {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true
      ? fs.readFileSync(file, 'utf8')
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The entry, or its target's stats for a symbolic link. `undefined` when the target is missing or
 * can't be read
 */
export function followEntry(entry: fs.Dirent, file: string): fs.Dirent | fs.Stats | undefined {
  if (!entry.isSymbolicLink()) {
    return entry
  }
  try {
    return fs.statSync(file, { throwIfNoEntry: false })
  } catch {
    return undefined
  }
}
