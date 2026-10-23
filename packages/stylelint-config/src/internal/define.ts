import type { Config } from 'stylelint'
import useBaseline from 'stylelint-plugin-use-baseline'

import { resolveListOption } from '@gpahal/internal/node/options'
import type { ListOption } from '@gpahal/internal/node/options'
import { resolvePath } from '@gpahal/internal/node/resolve'
import { checkRoot } from '@gpahal/internal/node/root'
import { assertValid } from '@gpahal/internal/node/zod'
import { toArray } from '@gpahal/std/arrays'
import { clonePlain, isRecord, omitUndefinedValues } from '@gpahal/std/objects'

import { BASE_RULES } from '@/internal/base-rules'
import { commentLayout } from '@/internal/comment-layout'
import { preserveConditionalOptions } from '@/internal/conditional-options'
import { customPropertyEmptyLineBefore } from '@/internal/custom-property-empty-line-before'
import { declarationEmptyLineBefore } from '@/internal/declaration-empty-line-before'
import { extendedRulesOf, loadExtends, markPresetLayer } from '@/internal/extends'
import type { ExtendedOptions } from '@/internal/extends'
import {
  fileTypeOverrides,
  fileTypesOfOverride,
  mixedTypesError,
  splitGlobsByType,
} from '@/internal/file-types'
import type { FileType } from '@/internal/file-types'
import { mediaRangeSpacing } from '@/internal/media-range-spacing'
import {
  checkIgnoreGlobs,
  checkOverride,
  checkOverrides,
  checkReferenceGlobs,
  checkRejectedKeys,
  optionsSchema,
  PREFIX,
} from '@/internal/options'
import type { StylelintConfigOptions } from '@/internal/options'
import { toOverride, toReferenceFile, toStylelintExtends } from '@/internal/overrides'
import { OWN_RULES, toOwnRules } from '@/internal/own-rules'
import {
  checkReferencePathsExist,
  isPortableOverride,
  normalizeConfigPaths,
  normalizeOverride,
  overrideGlobs,
  ownConfig,
  portableOverride,
  toLiteralGlob,
} from '@/internal/paths'
import { presetRules, referenceRulesOf } from '@/internal/preset-rules'
import { quoteRules } from '@/internal/quote-rules'
import {
  mergeDeepWith,
  mergeRules,
  mergeUserRules,
  replaceLayer,
  settingIn,
} from '@/internal/rules'
import type {
  StylelintConfig,
  StylelintOverride,
  StylelintReferenceFile,
  StylelintRules,
} from '@/internal/rules'
import { loadTailwindDesign, TAILWIND_APPLY, tailwindApply } from '@/internal/tailwind-apply'
import type { TailwindDesign } from '@/internal/tailwind-apply'
import { tailwindDirectives } from '@/internal/tailwind-directives'
import { tailwindThemeFunction } from '@/internal/tailwind-theme-function'
import {
  outsideThemeGraphLoader,
  resolveTailwindImport,
  tailwindcssConfig,
  tailwindPropertyNames,
  tailwindReferenceFiles,
  tailwindThemeLoader,
} from '@/internal/tailwindcss'
import type { TailwindReferences } from '@/internal/tailwindcss'

type Override = NonNullable<Config['overrides']>[number]

type ReferenceFile = Extract<NonNullable<Config['referenceFiles']>, Array<unknown>>[number]

function pickRules(
  rules: Readonly<Record<string, unknown>>,
  isKept: (name: string) => boolean,
): StylelintRules {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- A subset of the rules
  return Object.fromEntries(
    Object.entries(rules).filter(([name]) => isKept(name)),
  ) as StylelintRules
}

/**
 * The `@gpahal/tailwind-apply` settings of `config` and its overrides
 */
function onlyTailwindApply(config: Config): Config {
  const rulesOf = (rules: Config['rules'] = {}): StylelintRules =>
    pickRules(rules, (name) => name === TAILWIND_APPLY)
  const overrides = (config.overrides ?? [])
    .map(({ files, rules }) => ({ files, rules: rulesOf(rules) }))
    .filter(({ rules }) => Object.keys(rules).length > 0)
  return {
    rules: rulesOf(config.rules),
    ...(overrides.length > 0 && { overrides }),
  }
}

