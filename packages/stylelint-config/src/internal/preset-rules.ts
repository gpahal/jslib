import recessOrderGroups from 'stylelint-config-recess-order/groups'

import { CUSTOM_PROPERTY_EMPTY_LINE_BEFORE } from '@/internal/custom-property-empty-line-before'
import { DECLARATION_EMPTY_LINE_BEFORE } from '@/internal/declaration-empty-line-before'
import type { StylelintRules } from '@/internal/rules'
import { TAILWIND_THEME_FUNCTION } from '@/internal/tailwind-theme-function'

/**
 * Font family variables, which `value-keyword-case` skips as it skips `font-family`. Tailwind's
 * `--font-weight-*` hold weights
 */
export const FONT_FAMILY_VARIABLE_REGEX: RegExp = /^--font-(?!weight-)/

/**
 * The rules that read the reference files, which the preset turns on with them
 */
const REFERENCE_RULES: ReadonlyArray<string> = [
  'no-unknown-custom-properties',
  'no-unknown-custom-media',
  'no-unknown-animations',
]

export function referenceRulesOf(tailwindcss: boolean): ReadonlyArray<string> {
  return tailwindcss ? [...REFERENCE_RULES, TAILWIND_THEME_FUNCTION] : REFERENCE_RULES
}

/**
 * The own rules that check quotes, with the preset's settings. They fix except in `style`
 * attributes, and the stock rules they replace are off
 */
const QUOTE_RULES: Readonly<StylelintRules> = {
  '@gpahal/font-family-name-quotes': 'always-unless-keyword',
  '@gpahal/function-url-quotes': 'always',
  '@gpahal/import-notation': 'string',
}

/**
 * The preset's changes to the rules of the configs it extends, for every file
 */
export function presetRules({
  commentLayout,
  hasReferenceFiles,
  tailwindcss = false,
  logical = false,
}: {
  commentLayout: boolean
  hasReferenceFiles: boolean
  tailwindcss?: boolean | undefined
  logical?: boolean | undefined
}): StylelintRules {
  return {
    // `tech()` is a `@font-face` `src` function, which the rule doesn't know
    'function-no-unknown': [true, { ignoreFunctions: ['tech'] }],
    'color-no-invalid-hex': true,
    'unit-no-unknown': true,
    'function-linear-gradient-no-nonstandard-direction': true,
    // Their fixes write double quotes, which end a double-quoted `style` attribute early, so the
    // own rules that replace them only report there
    'font-family-name-quotes': null,
    'function-url-quotes': null,
    'import-notation': null,
    ...QUOTE_RULES,
    'number-max-precision': 6,
    // As Tailwind's theme writes them. `bolder` and `lighter` have no number
    'font-weight-notation': ['numeric', { ignore: ['relative'] }],
    // The Tailwind variant changes this to `number`, as Tailwind's palette writes hues
    'hue-degree-notation': 'angle',
    'value-keyword-case': ['lower', { ignoreProperties: [FONT_FAMILY_VARIABLE_REGEX] }],
    'selector-no-invalid': true,
    'selector-no-unmatchable': true,
    // Report-only: `:is()`, the fix's replacement, takes its most specific argument's specificity
    'selector-no-deprecated': [true, { disableFix: true }],
    // A scheme-relative URL loads over HTTP from an HTTP page and fails from a `file:` page
    'function-url-no-scheme-relative': true,
    'display-notation': 'short',
    'comment-empty-line-before': null,
    // It reports ordinary nesting, such as `&:hover` before `&:has(> img)` in one rule
    'no-descending-specificity': null,
    // Report-only, since these fixes can change rendering: the order fix moves a shorthand before
    // its longhands, and the prefix fixes duplicate the unprefixed declaration
    'property-no-vendor-prefix': [true, { disableFix: true }],
    // stylelint-config-standard's `ignoreValues`, kept
    'value-no-vendor-prefix': [true, { ignoreValues: ['box', 'inline-box'], disableFix: true }],
    'order/properties-order': [recessOrderGroups, { disableFix: true }],
    // A warning, since a newer feature isn't always a mistake. `widely` would flag much of modern
    // CSS. `user-select` is ignored, since `property-no-vendor-prefix` rejects its prefixed form
    'plugin/use-baseline': [
      true,
      { available: 'newly', ignoreProperties: { 'user-select': ['/^.+$/'] }, severity: 'warning' },
    ],
    '@gpahal/media-range-spacing': true,
    // The own rule skips `style` attributes. `defineConfig` gives it your setting of the stock rule
    'custom-property-empty-line-before': null,
    [CUSTOM_PROPERTY_EMPTY_LINE_BEFORE]: [
      'always',
      {
        except: ['after-custom-property', 'first-nested'],
        ignore: ['after-comment', 'inside-single-line-block'],
      },
    ],
    // The own rule also exempts declarations after `@apply`
    'declaration-empty-line-before': null,
    [DECLARATION_EMPTY_LINE_BEFORE]: [
      'always',
      {
        except: ['after-declaration', 'first-nested'],
        ignore: ['after-comment', 'inside-single-line-block'],
      },
    ],
    ...(commentLayout && { '@gpahal/comment-layout': true }),
    ...(logical && {
      'property-layout-mappings': 'flow-relative',
      'unit-layout-mappings': 'flow-relative',
      'value-keyword-layout-mappings': 'flow-relative',
    }),
    // Without reference files, these would report everything a file doesn't define itself
    ...(hasReferenceFiles && {
      'no-unknown-custom-properties': true,
      'no-unknown-custom-media': true,
      // The reference files' `@keyframes` count, Tailwind's theme's included
      'no-unknown-animations': true,
      // The variables of the reference files' `@theme` blocks, Tailwind's theme's included
      ...(tailwindcss && { [TAILWIND_THEME_FUNCTION]: true }),
    }),
  }
}
