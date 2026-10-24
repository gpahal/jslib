import path from 'node:path'

import stylelint from 'stylelint'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'
import type { StylelintConfigOptions, StylelintOverride, StylelintRules } from '@/index'

// An override whose globs match files of several types lints each file as the same override split
// into one per file type would

/**
 * CSS with an unknown pseudo-class, `:global()`, which only `.astro` files allow, an unknown custom
 * property, a named color, a one-line block and a custom at-rule
 */
const CSS =
  'a:custom,\nb:global(c) {\n  color: var(--missing);\n}\n\n@brand x;\n\nd { color: red; background: blue; }\n'

/**
 * Each file type's file with {@link CSS}, under `src`, `src/special` and elsewhere
 */
const FILES = Object.fromEntries(
  ['src', 'src/special', 'other'].flatMap((dir) => [
    [`${dir}/a.css`, CSS],
    [`${dir}/a.astro`, `<style>\n${CSS}</style>\n`],
    [`${dir}/a.html`, `<style>\n${CSS}</style>\n`],
    [`${dir}/a.md`, `# A\n\n\`\`\`css\n${CSS}\`\`\`\n`],
  ]),
)

const PSEUDO: StylelintRules = {
  'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['custom'] }],
}

const syntax = (name: string) => ({ syntax: { atRules: { [name]: { prelude: '<ident>' } } } })

/**
 * The globs of each file type below `dir`, as a hand-split config writes them
 */
const typeGlobs = (dir: string) => [
  `${dir}/**/*.astro`,
  `${dir}/**/*.html`,
  `${dir}/**/*.{md,markdown}`,
  `${dir}/**/*.css`,
]

/**
 * One override per glob of `globs`, each with the rest of `override`
 */
const split = (globs: ReadonlyArray<string>, override: Omit<StylelintOverride, 'files'>) =>
  globs.map((files) => ({ ...override, files }))

const CASES: Array<
  [name: string, broad: Array<StylelintOverride>, split: Array<StylelintOverride>]
> = [
  [
    'a folder glob and user-supplied syntax',
    [
      {
        files: 'src/**',
        languageOptions: syntax('brand'),
        rules: { ...PSEUDO, 'color-named': 'never' },
      },
    ],
    split(typeGlobs('src'), {
      languageOptions: syntax('brand'),
      rules: { ...PSEUDO, 'color-named': 'never' },
    }),
  ],
  [
    'overlapping overrides',
    [
      { files: '**/*.md', rules: { 'no-unknown-custom-properties': true } },
      { files: 'src/**', referenceFiles: ['tokens.css'], rules: PSEUDO },
      { files: 'src/special/**', rules: { 'color-named': 'never', ...PSEUDO } },
    ],
    [
      { files: '**/*.md', rules: { 'no-unknown-custom-properties': true } },
      ...split(typeGlobs('src'), { referenceFiles: ['tokens.css'], rules: PSEUDO }),
      ...split(typeGlobs('src/special'), { rules: { 'color-named': 'never', ...PSEUDO } }),
    ],
  ],
  [
    'inherited overrides and conditional language options',
    [
      {
        files: 'src/**',
        extends: {
          rules: { 'color-named': 'never' },
          overrides: [{ files: '**/special/**', languageOptions: syntax('brand') }],
        },
        rules: PSEUDO,
      },
    ],
    split(typeGlobs('src'), {
      extends: {
        rules: { 'color-named': 'never' },
        overrides: [{ files: '**/special/**', languageOptions: syntax('brand') }],
      },
      rules: PSEUDO,
    }),
  ],
]

/**
 * The rules each of {@link FILES} reports with `options`, by file
 */
async function lintFiles(
  root: string,
  options: Omit<StylelintConfigOptions, 'root'>,
): Promise<Record<string, Array<string>>> {
  const config = await defineConfig({ root, ...options })
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([file, code]) => {
      const { results } = await stylelint.lint({
        code,
        codeFilename: path.join(root, file),
        config,
      })
      const rules = results.flatMap((result) => [
        ...result.warnings.map((warning) => warning.rule),
        ...result.invalidOptionWarnings.map((warning) => `invalid option: ${warning.text}`),
      ])
      return [file, rules.toSorted((a, b) => (a < b ? -1 : Number(a > b)))] as const
    }),
  )
  return Object.fromEntries(entries)
}

describe('an override of files of several types', () => {
  it.each(CASES)('lints as the split config with %s', async (_name, broad, splitOverrides) => {
    await using project = await withTmpProject('stylelint-config-mixed-overrides', {
      'tokens.css': ':root {\n  --brand: red;\n}\n',
    })
    for (const rules of [{}, { 'no-unknown-custom-media': true }] satisfies Array<StylelintRules>) {
      const expected = await lintFiles(project.dir, { rules, overrides: splitOverrides })
      expect(await lintFiles(project.dir, { rules, overrides: broad })).toEqual(expected)
    }
  })
})
