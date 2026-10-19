import path from 'node:path'

import { resolveSubOptions } from '@gpahal/internal/node/options'
import { describeValue, formatNames, getErrorReason } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import { AREAS, type AreaBuild, type AreaDefinition } from '@/internal/areas'
import { Composer } from '@/internal/composer'
import { commonjs, commonjsExemptions } from '@/internal/configs/commonjs'
import { configFilesExemptions } from '@/internal/configs/config-files'
import { disableTypeChecked } from '@/internal/configs/disable-type-checked'
import { ignores, rootSpellingConfigs } from '@/internal/configs/ignores'
import { javascriptLanguageOptions, linterOptions } from '@/internal/configs/javascript'
import {
  resolveTypescriptParserPath,
  withoutTypescriptEslintRules,
} from '@/internal/configs/typescript-core'
import { duplicateRulesConfigs } from '@/internal/duplicate-configs'
import { CODE_BLOCK_FILES, CODE_FILES } from '@/internal/files'
import {
  patchContradictingReports,
  patchReportOnlyRules,
  patchUnsafeFixes,
  removeUnusedImportsFixes,
  reportOnlyFixes,
  withLibraryReportOnlyScope,
  withRulesOn,
} from '@/internal/fixes'
import {
  formattingOffConfig,
  withoutFormattingRules as withoutPresetFormattingRules,
} from '@/internal/formatting'
import { withSetupNamed } from '@/internal/naming'
import { checkCorePeerVersions, checkPeerVersions, combinePeerErrors } from '@/internal/peers'
import { GPAHAL_PLUGIN } from '@/internal/plugin'
import { withPresetSlopPlugin } from '@/internal/presets/antislop'
import { resolveOptions, type ResolvedOptions } from '@/internal/resolve'
import { createRootSpellingCheck } from '@/internal/root-spelling'
import { patchRuleSet } from '@/internal/rule-patches'
import { getPlugins, normalizeSeverities } from '@/internal/rules'
import type {
  ConfigWithExtends,
  EslintConfigOptions,
  TypedConfig,
  TypedRules,
} from '@/internal/types'
import {
  copyUserConfigs,
  getPresets,
  normalizeUserConfigs,
  scopeUserConfig,
} from '@/internal/user-configs'
import { bindWarnings, fail, formatErrorMessage, PREFIX, withWarnings } from '@/internal/utils'
import {
  checkAreaRuleNames,
  checkUserConfigRuleNames,
  getPluginOffOptions,
  validateOptions,
} from '@/internal/validate'
import { markdownSharedRulesConfigs, virtualFilesConfigs } from '@/internal/virtual-files'

export { files } from '@/internal/files'
export { untyped } from '@/internal/user-configs'

export type { Composer } from '@/internal/composer'

export type {
  AntislopOptions,
  CommonjsOptions,
  ConfigNames,
  E18eOptions,
  EslintConfigOptions,
  ImportsCyclesOptions,
  ImportsOptions,
  MarkdownOptions,
  NextjsOptions,
  NodeOptions,
  PlaywrightOptions,
  ReactOptions,
  StorybookOptions,
  TailwindcssOptions,
  TypeAwareOptions,
  TypedConfig,
  TypedRules,
  TypescriptOptions,
  VitestOptions,
  WarningsOptions,
} from '@/internal/types'

export type { GpahalWarningCode } from '@/internal/utils'

/**
 * Copies of `configs` without the rules that eslint-config-prettier turns off, also in their
 * `extends`, for a plugin's preset that `configs` would reject, such as eslint-plugin-vue's. A
 * string in `extends` stays. `no-unexpected-multiline` stays, as in the presets
 *
 * @throws TypeError when `configs` isn't a config object or an array of them
 * @example
 * ```ts
 * import { defineConfig, withoutFormattingRules } from '@gpahal/eslint-config'
 *
 * const vendorPreset = [{ rules: { 'max-len': 'error', 'no-console': 'error' } }] as const
 *
 * export default defineConfig({
 *   root: import.meta.dirname,
 *   configs: withoutFormattingRules(vendorPreset),
 * })
 * ```
 */
