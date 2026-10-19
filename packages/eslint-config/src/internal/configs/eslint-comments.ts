import eslintPluginComments from '@eslint-community/eslint-plugin-eslint-comments'
import type { ESLint } from 'eslint'

import { CONFIG_FILES } from '@/internal/files'
import { withLanguageColumnsRule } from '@/internal/language-columns'
import type { TypedConfig } from '@/internal/types'
import { registerWrappedPlugin, withPresetPlugin } from '@/internal/utils'

/**
 * The plugin with `require-description` wrapped by `withLanguageColumns`. It reports a comment at
 * JavaScript's column `-1`, before its line's start, which showed as column `-1` in Markdown files,
 * and ends it where the comment ends, in the file's own columns, which the wrapper keeps. One
 * object, made once, since ESLint refuses to redefine a plugin with a different object
 */
export const ESLINT_COMMENTS_PLUGIN: ESLint.Plugin = registerWrappedPlugin(
  withLanguageColumnsRule(eslintPluginComments, 'require-description', { keepsEnd: true }),
  eslintPluginComments,
)

/**
 * `configs` with the stock eslint-comments plugin, as a config of yours registers it, replaced by
 * the wrapped one that the `eslintComments` area registers
 */
export function withPresetEslintCommentsPlugin(configs: Array<TypedConfig>): Array<TypedConfig> {
  return withPresetPlugin(configs, '@eslint-community/eslint-comments', ESLINT_COMMENTS_PLUGIN)
}

/**
 * `eslint-disable` comment hygiene. `no-duplicate-disable` and `no-unused-enable` are left to
 * `linterOptions.reportUnusedDisableDirectives`, which reports the same comments, and
 * `DUPLICATE_RULES` lists `no-unlimited-disable`
 */
export function eslintComments({ files }: { files: Array<string> }): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/eslint-comments/rules',
      files,
      plugins: { '@eslint-community/eslint-comments': ESLINT_COMMENTS_PLUGIN },
      rules: {
        '@eslint-community/eslint-comments/no-aggregating-enable': 'error',
        // Say why a rule is off: `// eslint-disable-next-line rule -- reason`
        '@eslint-community/eslint-comments/require-description': [
          'error',
          { ignore: ['eslint-enable'] },
        ],
      },
    },
  ]
}

/**
 * Config files may disable a rule without a reason, as their tools' examples do
 */
export function eslintCommentsExemptions(): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/eslint-comments/config-files',
      files: CONFIG_FILES,
      rules: {
        '@eslint-community/eslint-comments/require-description': 'off',
      },
    },
  ]
}
