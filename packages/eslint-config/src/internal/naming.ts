import { isDeepStrictEqual } from 'node:util'

import type { ESLint } from 'eslint'
import { defineConfig } from 'eslint/config'

import { formatNames } from '@gpahal/std/errors'

import type { Scope } from '@/internal/globs'
import type { LooseRules, TypedConfig, UpstreamConfig } from '@/internal/types'
import { formatErrorMessage } from '@/internal/utils'

/**
 * Flattens upstream configs into `gpahal/<area>/<upstream name>` configs, so each can be targeted.
 * `extends` intersects upstream `files` with `scope`, as ESLint does. Equal configs of one name are
 * kept once; different ones throw, since dropping one would lose settings. `withSetup` moves the
 * plugins
 */
export function named(
  area: string,
  scope: Scope,
  upstream: Array<UpstreamConfig | Array<UpstreamConfig>>,
): Array<TypedConfig> {
  const prefix = `gpahal/${area}`
  const flattened = defineConfig({
    name: prefix,
    ...scope,
    extends: upstream.flat(),
  })
  const configs = flattened.flatMap((config, index): Array<TypedConfig> => {
    if (config.name === prefix) {
      return []
    }
    const upstreamName = (config.name ?? '').replace(`${prefix} > `, '')
    const suffix = /^ExtendedConfig\[\d+\]$/.test(upstreamName) ? String(index) : upstreamName
    return [{ ...config, name: `${prefix}/${suffix}` }]
  })
  const byName = new Map<string | undefined, TypedConfig>()
  return configs.filter((config) => {
    const earlier = byName.get(config.name)
    if (earlier === undefined) {
      byName.set(config.name, config)
      return true
    }
    if (!isDeepStrictEqual(earlier, config)) {
      throw new Error(
        formatErrorMessage(
          [`config ${formatNames([config.name ?? ''])}`],
          'two different upstream configs have this name, so one would be dropped',
        ),
      )
    }
    return false
  })
}

function describeConfig(config: object): string {
  if ('language' in config || 'languageOptions' in config) {
    return 'language'
  }
  return 'rules' in config ? 'rules' : 'plugins'
}

/**
 * As `recommended/rules`, so `named` names it by what it is rather than by its position
 */
export function nameUpstreamConfigs(
  prefix: string,
  configs: ReadonlyArray<object>,
): Array<UpstreamConfig> {
  const seen = new Set<string>()
  return configs.map((config) => {
    if ('name' in config && typeof config.name === 'string') {
      return config
    }
    let name = `${prefix}/${describeConfig(config)}`
    for (let index = 2; seen.has(name); index++) {
      name = `${prefix}/${describeConfig(config)}-${String(index)}`
    }
    seen.add(name)
    return { ...config, name }
  })
}

/**
 * Moves `plugins` into one config without `files`, so a user config without `files` can turn on
 * their rules. A name registered twice must be the same object, since ESLint keeps only one
 */
export function withSetup(area: string, configs: Array<TypedConfig>): Array<TypedConfig> {
  return withSetupNamed(`gpahal/${area}/setup`, configs)
}

export function withSetupNamed(name: string, configs: Array<TypedConfig>): Array<TypedConfig> {
  const plugins: Record<string, ESLint.Plugin> = {}
  const rest: Array<TypedConfig> = []
  for (const config of configs) {
    const { plugins: configPlugins = {}, ...other } = config
    for (const [pluginName, plugin] of Object.entries(configPlugins)) {
      if (Object.hasOwn(plugins, pluginName) && plugins[pluginName] !== plugin) {
        throw new Error(
          formatErrorMessage(
            [`setup config ${formatNames([name])}`],
            `has two different plugins named ${formatNames([pluginName])}${config.name === undefined ? '' : `, one from the config ${formatNames([config.name])}`}`,
          ),
        )
      }
      plugins[pluginName] = plugin
    }
    // A config with only `files` and `ignores` does nothing, but one with only `ignores` ignores
    const isEmpty = Object.keys(other).every((key) => ['name', 'files', 'ignores'].includes(key))
    if (isEmpty && ('files' in other || !('ignores' in other))) {
      continue
    }
    rest.push(other)
  }
  return Object.keys(plugins).length > 0 ? [{ name, plugins }, ...rest] : rest
}

/**
 * An `undefined` entry is left out, as if missing, since ESLint rejects it
 */
export function rulesConfig(
  area: string,
  scope: Scope,
  rules: LooseRules | undefined,
): Array<TypedConfig> {
  const entries = Object.entries(rules ?? {}).filter(([, entry]) => entry !== undefined)
  return entries.length > 0
    ? [{ name: `gpahal/${area}/user-rules`, ...scope, rules: Object.fromEntries(entries) }]
    : []
}