export function withoutFormattingRules(
  configs: ConfigWithExtends | ReadonlyArray<ConfigWithExtends>,
): Array<ConfigWithExtends> {
  const list: ReadonlyArray<unknown> = Array.isArray(configs) ? configs : [configs]
  for (const [index, config] of list.entries()) {
    if (!isRecord(config)) {
      fail(
        [
          '`withoutFormattingRules()`',
          Array.isArray(configs) ? `\`configs[${String(index)}]\`` : '`configs`',
        ],
        `expected a config object, received ${describeValue(config)}`,
      )
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Each element was checked to be an object above
  const checked = list as ReadonlyArray<ConfigWithExtends>
  return checked.map((config) => withoutConfigFormattingRules(config))
}

function withoutConfigFormattingRules(config: ConfigWithExtends): ConfigWithExtends {
  const [copy = config] = withoutPresetFormattingRules([{ ...config }], [])
  const extended: unknown = config.extends
  if (!Array.isArray(extended)) {
    return copy
  }
  const strip = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map((nested) => strip(nested))
      : isRecord(item)
        ? withoutConfigFormattingRules(item)
        : item
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The same `extends`, with each config object replaced by a copy
  return { ...copy, extends: extended.map((item) => strip(item)) as ConfigWithExtends['extends'] }
}

type BuiltArea = AreaBuild & {
  kind: AreaDefinition['kind']
  markdownRules?: TypedRules | undefined
}

/**
 * Without the typescript-eslint rules a JavaScript-only project's configs can't turn on
 */
async function buildAreas(resolved: ResolvedOptions): Promise<Array<BuiltArea>> {
  const built = await buildAreasInParallel(resolved)
  if (!resolved.javascriptOnly) {
    return built
  }
  return built.map((area) => ({
    ...area,
    configs: withoutTypescriptEslintRules(area.configs),
    ...(area.userRules && { userRules: withoutTypescriptEslintRules(area.userRules) }),
    ...(area.exemptions && { exemptions: withoutTypescriptEslintRules(area.exemptions) }),
    ...(area.codeBlockConfigs && {
      codeBlockConfigs: withoutTypescriptEslintRules(area.codeBlockConfigs),
    }),
  }))
}

/**
 * A failure is the first rejected area's in `AREAS` order, regardless of completion order. A
 * foreign error, such as a plugin's load error, becomes the cause of one that names the option
 */
async function buildAreasInParallel(resolved: ResolvedOptions): Promise<Array<BuiltArea>> {
  const areas: Array<[string, AreaDefinition]> = Object.entries(AREAS)
  const onAreas = areas.filter(([name]) => Reflect.get(resolved.isOn, name) === true)
  const results = await Promise.allSettled(
    onAreas.map(async ([name, area]): Promise<BuiltArea> => {
      const { peers = [] } = area
      checkPeerVersions(name, typeof peers === 'function' ? peers(resolved.options) : peers)
      const built = await area.build(resolved)
      return { ...built, kind: area.kind, markdownRules: area.markdownRules }
    }),
  )
  // Every area's missing and outdated peers at once, not one area's per run
  const peersError = combinePeerErrors(
    results.flatMap((result): Array<unknown> =>
      result.status === 'rejected' ? [result.reason] : [],
    ),
  )
  if (peersError !== undefined) {
    throw peersError
  }
  return results.map((result, index) => {
    if (result.status === 'rejected') {
      const error: unknown = result.reason
      if (error instanceof Error && error.message.startsWith(`${PREFIX}: `)) {
        throw error
      }
      const [name = '', area] = onAreas[index] ?? []
      const what = area?.kind === 'preset' ? 'the preset' : "the area's plugins"
      // ESLint's CLI prints only the stack, which starts with this message, not the cause's
      throw new Error(
        formatErrorMessage([formatNames([name])], `can't load ${what}: ${getErrorReason(error)}`),
        { cause: error },
      )
    }
    return result.value
  })
}

type BuiltConfigs = {
  /**
   * The base configs, the presets, the areas' `rules`, then the exemptions
   */
  configs: Array<TypedConfig>
  /**
   * For code blocks and Astro `<script>` blocks, after your `configs`
   */
  tail: Array<TypedConfig>
}

/**
 * Formatting rules removed and `warn`s made errors, but not in your `rules`
 */
async function buildConfigs(resolved: ResolvedOptions): Promise<BuiltConfigs> {
  const { options, root, isOn } = resolved
  const areas = await buildAreas(resolved)
  const configsOf = (kind: AreaDefinition['kind']) =>
    areas.filter((area) => area.kind === kind).flatMap((area) => area.configs)
  const presetConfigs: Array<TypedConfig> = [
    ...withSetupNamed('gpahal/setup', [
      { plugins: { '@gpahal': GPAHAL_PLUGIN } },
      ...ignores({ gitignores: resolved.gitignores, ignores: resolved.ignores, root }),
      linterOptions(),
      javascriptLanguageOptions({
        files: CODE_FILES,
        root,
        typeAware: resolved.typeAware !== undefined,
        allowDefaultProject: resolved.allowDefaultProject,
        defaultProjectFileCount: resolved.defaultProjectFileCount,
        javascriptOnly: resolved.javascriptOnly,
      }),
      ...(isOn.imports
        ? [
            (await import('@/internal/configs/imports')).importsSettings({
              project: resolved.tsconfigFiles,
              ...(resolved.javascriptOnly && { typescriptParser: resolveTypescriptParserPath() }),
            }),
          ]
        : []),
      ...configsOf('code'),
      ...commonjs({ files: resolved.commonjs.files }),
      ...configsOf('file'),
    ]),
    ...configsOf('preset'),
    ...markdownSharedRulesConfigs(resolved, areas),
  ]
  presetConfigs.push(...duplicateRulesConfigs(presetConfigs, resolved))
  checkAreaRuleNames(options, presetConfigs)
  // Except the warnings the presets set on purpose, as `vitest/no-disabled-tests`
  const configs = normalizeSeverities(
    withoutPresetFormattingRules(
      // Loading this module would load typescript-eslint
      resolved.javascriptOnly
        ? presetConfigs
        : (await import('@/internal/project-service')).withProjectServiceParser(presetConfigs),
      options.allowFormattingRules ?? [],
    ),
  )
  const patchedFixes = patchUnsafeFixes(configs, root)
  patchContradictingReports(configs, root)
  patchRuleSet(configs, root)
  const areaConfigs = (key: 'userRules' | 'exemptions' | 'codeBlockConfigs') =>
    areas.flatMap((area) => area[key] ?? [])
  return {
    configs: [
      ...configs,
      ...patchedFixes,
      ...reportOnlyFixes({
        configs,
        root,
        untyped: resolved.untyped,
        isInEditor: resolved.isInEditor,
      }),
      ...(isOn.imports && resolveSubOptions(options.imports)?.removeUnused === true
        ? removeUnusedImportsFixes({ configs, root, isInEditor: resolved.isInEditor })
        : []),
      ...areaConfigs('userRules'),
      // After the areas' `rules`, which can't turn an exempted rule back on, before your `configs`
      ...areaConfigs('exemptions'),
      ...commonjsExemptions({ files: resolved.commonjs.files }),
      ...configFilesExemptions(),
    ],
    tail: [...areaConfigs('codeBlockConfigs'), ...virtualFilesConfigs(resolved, areas)],
  }
}

/**
 * ESLint rejects two plugins of one name, so yours become the wrapped ones
 */
async function withPresetPlugins(
  configs: Array<TypedConfig>,
  { options, isOn }: ResolvedOptions,
): Promise<Array<TypedConfig>> {
  const withEslintComments = isOn.eslintComments
    ? (await import('@/internal/configs/eslint-comments')).withPresetEslintCommentsPlugin(configs)
    : configs
  return isOn.antislop
    ? withPresetSlopPlugin(withEslintComments, resolveSubOptions(options.antislop)?.slop)
    : withEslintComments
}

/**
 * Builds the ESLint config: the presets, the areas' `rules`, the exemptions, `options.configs`, the
 * code-block configs, then the composer's appended configs. The formatting, type-information and
 * root-path guards come last. Export the result from `eslint.config.mjs`.
 *
 * It returns a composer, which ESLint awaits; see `Composer`. With `eslint/config`'s
 * `defineConfig`, spread the awaited configs at the top level: it can't go in `extends`, and
 * configs after it skip the guards.
 *
 * @throws TypeError on an invalid option, a `root` that isn't an absolute folder, a glob that can't
 *   match the files it's for, conflicting options, or a config of `configs` that the checks reject.
 *   Errors that need the plugins, such as a missing optional peer or a misspelled rule, come when
 *   ESLint awaits the config
 * @throws Error when the installed `eslint` or `typescript` is outside this package's peer range
 * @example
 * ```ts
 * import { defineConfig } from '@gpahal/eslint-config'
 *
 * export default defineConfig({ root: import.meta.dirname, react: true })
 * ```
 */
export function defineConfig(options: EslintConfigOptions): Composer {
  // Read before validating, so the peer check's warnings are silenced too
  const untypedOptions: unknown = options
  const warnings = isRecord(untypedOptions) ? untypedOptions['warnings'] : undefined
  return withWarnings(warnings, () => defineConfigWith(options))
}

function defineConfigWith(options: EslintConfigOptions): Composer {
  checkCorePeerVersions()
  const validOptions = validateOptions(options)
  const resolved = resolveOptions(validOptions)
  const context = {
    root: resolved.root,
    codeFiles: resolved.codeFiles,
    allowFormattingRules: validOptions.allowFormattingRules ?? [],
    isOn: resolved.isOn,
    isTypeAware: validOptions.typeAware !== false,
    untypedKinds: resolved.untypedKinds,
    isJavascriptOnly: resolved.javascriptOnly,
    pluginOffOptions: getPluginOffOptions(validOptions, resolved.javascriptOnly),
  }
  // Before the presets load, so a config that throws leaves no rejection unhandled
  const userConfigs = normalizeUserConfigs(
    copyUserConfigs(validOptions.configs ?? []),
    'configs',
    context,
  )
  const built = buildConfigs(resolved)
  // Caches the real paths of folders until the next call
  createRootSpellingCheck(resolved.root)
  return new Composer(
    (async () => {
      const { configs, tail } = await built
      // Once the presets' plugins are loaded, which your configs may name rules of
      const presets = getPresets([...configs, ...userConfigs, ...tail])
      const plugins = getPlugins([...configs, ...userConfigs, ...tail])
      const scoped = userConfigs.flatMap((config) =>
        scopeUserConfig(config, 'configs', {
          presets,
          plugins,
          codeFiles: context.codeFiles,
          isTypeAware: context.isTypeAware,
          untypedKinds: context.untypedKinds,
        }),
      )
      const all = [...configs, ...scoped, ...tail]
      checkUserConfigRuleNames(userConfigs, all, context.pluginOffOptions)
      return all
    })(),
    context,
    // Last: the guards. Bound, since it runs when ESLint awaits the composer
    bindWarnings(async (configs: Array<TypedConfig>) => {
      // Here, so the warnings see the global ignores the methods add
      resolved.warnOfProjectScan(configs)
      const withPlugins = withLibraryReportOnlyScope(await withPresetPlugins(configs, resolved))
      const rooted = withRulesOn([
        ...withPlugins,
        formattingOffConfig(
          [...resolved.codeFiles, ...CODE_BLOCK_FILES],
          validOptions.allowFormattingRules ?? [],
        ),
        ...normalizeSeverities(await disableTypeChecked(resolved, withPlugins)),
      ]).map((config) => ({
        ...config,
        // ESLint's base can be the config folder or, with `--config`, the cwd, so anchor every
        // config, global ignores and guards included
        basePath: path.resolve(resolved.root, config.basePath ?? ''),
      }))
      patchReportOnlyRules(rooted, resolved.root)
      return [...rooted, ...rootSpellingConfigs(resolved.root, rooted)]
    }),
  )
}
