import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolve } from 'import-meta-resolve'

import { toArray } from '@gpahal/std/arrays'
import { isRecord } from '@gpahal/std/objects'

/**
 * The configs `defineConfig` extends, in order
 */
const BASE_CONFIGS = ['stylelint-config-standard', 'stylelint-config-recess-order']

/**
 * Synchronous, since a top-level `await` would stop a CommonJS config from `require`-ing this
 * package
 */
const requireConfig = createRequire(import.meta.url)

/**
 * The names of the packages of the configs `defineConfig` extends, with the configs they extend
 */
const basePackages = new Set<string>()

/**
 * The `name` in the nearest `package.json` with one, by folder
 */
const packageNames = new Map<string, string | undefined>()

/**
 * The `name` of the nearest `package.json` above `filename` that has one
 */
function packageNameOf(filename: string): string | undefined {
  const visited: Array<string> = []
  let name: string | undefined
  let dir = path.dirname(filename)
  for (;;) {
    if (packageNames.has(dir)) {
      name = packageNames.get(dir)
      break
    }
    visited.push(dir)
    let manifest: unknown
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    } catch {
      manifest = undefined
    }
    if (isRecord(manifest) && typeof manifest['name'] === 'string') {
      name = manifest['name']
      break
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const visitedDir of visited) packageNames.set(visitedDir, name)
  return name
}

/**
 * The rules of the config at `url` over those of its `extends`, as Stylelint applies them. Names
 * resolve from the declaring config, since under pnpm only it sees its dependencies
 */
function loadRules(url: string): Record<string, unknown> {
  const filename = fileURLToPath(url)
  const packageName = packageNameOf(filename)
  if (packageName !== undefined) basePackages.add(packageName)
  const loaded: unknown = requireConfig(filename)
  const config: unknown =
    isRecord(loaded) && Object.hasOwn(loaded, 'default') ? loaded['default'] : loaded
  if (!isRecord(config)) {
    return {}
  }
  const { extends: extended = [], rules: ownRules } = config
  let rules: Record<string, unknown> = {}
  for (const name of toArray(extended)) {
    if (typeof name === 'string') {
      rules = { ...rules, ...loadRules(resolve(name, url)) }
    }
  }
  return { ...rules, ...(isRecord(ownRules) && ownRules) }
}

/**
 * The merged rule settings of the configs `defineConfig` extends
 */
export const BASE_RULES: Readonly<Record<string, unknown>> = Object.fromEntries(
  BASE_CONFIGS.flatMap((name) => Object.entries(loadRules(import.meta.resolve(name)))),
)

/**
 * Whether `filename` belongs to a base config package, at any version or location, read from the
 * nearest `package.json` so paths and names match alike
 */
export function isBaseConfigFile(filename: string): boolean {
  const name = packageNameOf(filename)
  return name !== undefined && basePackages.has(name)
}
