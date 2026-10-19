import type { ESLint } from 'eslint'

import { GpahalMarkdownLanguage } from '@/internal/markdown/language'
import { canonicalCodeBlockLanguage } from '@/internal/markdown/rules/canonical-code-block-language'
import { directivePlacement } from '@/internal/markdown/rules/directive-placement'
import { headingIncrement } from '@/internal/markdown/rules/heading-increment'
import { lowercaseCodeBlockLanguage } from '@/internal/markdown/rules/lowercase-code-block-language'
import { maxHeadingLength } from '@/internal/markdown/rules/max-heading-length'
import { noBareUrls } from '@/internal/markdown/rules/no-bare-urls'
import { noEmphasisAsHeading } from '@/internal/markdown/rules/no-emphasis-as-heading'
import { noMissingAtxHeadingSpace } from '@/internal/markdown/rules/no-missing-atx-heading-space'
import { noMissingLabelRefs } from '@/internal/markdown/rules/no-missing-label-refs'
import { noMissingLinkFragments } from '@/internal/markdown/rules/no-missing-link-fragments'
import { noMultipleH1 } from '@/internal/markdown/rules/no-multiple-h1'
import { noShellDollars } from '@/internal/markdown/rules/no-shell-dollars'
import { noShortcutReference } from '@/internal/markdown/rules/no-shortcut-reference'
import { preferAutolinks } from '@/internal/markdown/rules/prefer-autolinks'
import { requireAltText } from '@/internal/markdown/rules/require-alt-text'
import { PACKAGE_META } from '@/internal/package-meta'

/**
 * This package's Markdown language and rules, registered as `@gpahal/markdown`. The
 * `namespace` makes ESLint treat its language, `@gpahal/markdown/gfm`, as a `markdown/*` language,
 * so the rules of `@eslint/markdown` and of other Markdown plugins run on it. Without it, ESLint
 * rejects them: "The following rules do not support the language"
 */
export const MARKDOWN_PLUGIN: ESLint.Plugin = {
  meta: {
    name: `${PACKAGE_META.name}/markdown`,
    version: PACKAGE_META.version,
    namespace: 'markdown',
  },
  languages: { gfm: new GpahalMarkdownLanguage() },
  rules: {
    'canonical-code-block-language': canonicalCodeBlockLanguage,
    'directive-placement': directivePlacement,
    'heading-increment': headingIncrement,
    'lowercase-code-block-language': lowercaseCodeBlockLanguage,
    'max-heading-length': maxHeadingLength,
    'no-bare-urls': noBareUrls,
    'no-emphasis-as-heading': noEmphasisAsHeading,
    'no-missing-atx-heading-space': noMissingAtxHeadingSpace,
    'no-missing-label-refs': noMissingLabelRefs,
    'no-missing-link-fragments': noMissingLinkFragments,
    'no-multiple-h1': noMultipleH1,
    'no-shell-dollars': noShellDollars,
    'no-shortcut-reference': noShortcutReference,
    'prefer-autolinks': preferAutolinks,
    'require-alt-text': requireAltText,
  },
}
