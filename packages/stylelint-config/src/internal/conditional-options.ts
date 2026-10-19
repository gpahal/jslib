import type { Config } from 'stylelint'

import { toArray } from '@gpahal/std/arrays'
import { clonePlain } from '@gpahal/std/objects'

import type { ConfigBuilder } from '@/internal/define'
import { REPORT_KEYS, type ExtendedOptions } from '@/internal/extends'
import { toStylelintExtends } from '@/internal/overrides'
import { overrideGlobs, ownConfig } from '@/internal/paths'
import type { StylelintExtendedConfig, StylelintOverride } from '@/internal/rules'

const KEYS = ['ignoreFiles', 'referenceFiles', 'languageOptions', ...REPORT_KEYS] as const

type Tree<T> =
  | { value: T }
  | { base: Tree<T>; branches: Array<{ files: string | Array<string>; tree: Tree<T> }> }
type Selected = { config: Config; conditional: boolean }
/**
 * A projection's values for your config, and for the preset's settings
 */
type Pair = { own: Config; preset: Config }

function mapTree<T, U>(tree: Tree<T>, map: (value: T) => Tree<U>): Tree<U> {
  const cache = new Map<Tree<T>, Tree<U>>()
  const visit = (node: Tree<T>): Tree<U> => {
    const cached = cache.get(node)
    if (cached !== undefined) return cached
    const result =
      'value' in node
        ? map(node.value)
        : {
            base: visit(node.base),
            branches: node.branches.map(({ files, tree: branch }) => ({
              files,
              tree: visit(branch),
            })),
          }
    cache.set(node, result)
    return result
  }
  return visit(tree)
}

function hasConditional(tree: Tree<Selected>): boolean {
  const seen = new Set<Tree<Selected>>()
  const pending = [tree]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (seen.has(node)) continue
    seen.add(node)
    if ('value' in node) {
      if (node.value.conditional) return true
    } else {
      pending.push(node.base)
      for (const branch of node.branches) pending.push(branch.tree)
    }
  }
  return false
}

function selectOptions(
  configs: ReadonlyArray<StylelintExtendedConfig>,
  overrideConfigs: ReadonlyArray<StylelintExtendedConfig>,
  select: (config: StylelintExtendedConfig) => Config,
  hasValue: (config: Config) => boolean,
): { inherited: Tree<Selected>; userTrees: Array<Tree<Selected>> } {
  const cache = new Map<StylelintExtendedConfig, Tree<Selected>>()
  const empty: Tree<Selected> = { value: { config: ownConfig({}), conditional: false } }
  const replace = (before: Tree<Selected>, after: Tree<Selected>): Tree<Selected> => {
    if (before === after || ('value' in before && !hasValue(before.value.config))) return after
    if ('value' in after) return !hasValue(after.value.config) ? before : after
    return mapTree(after, (value) => (!hasValue(value.config) ? before : { value }))
  }
  const mark = (tree: Tree<Selected>): Tree<Selected> =>
    mapTree(tree, (value) => ({
      value: { ...value, conditional: hasValue(value.config) },
    }))
  const extendedTree = (entries: StylelintExtendedConfig['extends']): Tree<Selected> => {
    let tree: Tree<Selected> = empty
    const extendedEntries = toArray(entries ?? [])
    for (const entry of extendedEntries) {
      if (typeof entry !== 'string') tree = replace(tree, visit(entry))
    }
    return tree
  }
  const visit = (source: StylelintExtendedConfig): Tree<Selected> => {
    const cached = cache.get(source)
    if (cached !== undefined) return cached
    const ownSource = ownConfig(source)
    let children = extendedTree(ownSource.extends)
    let own: Tree<Selected> = { value: { config: select(ownSource), conditional: false } }
    const sourceOverrides = ownSource.overrides ?? []
    for (const sourceOverride of sourceOverrides) {
      const override = ownConfig(sourceOverride)
      const files = toArray(override.files)
      if (override.extends !== undefined) {
        children = {
          base: children,
          branches: [{ files, tree: replace(children, mark(extendedTree(override.extends))) }],
        }
      }
      if (hasValue(select(override))) {
        own = {
          base: own,
          branches: [{ files, tree: { value: { config: select(override), conditional: true } } }],
        }
      }
    }
    const tree = replace(children, own)
    cache.set(source, tree)
    return tree
  }
  return {
    inherited: extendedTree(configs),
    userTrees: overrideConfigs.map((override) => visit(override)),
  }
}

function compile(tree: Tree<Config>): Config {
  const compiled = new Map<Tree<Config>, Config>()
  const visit = (tree: Tree<Config>): Config => {
    const cached = compiled.get(tree)
    if (cached !== undefined) return cached
    const value: Config =
      'value' in tree
        ? clonePlain(tree.value)
        : {
            extends: toStylelintExtends([visit(tree.base)]),
            overrides: tree.branches.map(({ files, tree: branch }) => ({
              files,
              extends: toStylelintExtends([visit(branch)]),
            })),
          }
    compiled.set(tree, value)
    return value
  }
  return visit(tree)
}

type Override = NonNullable<Config['overrides']>[number]

