import { named } from '@/internal/naming'
import { reactDisableTypeChecked } from '@/internal/presets/react'
import type { ResolvedOptions } from '@/internal/resolve'
import { getPlugins, isRuleOn, needsTypeInformation } from '@/internal/rules'
import type { TypedConfig, TypedRules } from '@/internal/types'
import { cloneConfig } from '@/internal/user-configs'

/**
 * The rules that `configs` turn on and that need type information
 */
function typedRulesOn(configs: ReadonlyArray<TypedConfig>): Array<string> {
  const plugins = getPlugins(configs)
  const rules = new Set<string>()
  for (const config of configs) {
    const entries = Object.entries(config.rules ?? {})
    for (const [rule, entry] of entries) {
      if (isRuleOn(entry) && needsTypeInformation(rule, plugins)) {
        rules.add(rule)
      }
    }
  }
  return [...rules]
}

/**
 * Last, so that other configs' `parserOptions` can't turn type information back on for files
 * without it (JavaScript files, code blocks, `.astro` `<script>` blocks) or give `.astro` files a
 * `projectService`, which astro-eslint-parser doesn't support. Every typed rule of `configs` is off
 * in those files. The guards are copies, so in-place edits don't leak into typescript-eslint's
 * configs or another `defineConfig`'s
 */
export async function disableTypeChecked(
  { root, isOn, isAstroTyped, typedAstroFiles, untyped, javascriptOnly }: ResolvedOptions,
  configs: ReadonlyArray<TypedConfig>,
): Promise<Array<TypedConfig>> {
  const guards: Array<TypedConfig> = []
  // The `.astro` program sits beside the project service's. Before the config below, which turns it
  // off for `astro` code blocks
  if (isAstroTyped) {
    guards.push({
      name: 'gpahal/disable-type-checked/astro-program',
      files: typedAstroFiles,
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: true,
          tsconfigRootDir: root,
        },
      },
    })
  }
  if (!javascriptOnly) {
    const { configs: tsEslintConfigs } = await import('typescript-eslint')
    guards.push(...named('disable-type-checked', untyped, [tsEslintConfigs.disableTypeChecked]))
  }
  if (isOn.react) {
    guards.push(...(await reactDisableTypeChecked(untyped)))
  }
  const rules: TypedRules = Object.fromEntries(typedRulesOn(configs).map((rule) => [rule, 'off']))
  guards.push({ name: 'gpahal/disable-type-checked/rules', ...untyped, rules })
  return guards.map((guard) => cloneConfig(guard))
}
