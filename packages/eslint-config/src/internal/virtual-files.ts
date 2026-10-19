import type { AreaBuild } from '@/internal/areas'
import { ASTRO_SCRIPT_FILES, CODE_BLOCK_FILES, MARKDOWN_FILES } from '@/internal/files'
import type { ResolvedOptions } from '@/internal/resolve'
import { parseRuleId } from '@/internal/rules'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * The rules of `rules` whose plugin a config of `configs` registers. A core rule has none
 */
function withRegisteredPlugins(rules: TypedRules, configs: Array<TypedConfig>): TypedRules {
  const plugins = new Set(configs.flatMap((config) => Object.keys(config.plugins ?? {})))
  return Object.fromEntries(
    Object.entries(rules).filter(([rule]) => {
      const { pluginName } = parseRuleId(rule)
      return pluginName === undefined || plugins.has(pluginName)
    }),
  )
}

/**
 * The config of the rules other areas turn on in Markdown files, such as `slop/no-em-dash`, left
 * out when the `markdown` area is off
 */
export function markdownSharedRulesConfigs(
  { isOn }: ResolvedOptions,
  builds: ReadonlyArray<AreaBuild & { markdownRules?: TypedRules | undefined }>,
): Array<TypedConfig> {
  const markdownRules = withRegisteredPlugins(
    mergeRules(builds.map((build) => build.markdownRules)),
    builds.flatMap((build) => build.configs),
  )
  return isOn.markdown && Object.keys(markdownRules).length > 0
    ? [{ name: 'gpahal/markdown/shared-rules', files: MARKDOWN_FILES, rules: markdownRules }]
    : []
}

/**
 * The configs that turn off the rules the areas declare don't apply in Markdown code blocks and
 * Astro `<script>` blocks. They come after your areas' `rules` too, so a rule given options there
 * stays off in excerpts. Each is left out when the area that lints those files is off
 */
export function virtualFilesConfigs(
  { isOn }: ResolvedOptions,
  builds: ReadonlyArray<AreaBuild>,
): Array<TypedConfig> {
  const codeBlockRules = mergeRules(builds.map((build) => build.codeBlockRules))
  const astroScriptRules = mergeRules(builds.map((build) => build.astroScriptRules))
  return [
    ...(isOn.markdown && Object.keys(codeBlockRules).length > 0
      ? [
          {
            name: 'gpahal/virtual-files/code-blocks',
            files: CODE_BLOCK_FILES,
            rules: codeBlockRules,
          },
        ]
      : []),
    ...(isOn.astro && Object.keys(astroScriptRules).length > 0
      ? [
          {
            name: 'gpahal/virtual-files/astro-scripts',
            files: ASTRO_SCRIPT_FILES,
            rules: astroScriptRules,
          },
        ]
      : []),
  ]
}

function mergeRules(rules: ReadonlyArray<TypedRules | undefined>): TypedRules {
  return Object.fromEntries(rules.flatMap((entries) => Object.entries(entries ?? {})))
}