/**
 * Select inherited values with Stylelint's shallow, last-writer merging. Unconditional leaves use
 * the collected defaults; a matching inherited override replaces that key before user merging.
 * Separate trees per key avoid combinations of unrelated language, ignore and report overrides.
 * The preset's settings of the reference rules, which follow `referenceFiles`, get a tree of their
 * own right after the preset's settings in `extends`, so the configs of your `extends` and of your
 * overrides' still beat them. `builderFor` gives the config built with a set of inherited options,
 * built once for each, with your overrides: building it checks the whole override list against
 * those options, and its `overridesOf` rebuilds one override without rebuilding the rest, so each
 * conditional branch of an override costs the same however many overrides there are
 */
export function preserveConditionalOptions(
  config: Config,
  root: string,
  configs: ReadonlyArray<StylelintExtendedConfig>,
  overrideConfigs: ReadonlyArray<StylelintExtendedConfig>,
  overrides: Array<StylelintOverride>,
  options: ExtendedOptions,
  builderFor: (options: ExtendedOptions) => ConfigBuilder,
): Config {
  const result = { ...config }
  const projections: Array<Config> = []
  for (const key of KEYS) {
    const { inherited, userTrees } = selectOptions(
      configs,
      overrideConfigs,
      (source) => ({ [key]: source[key] }),
      (selected) => selected[key] !== undefined,
    )
    if (!hasConditional(inherited) && userTrees.every((tree) => !hasConditional(tree))) continue
    const selectedOptions = new Map<Selected, ExtendedOptions>()
    const setOption = (selected: Selected): ExtendedOptions => {
      if (!selected.conditional) return options
      let selectedOption = selectedOptions.get(selected)
      if (selectedOption === undefined) {
        selectedOption = ['ignoreFiles', 'referenceFiles', 'languageOptions'].includes(key)
          ? { ...options, [key]: selected.config[key] }
          : { ...options, reports: { ...options.reports, [key]: selected.config[key] } }
        selectedOptions.set(selected, selectedOption)
      }
      return selectedOption
    }
    // The key's values of overrides
    const pickOverrides = (built: ReadonlyArray<Override>): Array<Override> =>
      built.flatMap((override) =>
        override[key] === undefined ? [] : { files: override.files, [key]: override[key] },
      )
    const isReference = key === 'referenceFiles'
    // With `referenceFiles`, the preset's settings of the rules that read them too, which go with
    // the preset's other settings, below those of your `extends` configs
    let projected: Tree<Pair> = mapTree(inherited, (selected): Tree<Pair> => {
      // Building checks the complete override list against each effective top-level state
      const builder = builderFor(setOption(selected))
      const built = builder.config
      return {
        value: {
          own: {
            [key]: built[key],
            overrides: pickOverrides((built.overrides ?? []).slice(0, builder.presetOverrideCount)),
          },
          preset: isReference ? builder.presetReferenceLayer : {},
        },
      }
    })
    for (const [index, userTree] of userTrees.entries()) {
      const userOverride = overrides[index]
      if (userOverride === undefined) continue
      const branch = mapTree(inherited, (selected) => {
        const builder = builderFor(setOption(selected))
        return mapTree(userTree, (userSelected): Tree<Pair> => {
          const override = userSelected.conditional
            ? { ...userOverride, [key]: userSelected.config[key] }
            : userOverride
          const built = builder.overridesOf(override, index)
          return {
            value: {
              own: { overrides: pickOverrides(built.overrides) },
              preset: isReference ? { overrides: built.presetOverrides } : {},
            },
          }
        })
      })
      // Each user override merges over top-level settings, never over preceding overrides.
      // Emit its delta independently so unchanged rule keys retain earlier matching settings.
      projected = {
        base: projected,
        branches: [
          {
            files: overrideGlobs(userOverride.files, root),
            tree: branch,
          },
        ],
      }
    }
    // Outer own keys would shadow the selected inherited values again. Their merged values and
    // user overrides live in the projection, while Stylelint keeps merging all other config keys
    Reflect.deleteProperty(result, key)
    if (result.overrides !== undefined)
      result.overrides = result.overrides.map((override) => {
        const copy = { ...override }
        Reflect.deleteProperty(copy, key)
        return copy
      })
    if (isReference) {
      // Right after the preset's settings, whose reference rule settings it replaces
      const extended: Array<string | StylelintExtendedConfig> = toArray(result.extends ?? [])
      const presetIndex = extended.indexOf(builderFor(options).presetLayer)
      result.extends = toStylelintExtends([
        ...extended.slice(0, presetIndex + 1),
        compile(mapTree(projected, ({ preset }) => ({ value: preset }))),
        ...extended.slice(presetIndex + 1),
      ])
    }
    projections.push(compile(mapTree(projected, ({ own }) => ({ value: own }))))
  }
  if (projections.length > 0) {
    result.extends = toStylelintExtends([...toArray(result.extends ?? []), ...projections])
    if (result.overrides !== undefined)
      result.overrides = result.overrides.map((override) =>
        override.extends === undefined
          ? override
          : {
              ...override,
              extends: toStylelintExtends([...toArray(override.extends), ...projections]),
            },
      )
  }
  return result
}
