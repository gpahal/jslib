import type { ESLint, Linter } from 'eslint'

import { describeValue } from '@gpahal/std/errors'

import { intersectFiles, type FileSpecs } from '@/internal/globs'
import { withSetup } from '@/internal/naming'
import { importPeers, interopDefault } from '@/internal/peers'
import { parseRuleId } from '@/internal/rules'
import type { TypedConfig, TypedRules } from '@/internal/types'
import { fail } from '@/internal/utils'

export const STORYBOOK_PEERS: Array<string> = ['eslint-plugin-storybook']

/**
 * Storybook's `main` file, which `storybook/no-uninstalled-addons` checks
 */
const STORYBOOK_MAIN_FILES = ['**/.storybook/main.{js,mjs,cjs,ts,mts,cts}']

/**
 * The `storybook/*` rules of `config`, and the rules of other plugins it turns off that a config
 * registers, as in `plugins`, such as `react-hooks/rules-of-hooks`, since ESLint rejects a rule of a
 * plugin no config registers
 */
function pickRules(config: Linter.Config | undefined, plugins: ReadonlySet<string>): TypedRules {
  return Object.fromEntries(
    Object.entries(config?.rules ?? {}).filter(([rule]) => {
      const { pluginName } = parseRuleId(rule)
      return pluginName === 'storybook' || (pluginName !== undefined && plugins.has(pluginName))
    }),
  )
}

/**
 * eslint-plugin-storybook's recommended rules for `files`, `storybook.files`: the story rules for
 * the files outside `.storybook` folders, and the `main` file's rules for `.storybook/main.*`. The
 * recommended config turns `react-hooks/rules-of-hooks` and `import-x/no-anonymous-default-export`
 * off in stories, as `render` functions call hooks and meta is often an anonymous default export:
 * they stay off where `plugins`, the plugins the other presets register, has them
 */
export async function storybook({
  files,
  plugins,
}: {
  files: FileSpecs
  plugins: ReadonlySet<string>
}): Promise<Array<TypedConfig>> {
  const loaded: unknown = await importPeers('storybook', STORYBOOK_PEERS, async () =>
    interopDefault(import('eslint-plugin-storybook')),
  )
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- eslint-plugin-storybook types its rules as typescript-eslint's `RuleModule`, which ESLint's `Plugin` type doesn't take
  const eslintPluginStorybook = loaded as ESLint.Plugin
  const recommended = eslintPluginStorybook.configs?.['flat/recommended']
  if (!Array.isArray(recommended)) {
    fail(
      ['plugin config `flat/recommended`'],
      `expected an array of configs, received ${describeValue(recommended)}`,
    )
  }
  const configs: ReadonlyArray<Linter.Config> = recommended
  const storiesConfig = configs.find((config) => config.name?.endsWith(':stories-rules') === true)
  const mainConfig = configs.find((config) => config.name?.endsWith(':main-rules') === true)
  return withSetup('storybook', [
    {
      name: 'gpahal/storybook/stories',
      files,
      plugins: { storybook: eslintPluginStorybook },
      ignores: ['**/.storybook/**'],
      rules: pickRules(storiesConfig, plugins),
    },
    {
      name: 'gpahal/storybook/main',
      files: intersectFiles(files, STORYBOOK_MAIN_FILES),
      rules: pickRules(mainConfig, plugins),
    },
  ])
}