/**
 * Conditional branches reuse one callback result, copying it before each list resolution
 */
function onceList(option: ListOption | undefined): ListOption | undefined {
  if (typeof option !== 'function') return option
  let value: ReadonlyArray<string> | undefined
  return (defaults) => {
    value ??= clonePlain(option(defaults))
    return clonePlain(value)
  }
}

/**
 * Build the preset. Paths and globs resolve from `root`, and a loaded config's from its own folder,
 * except override `files`, which match from `root`, as in Stylelint. Pass `extends`, `plugins`,
 * `languageOptions`, `overrides`, `rules`, `ignoreFiles` and `referenceFiles` here rather than
 * spreading them over the result, which would replace what the preset built.
 *
 * @throws TypeError on invalid options, a `tailwindcss.entryPoint` or import that can't be read,
 *   or an override that can't merge, as listed in
 *   https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#options
 */
export async function defineConfig(options: StylelintConfigOptions): Promise<StylelintConfig> {
  const untypedOptions: unknown = options
  checkRejectedKeys(untypedOptions)
  const validOptions = assertValid(optionsSchema(), untypedOptions, {
    prefix: PREFIX,
    rootSubject: 'options',
  })
  checkRoot(PREFIX, validOptions.root)
  if (validOptions.referenceFiles !== undefined) {
    checkReferenceGlobs(validOptions.referenceFiles, 'referenceFiles')
    checkReferencePathsExist(validOptions.referenceFiles, validOptions.root, 'referenceFiles')
  }
  const userOverrides = checkOverrides(validOptions.overrides ?? [])
  // Checked with the subjects you gave them; `loadExtends` doesn't check them again
  for (const [index, override] of userOverrides.entries()) {
    if (override.referenceFiles !== undefined) {
      checkReferencePathsExist(
        override.referenceFiles,
        validOptions.root,
        `overrides[${index}].referenceFiles`,
      )
    }
  }
  const extended = await loadExtends(validOptions.extends, validOptions.root, {
    userOverrides,
    hasTailwindDesign:
      isRecord(validOptions.tailwindcss) && validOptions.tailwindcss.validateApply === true,
  })
  const stableOptions = {
    ...validOptions,
    // Resolved before the preset's plugins go first, so an error names your plugin's index
    ...(validOptions.plugins !== undefined && {
      plugins: normalizeConfigPaths(
        { plugins: toArray(validOptions.plugins).flat() },
        validOptions.root,
      ).plugins,
    }),
    ignoreFiles:
      typeof validOptions.ignoreFiles === 'string'
        ? validOptions.ignoreFiles
        : onceList(validOptions.ignoreFiles),
    ...(isRecord(validOptions.tailwindcss) && {
      tailwindcss: {
        ...validOptions.tailwindcss,
        functions: onceList(validOptions.tailwindcss.functions),
        atRules: onceList(validOptions.tailwindcss.atRules),
      },
    }),
  }
  let tailwindFiles: TailwindReferences | undefined
  // Only Tailwind's asynchronous `compile()` gives the `--tw-*` properties, so they're found here
  if (isRecord(validOptions.tailwindcss) && validOptions.tailwindcss.entryPoint !== undefined) {
    const files = tailwindReferenceFiles(validOptions.tailwindcss.entryPoint, validOptions.root)
    tailwindFiles = { ...files, properties: await tailwindPropertyNames(files.theme) }
  }
  const referenceFilesResolver: typeof tailwindReferenceFiles = (entryPoint, root) => {
    tailwindFiles ??= tailwindReferenceFiles(entryPoint, root)
    return tailwindFiles
  }
  let tailwindDesign: TailwindDesign | undefined
  if (isRecord(validOptions.tailwindcss) && validOptions.tailwindcss.validateApply === true) {
    const { entryPoint } = validOptions.tailwindcss
    const files = referenceFilesResolver(entryPoint, validOptions.root)
    tailwindDesign = await loadTailwindDesign({
      entryPath: entryPoint === undefined ? undefined : files.files[0],
      theme: files.theme,
      prefix: files.prefix,
      resolveImport: resolveTailwindImport,
    })
  }
  // One builder for each set of inherited top-level options, which conditional branches share
  const builders = new WeakMap<ExtendedOptions, ConfigBuilder>()
  const builderFor = (extendedOptions: ExtendedOptions): ConfigBuilder => {
    const cached = builders.get(extendedOptions)
    if (cached !== undefined) return cached
    const built = createConfigBuilder(
      ownConfig({ ...stableOptions, extends: extended.configs, overrides: extended.overrides }),
      extendedOptions,
      referenceFilesResolver,
      tailwindDesign,
    )
    const builder: ConfigBuilder = {
      ...built,
      config: normalizeConfigPaths(built.config, validOptions.root),
      overridesOf: (override, index) => {
        const parts = built.overridesOf(override, index)
        return {
          ...parts,
          overrides: parts.overrides.map((entry) =>
            normalizeOverride(entry, validOptions.root, `overrides[${index}]`),
          ),
        }
      },
    }
    builders.set(extendedOptions, builder)
    return builder
  }
  return preserveConditionalOptions(
    builderFor(extended.options).config,
    validOptions.root,
    extended.configs,
    extended.overrideConfigs,
    extended.overrides,
    extended.options,
    builderFor,
  )
}

