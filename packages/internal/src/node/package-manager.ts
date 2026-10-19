/**
 * The package manager of a project, for the install commands in error and warning messages. Only
 * npm and pnpm are supported. Contract: absolute folder paths, which needn't exist. Unreadable or
 * malformed `package.json` files count as missing
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { isRecord } from '@gpahal/std/objects'

import { readJsonFile } from '@/node/json'

export type PackageManager = 'npm' | 'pnpm'

/**
 * The files that name a folder's package manager, checked in order before its `packageManager`
 * field, so pnpm wins in a folder with both pnpm and npm lockfiles
 */
const LOCKFILES: ReadonlyArray<[file: string, packageManager: PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['pnpm-workspace.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
]

const PACKAGE_MANAGER_FIELD_REGEX = /^(?<name>npm|pnpm)@/

function readPackageManagerField(file: string): PackageManager | undefined {
  let manifest: unknown
  try {
    manifest = readJsonFile(file)
  } catch {
    return undefined
  }
  const field = isRecord(manifest) ? manifest['packageManager'] : undefined
  const name =
    typeof field === 'string'
      ? PACKAGE_MANAGER_FIELD_REGEX.exec(field)?.groups?.['name']
      : undefined
  return name === 'npm' || name === 'pnpm' ? name : undefined
}

/**
 * The package manager that `dir` itself names: a lockfile, then the `packageManager` field
 */
function findInFolder(dir: string): PackageManager | undefined {
  for (const [file, name] of LOCKFILES) {
    if (fs.existsSync(path.join(dir, file))) {
      return name
    }
  }
  return readPackageManagerField(path.join(dir, 'package.json'))
}

function findAtOrAbove(dir: string): PackageManager | undefined {
  for (let current = dir; ; current = path.dirname(current)) {
    const found = findInFolder(current)
    if (found !== undefined || path.dirname(current) === current) {
      return found
    }
  }
}

const folderManagers = new Map<string, PackageManager | null>()

/**
 * The package manager of the project at or above `dir`: the nearest folder with a pnpm or npm
 * lockfile, `pnpm-workspace.yaml` or a `packageManager` field of npm or pnpm decides, its lockfiles
 * before its field. Without one, npm when `npm_config_user_agent` says npm runs the process, and
 * pnpm otherwise. The folder lookup is memoized per folder
 */
export function detectPackageManager(dir: string): PackageManager {
  const resolved = path.resolve(dir)
  let manager = folderManagers.get(resolved)
  if (manager === undefined) {
    manager = findAtOrAbove(resolved) ?? null
    folderManagers.set(resolved, manager)
  }
  return (
    manager ??
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- The user's package manager sets it at run time. Turbo's strict env mode leaves it out of this repo's tasks, so their output doesn't depend on it
    (process.env['npm_config_user_agent']?.startsWith('npm/') === true ? 'npm' : 'pnpm')
  )
}

/**
 * The command that installs `packages`, which are shell-quoted already, as dev dependencies of the
 * project at or above `dir`, as in `pnpm add -D a b` or `npm install -D a b`
 */
export function formatInstallCommand(packages: ReadonlyArray<string>, dir: string): string {
  const command = detectPackageManager(dir) === 'npm' ? 'npm install -D' : 'pnpm add -D'
  return [command, ...packages].join(' ')
}
