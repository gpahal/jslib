/**
 * ESLint exposes its core rules only through `eslint/use-at-your-own-risk`, whose `builtinRules`
 * every 10.x release from 10.11 has. Check it here when the `eslint` peer range widens
 */

import { createRequire } from 'node:module'
import path from 'node:path'

import type { Rule } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'

import { isRecord } from '@gpahal/std/objects'

export function getCoreRule(name: string): Rule.RuleModule | undefined {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- ESLint exposes the core rules nowhere else
  return builtinRules.get(name)
}

/**
 * From `root`, where a project installs the `eslint` it runs. Not from the working directory, which
 * may be an untrusted checkout whose `eslint` this would load
 */
function getProjectRules(root: string): ReadonlyMap<string, Rule.RuleModule> | undefined {
  try {
    const api: unknown = createRequire(path.join(root, 'noop.js'))('eslint/use-at-your-own-risk')
    const rules: unknown = isRecord(api) ? api['builtinRules'] : undefined
    return rules instanceof Map ? (rules as ReadonlyMap<string, Rule.RuleModule>) : undefined
  } catch {
    return undefined
  }
}

/**
 * This package's and `root`'s. They differ when the package manager gives this package its own
 * copy, and a patch of one rule object would miss the copy that runs
 */
export function getCoreRuleCopies(name: string, root: string): Array<Rule.RuleModule> {
  const rules = new Set([getCoreRule(name), getProjectRules(root)?.get(name)])
  return [...rules].filter((rule) => rule !== undefined)
}