/**
 * Build static presets without resolving their globs against a consumer project
 */
export function buildConfig(
  validOptions: StylelintConfigOptions,
  extendedOptions: ExtendedOptions = {},
  referenceFilesResolver: typeof tailwindReferenceFiles = tailwindReferenceFiles,
): Config {
  return createConfigBuilder(validOptions, extendedOptions, referenceFilesResolver).config
}

/**
 * A built config, with what rebuilding one of its overrides needs
 */
export type ConfigBuilder = {
  config: Config
  /**
   * The number of the preset's file type overrides, before yours
   */
  presetOverrideCount: number
  /**
   * The config in `config.extends` with the preset's own settings
   */
  presetLayer: Config
  /**
   * The preset's settings of the reference rules, `null` where it doesn't set them, and those of
   * its file type overrides
   */
  presetReferenceLayer: Config
  /**
   * The overrides that replace yours at `index`, and the preset-layer ones that turn on its
   * reference rules, without rebuilding the config
   */
  overridesOf: (
    override: StylelintOverride,
    index: number,
  ) => { overrides: Array<Override>; presetOverrides: Array<Override> }
}

/**
 * {@link buildConfig}, keeping the top-level settings for {@link ConfigBuilder.overridesOf}
 */
function createConfigBuilder(
  validOptions: StylelintConfigOptions,
  extendedOptions: ExtendedOptions = {},
  referenceFilesResolver: typeof tailwindReferenceFiles = tailwindReferenceFiles,
  tailwindDesign?: TailwindDesign,
): ConfigBuilder {
  const {
    root,
    tailwindcss = false,
    astro = true,
    html = true,
    markdown = true,
    commentLayout: isCommentLayoutOn = true,
    logical = false,
    plugins = [],
    rules: givenRules = {},
    overrides: givenOverrides = [],
    ignoreFiles,
    referenceFiles = [],
    extends: extended = [],
    languageOptions: userLanguageOptions,
    defaultSeverity,
    customSyntax,
    processors,
    ...stylelintKeys
  } = validOptions
  // `defineConfig` has checked `referenceFiles`, and the static presets have none. The overrides
  // come with your `extends` configs' settings, so they're checked whole
  const overrides = checkOverrides(givenOverrides)
  const referenceEntries = [
    ...toArray(extendedOptions.referenceFiles ?? []),
    ...toArray(referenceFiles),
  ]
  const tailwindOptions = isRecord(tailwindcss) ? tailwindcss : {}
  // Tailwind's files join your reference files, at the top level and in an override, and a given
  // entry point turns them on at the top level by itself
  const hasTopLevelTailwindFiles =
    tailwindOptions.entryPoint !== undefined || referenceEntries.length > 0
  const hasOwnReferenceFiles = (override: StylelintOverride): boolean =>
    toArray(override.referenceFiles ?? []).length > 0
  const referencingOverrideCount = overrides.filter((override) =>
    hasOwnReferenceFiles(override),
  ).length
  const referenceFilesFor = (withTailwind: boolean) => {
    const tailwindFiles =
      tailwindcss === false || !withTailwind
        ? undefined
        : referenceFilesResolver(tailwindOptions.entryPoint, root)
    const tailwindGlobs = tailwindFiles?.files.map((file) => toLiteralGlob(file)) ?? []
    const properties = tailwindFiles?.properties ?? []
    const resets = tailwindFiles?.resets ?? []
    const tailwindReferenceFileList: Array<ReferenceFile> =
      tailwindFiles === undefined ||
      (tailwindFiles.prefix === undefined && properties.length === 0 && resets.length === 0)
        ? tailwindGlobs
        : [
            {
              files: tailwindGlobs,
              loader: tailwindThemeLoader({
                prefix: tailwindFiles.prefix,
                theme: tailwindFiles.theme,
                properties,
                resets,
              }),
            },
          ]
    // Under a theme prefix, your reference files skip the files of the theme's import graph, which
    // load once, through it, with the prefix. An entry with its own loader is read as you give it
    const graphLoader =
      tailwindFiles?.prefix === undefined ? undefined : outsideThemeGraphLoader(tailwindFiles.files)
    const toUserReferenceFile = (file: string | StylelintReferenceFile): ReferenceFile => {
      const entry = toReferenceFile(file)
      if (graphLoader === undefined) {
        return entry
      }
      if (typeof entry === 'string') {
        return { files: [entry], loader: graphLoader }
      }
      return entry.loader === undefined ? { ...entry, loader: graphLoader } : entry
    }
    return {
      base: [
        ...referenceEntries.map((file) => toUserReferenceFile(file)),
        ...tailwindReferenceFileList,
      ],
      toUserReferenceFile,
    }
  }
  const referenceFilesCache = new Map<boolean, ReturnType<typeof referenceFilesFor>>()
  const cachedReferenceFilesFor = (withTailwind: boolean): ReturnType<typeof referenceFilesFor> => {
    let references = referenceFilesCache.get(withTailwind)
    if (references === undefined) {
      references = referenceFilesFor(withTailwind)
      referenceFilesCache.set(withTailwind, references)
    }
    return references
  }
  const referenceFileList = hasTopLevelTailwindFiles ? cachedReferenceFilesFor(true).base : []
  const hasReferenceFiles = referenceFileList.length > 0
  const preset = presetRules({
    commentLayout: isCommentLayoutOn,
    hasReferenceFiles,
    tailwindcss: tailwindcss !== false,
    logical,
  })
  const referenceRules = referenceRulesOf(tailwindcss !== false)
  const tailwind =
    tailwindcss === false
      ? undefined
      : tailwindcssConfig(tailwindOptions, (name) => settingIn(preset, name, BASE_RULES))
  const rules = toOwnRules(givenRules)
  // The layout mapping rules fix only with a directionality. Horizontal left-to-right is CSS's default
  const presetLanguageOptions: Config['languageOptions'] = {
    ...(tailwind && { syntax: tailwind.syntax }),
    ...(logical && { directionality: { block: 'top-to-bottom', inline: 'left-to-right' } }),
  }
  const languageOptions = mergeDeepWith<Config['languageOptions']>(
    mergeDeepWith(presetLanguageOptions, extendedOptions.languageOptions),
    userLanguageOptions,
  )
  // The rules of your `extends` configs replace the preset's whole, as in Stylelint, and yours
  // merge over them. The base configs the preset builds on add none
  const extendedRules = extendedOptions.rules ?? {}
  const extendedLayer = replaceLayer(toOwnRules(extendedRules))
  const presetWithExtended = mergeRules({ ...preset, ...tailwind?.rules }, extendedLayer, {
    base: BASE_RULES,
  })
  const configRules = mergeRules(presetWithExtended, rules, { base: BASE_RULES })
  // The preset's file type overrides, with the extended top-level settings of the rules they set.
  // An extended config comes after the preset in `extends`, so its setting beats the preset's
  // override, a `null` included, as in Stylelint
  const fileTypes = fileTypeOverrides({
    astro,
    html,
    markdown,
    tailwindcss: tailwindcss !== false,
  }).map((fileType) => {
    const overrideRules = fileType.override.rules
    if (overrideRules === undefined) {
      return { ...fileType, presetRules: undefined, userRuleFilter: undefined }
    }
    const typeRuleNames = Object.fromEntries(Object.keys(overrideRules).map((name) => [name, true]))
    return {
      ...fileType,
      presetRules: overrideRules,
      // Your top-level rules skip the ones the preset turns off for the type on purpose, unless an
      // extended config sets them
      userRuleFilter: Object.fromEntries(
        Object.entries(overrideRules).map(([name, setting]) => [
          name,
          Object.hasOwn(extendedLayer, name) || setting,
        ]),
      ),
      override: {
        ...fileType.override,
        rules: mergeRules(overrideRules, extendedLayer, { presetOnly: typeRuleNames }),
      },
    }
  })
  // An override's rules would replace your top-level ones, so they're merged into them, except
  // where the preset's override turns a rule off
  const onFileTypes = fileTypes
    .filter(({ isOn }) => isOn)
    .map(({ type, userRuleFilter, override: { rules: overrideRules, ...override } }) => ({
      type,
      override: {
        ...override,
        ...(overrideRules && {
          rules: mergeRules(overrideRules, rules, { presetOnly: userRuleFilter ?? true }),
        }),
      },
    }))
  const rulesOfType = (type: FileType): Readonly<Record<string, unknown>> =>
    onFileTypes.find((fileType) => fileType.type === type)?.override.rules ?? {}
  const presetRulesOfType = (type: FileType): Readonly<Record<string, unknown>> =>
    fileTypes.find((fileType) => fileType.type === type)?.override.rules ?? {}
  const topLevelRules: Readonly<Record<string, unknown>> = { ...BASE_RULES, ...configRules }
  // The same without your top-level rules, whose primary options an override can change back
  const presetTopLevelRules = { ...BASE_RULES, ...presetWithExtended }
  // A config's own rules beat all of its `extends`, their overrides included, so the preset's
  // settings go in an extended config and these are only yours, merged
  const userRuleNames = new Set(
    Object.keys(rules).filter((name) => settingIn(rules, name) !== undefined),
  )
  const configOwnRules: StylelintRules = pickRules(configRules, (name) => userRuleNames.has(name))
  // Your override's rules merged over its own `extends`, which Stylelint puts over the settings
  // of `type`, the top-level ones, or `presetBase`
  const mergeOverrideRules = (
    type: FileType | undefined,
    override: StylelintOverride,
    overrideRules: StylelintRules,
    index: number,
    presetBase: Readonly<Record<string, unknown>> = {},
  ): StylelintRules => {
    const typeRules = type === undefined ? {} : rulesOfType(type)
    const presetTypeRules = type === undefined ? {} : presetRulesOfType(type)
    const overrideExtendedRules = toOwnRules(extendedRulesOf(override.extends))
    // An extended config's `null` is its setting, which turns the rule off
    const withExtended = (name: string, setting: unknown): unknown => {
      const extendedSetting = settingIn(overrideExtendedRules, name)
      if (extendedSetting !== undefined) return extendedSetting
      return setting === undefined ? settingIn(presetBase, name) : setting
    }
    return mergeUserRules(
      toOwnRules(overrideRules),
      (name) => withExtended(name, settingIn(typeRules, name, topLevelRules)),
      (name) => withExtended(name, settingIn(presetTypeRules, name, presetTopLevelRules)),
      `overrides[${index}].rules`,
    )
  }
  const typesOf = (override: StylelintOverride, index: number) =>
    fileTypesOfOverride(override, index, (type, overrideRules) => {
      const merged: Readonly<Record<string, unknown>> = mergeOverrideRules(
        type,
        override,
        overrideRules,
        index,
      )
      // Your setting of a stock rule is merged as the own rule's that replaces it
      return (rule) => merged[OWN_RULES.find(([stock]) => stock === rule)?.[1] ?? rule]
    })
  // An override of several types splits into one per type where its rules merge differently.
  // Without globs to split by, differing rules throw
  const partsOf = (
    override: StylelintOverride,
    index: number,
  ): Array<{ override: StylelintOverride; types: ReadonlyArray<FileType> }> => {
    const { types, differing } = typesOf(override, index)
    if (differing.length === 0) {
      return [{ override, types }]
    }
    const groups = splitGlobsByType(override.files, `overrides[${index}].files`)
    if (groups === undefined) {
      throw mixedTypesError(override.files, index, differing)
    }
    return [...groups]
      .filter(([type]) => types.includes(type))
      .map(([type, files]) => ({ override: ownConfig({ ...override, files }), types: [type] }))
  }
  const overrideParts = overrides.map((override, index) => partsOf(override, index))
  // The preset's settings for an override with its own reference files: the rules that read them,
  // on where the preset doesn't set them. For several file types, a type's override that sets
  // them, as Markdown's does, is set back after it
  const presetReferenceRulesOf = (
    userOverride: StylelintOverride,
    types: ReadonlyArray<FileType>,
  ): { rules: Record<string, unknown>; overrides: Array<Override> } => {
    if (!hasOwnReferenceFiles(userOverride)) {
      return { rules: {}, overrides: [] }
    }
    const onlyType = types.length === 1 ? types[0] : undefined
    const typePresetRules =
      fileTypes.find(({ type, isOn }) => isOn && type === onlyType)?.presetRules ?? {}
    const names = referenceRules.filter(
      (name) => settingIn(typePresetRules, name, preset) === undefined,
    )
    if (names.length === 0) {
      return { rules: {}, overrides: [] }
    }
    const referenceRuleSettings = Object.fromEntries(names.map((name) => [name, true]))
    const restored = types.flatMap((type) => {
      const fileType = fileTypes.find((entry) => entry.isOn && entry.type === type)
      const typeRules = fileType?.presetRules ?? {}
      const restoredNames = names.filter((name) => Object.hasOwn(typeRules, name))
      return fileType === undefined || types.length < 2 || restoredNames.length === 0
        ? []
        : [
            portableOverride({
              files: fileType.override.files,
              rules: Object.fromEntries(
                restoredNames.map((name) => [name, settingIn(typeRules, name)]),
              ),
            }),
          ]
    })
    const files = overrideGlobs(userOverride.files, root)
    return {
      rules: referenceRuleSettings,
      overrides: [
        {
          files:
            files.length === 1 && typeof userOverride.files === 'string'
              ? (files[0] ?? files)
              : files,
          rules: referenceRuleSettings,
        },
        ...restored,
      ],
    }
  }
  const userIgnoredFiles = resolveListOption(
    typeof ignoreFiles === 'string' ? [ignoreFiles] : ignoreFiles,
    [],
    {
      prefix: PREFIX,
      name: 'ignoreFiles',
    },
  )
  checkIgnoreGlobs(userIgnoredFiles, 'ignoreFiles')
  // Disabled file types are excluded before extended and user globs, whose negations can restore them
  const offTypeGlobs = fileTypes
    .filter(({ isOn }) => !isOn)
    .map(({ override }) => `**/${override.files}`)
  const ignoredFiles = [
    ...offTypeGlobs,
    ...toArray(extendedOptions.ignoreFiles ?? []),
    ...userIgnoredFiles,
  ]
  // Stylelint replaces the top-level `referenceFiles`, `languageOptions` and `ignoreFiles` with an
  // override's, so the override's join the resolved top-level ones, which hold Tailwind's files,
  // syntax and the disabled file types' globs
  const withTopLevel = (userOverride: StylelintOverride, withTailwind: boolean): Override => {
    const override = toOverride(userOverride)
    // Read from your checked override, which has no prototype, so an inherited key isn't read
    const {
      ignoreFiles: overrideIgnoreFiles,
      referenceFiles: overrideReferenceFiles,
      languageOptions: overrideLanguageOptions,
    } = userOverride
    const references =
      overrideReferenceFiles === undefined
        ? undefined
        : cachedReferenceFilesFor(hasTopLevelTailwindFiles || withTailwind)
    return {
      ...override,
      ...(overrideIgnoreFiles !== undefined && {
        ignoreFiles: [...ignoredFiles, ...toArray(overrideIgnoreFiles)],
      }),
      ...(overrideReferenceFiles !== undefined &&
        references !== undefined && {
          referenceFiles: [
            ...references.base,
            ...toArray(overrideReferenceFiles).map((file) => references.toUserReferenceFile(file)),
          ],
        }),
      ...(overrideLanguageOptions !== undefined && {
        languageOptions: mergeDeepWith(languageOptions ?? {}, overrideLanguageOptions),
      }),
    }
  }
  // Your override merges over its files' type override when it matches one type, else over the
  // top-level settings
  const constructOverride = (
    userOverride: StylelintOverride,
    index: number,
    types: ReadonlyArray<FileType>,
    withTailwind: boolean,
  ): { overrides: Array<Override>; presetOverrides: Array<Override> } => {
    const override = withTopLevel(userOverride, withTailwind)
    const onlyType = types.length === 1 ? types[0] : undefined
    const presetReferenceRules = presetReferenceRulesOf(userOverride, types)
    const mergedRules = mergeOverrideRules(
      onlyType,
      userOverride,
      userOverride.rules ?? {},
      index,
      presetReferenceRules.rules,
    )
    return {
      overrides: [
        userOverride.rules === undefined ? override : { ...override, rules: mergedRules },
      ],
      presetOverrides: presetReferenceRules.overrides,
    }
  }
  // The preset's file type overrides keep their syntax and the rules you set that they set too,
  // merged. Their other settings go in the preset's extended config, as at the top level
  const presetOverrides = onFileTypes.map(({ override: { rules: typeRules, ...override } }) => {
    const ownTypeRules =
      typeRules === undefined ? {} : pickRules(typeRules, (name) => userRuleNames.has(name))
    return portableOverride({
      ...override,
      ...(Object.keys(ownTypeRules).length > 0 && { rules: ownTypeRules }),
    })
  })
  // The preset's settings, which the configs of your `extends` replace, as the settings of a
  // config that the static preset extends do
  const presetTypeOverrides = fileTypes.flatMap(
    ({ isOn, override: { files }, presetRules: typeRules }) =>
      isOn && typeRules !== undefined ? [portableOverride({ files, rules: typeRules })] : [],
  )
  // Rule values come from imported configs, constants and your options, so each part gets its own
  // copy. Plugins are kept as they are
  const copyOverride = (override: Override): Override =>
    isPortableOverride(override) ? portableOverride(clonePlain(override)) : clonePlain(override)
  const userParts = overrideParts.flatMap((parts, index) =>
    parts.map(({ override, types }) =>
      constructOverride(override, index, types, referencingOverrideCount > 0),
    ),
  )
  const configOverrides: Array<Override> = [
    ...presetOverrides,
    ...userParts.flatMap((part) => part.overrides),
  ]
  const presetLayerOverrides = [
    ...presetTypeOverrides,
    ...userParts.flatMap((part) => part.presetOverrides),
  ]
  const presetLayer: Config = clonePlain({
    rules: { ...preset, ...tailwind?.rules },
    ...(presetLayerOverrides.length > 0 && { overrides: presetLayerOverrides }),
  })
  // A config that extends this one keeps only the settings of `@gpahal/tailwind-apply`, whose
  // design system only this config has. The extending config's own options decide the others
  markPresetLayer(presetLayer, tailwindDesign === undefined ? {} : onlyTailwindApply(presetLayer))
  const presetReferenceTypeOverrides = presetTypeOverrides.flatMap(
    ({ files, rules: typeRules }) => {
      const typeReferenceRules = pickRules(typeRules, (name) => referenceRules.includes(name))
      return Object.keys(typeReferenceRules).length > 0
        ? [portableOverride({ files, rules: typeReferenceRules })]
        : []
    },
  )
  // Not copied, since only `preserveConditionalOptions` reads it, which copies what it returns
  const presetReferenceLayer: Config = {
    rules: Object.fromEntries(
      referenceRules.map((name) => [name, settingIn(preset, name) ?? null]),
    ),
    ...(presetReferenceTypeOverrides.length > 0 && { overrides: presetReferenceTypeOverrides }),
  }
  const config: Config = {
    // Resolved here, since Stylelint resolves `extends` names from the project's config, and under
    // pnpm the project can't see this package's dependencies
    extends: toStylelintExtends([
      resolvePath((specifier) => import.meta.resolve(specifier), 'stylelint-config-standard'),
      resolvePath((specifier) => import.meta.resolve(specifier), 'stylelint-config-recess-order'),
      presetLayer,
      ...toArray(extended),
    ]),
    ...(defaultSeverity !== undefined && { defaultSeverity }),
    ...(customSyntax !== undefined && { customSyntax }),
    // `--quiet` drops warnings, which would make every disable of the warning
    // `plugin/use-baseline` needless
    reportDescriptionlessDisables: true,
    reportNeedlessDisables: [true, { except: ['plugin/use-baseline'] }],
    reportInvalidScopeDisables: true,
    ...extendedOptions.reports,
    // Stylelint's other keys, as you give them, which replace the preset's
    ...omitUndefinedValues(clonePlain(stylelintKeys)),
    ...(processors !== undefined && { processors: [...processors] }),
    // Registered with their rules off too, so that your rules can turn them on
    plugins: [
      useBaseline,
      mediaRangeSpacing,
      tailwindDirectives,
      tailwindThemeFunction,
      tailwindApply(tailwindDesign),
      commentLayout,
      declarationEmptyLineBefore,
      customPropertyEmptyLineBefore,
      ...quoteRules,
      ...toArray(plugins).flat(),
    ],
    ...(languageOptions != null &&
      Object.keys(languageOptions).length > 0 && { languageOptions: clonePlain(languageOptions) }),
    rules: clonePlain(configOwnRules),
    ...(configOverrides.length > 0 && {
      overrides: configOverrides.map((override) => copyOverride(override)),
    }),
    ...(ignoredFiles.length > 0 && { ignoreFiles: ignoredFiles }),
    ...(hasReferenceFiles && { referenceFiles: clonePlain(referenceFileList) }),
  }
  return {
    config,
    presetOverrideCount: presetOverrides.length,
    presetLayer,
    presetReferenceLayer,
    overridesOf: (givenOverride, index) => {
      const override = checkOverride(givenOverride, index)
      const replaced = overrides[index]
      const otherReferencing =
        referencingOverrideCount -
        (replaced !== undefined && hasOwnReferenceFiles(replaced) ? 1 : 0)
      const parts = partsOf(override, index).map(({ override: part, types }) =>
        constructOverride(
          part,
          index,
          types,
          otherReferencing > 0 || hasOwnReferenceFiles(override),
        ),
      )
      return {
        overrides: parts.flatMap((part) => part.overrides.map((entry) => copyOverride(entry))),
        presetOverrides: parts.flatMap((part) =>
          part.presetOverrides.map((entry) => copyOverride(entry)),
        ),
      }
    },
  }
}
