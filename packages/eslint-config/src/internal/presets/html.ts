import { isRecord } from '@gpahal/std/objects'

import { HTML_FILES } from '@/internal/files'
import { withSetup } from '@/internal/naming'
import { importPeers, interopDefault } from '@/internal/peers'
import type { TypedConfig, TypedRules } from '@/internal/types'

export const HTML_PEERS: Array<string> = ['@html-eslint/parser', '@html-eslint/eslint-plugin']

/**
 * `.html` files, parsed with @html-eslint/parser and checked with html-eslint's recommended rules
 * without the ones in its "Style" category, since Prettier owns HTML layout, with
 * `no-target-blank` and `require-button-type`, and with the accessibility rules that match
 * jsx-a11y's recommended ones, which the `react` and `astro` presets turn on. Inline `<script>`
 * isn't linted
 */
export async function html(): Promise<Array<TypedConfig>> {
  const [eslintParserHtml, eslintPluginHtml] = await importPeers('html', HTML_PEERS, async () =>
    Promise.all([
      interopDefault(import('@html-eslint/parser')),
      interopDefault(import('@html-eslint/eslint-plugin')),
    ]),
  )
  const recommendedRules = eslintPluginHtml.configs['flat/recommended'].rules as TypedRules
  // html-eslint's docs category, which ESLint's rule type doesn't declare
  const isStyleRule = (name: string): boolean => {
    const rule = eslintPluginHtml.rules[name.replace(/^@html-eslint\//, '')]
    const docs: unknown = rule?.meta?.docs
    return isRecord(docs) && docs['category'] === 'Style'
  }
  return withSetup('html', [
    {
      name: 'gpahal/html/parser',
      files: HTML_FILES,
      languageOptions: {
        parser: eslintParserHtml,
      },
    },
    {
      name: 'gpahal/html/rules',
      files: HTML_FILES,
      plugins: { '@html-eslint': eslintPluginHtml },
      rules: {
        ...Object.fromEntries(
          Object.entries(recommendedRules).filter(([name]) => !isStyleRule(name)),
        ),
        // Prettier closes void elements as `<br />`, and the rule's default reports that
        '@html-eslint/require-closing-tags': ['error', { selfClosing: 'always' }],
        // As in the `react` preset: `target="_blank"` without `rel="noreferrer"` or
        // `rel="noopener"`, and a `<button>` without a `type`, which submits its form
        '@html-eslint/no-target-blank': 'error',
        '@html-eslint/require-button-type': 'error',
        // Accessibility
        '@html-eslint/no-accesskey-attrs': 'error',
        '@html-eslint/no-aria-hidden-on-focusable': 'error',
        '@html-eslint/no-empty-headings': 'error',
        '@html-eslint/no-invalid-role': 'error',
        '@html-eslint/no-positive-tabindex': 'error',
        '@html-eslint/no-redundant-role': 'error',
        '@html-eslint/no-skip-heading-levels': 'error',
        '@html-eslint/require-frame-title': 'error',
        '@html-eslint/require-input-label': 'error',
        '@html-eslint/require-meta-viewport': 'error',
      },
    },
  ])
}
