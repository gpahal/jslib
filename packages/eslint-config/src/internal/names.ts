/**
 * Names `scripts/typegen.ts` shares with the areas. The script runs on type stripping and loads the
 * build, which doesn't export these, so it imports this module from `src`, which imports nothing
 */

/**
 * Apart from `AREAS`, since the option types derive from them and `AREAS`' builders from the option
 * types. `''` is the core rules, whose names have no `/`
 */
export const AREA_RULE_PREFIXES = {
  javascript: ['', '@gpahal/no-esm-in-commonjs', '@gpahal/no-bidi-characters'],
  typescript: ['@typescript-eslint/', '', '@gpahal/no-inline-type-only-export'],
  regexp: ['regexp/'],
  unicorn: ['unicorn/'],
  sonarjs: ['sonarjs/'],
  e18e: ['e18e/'],
  imports: ['import-x/'],
  commentLayout: ['@gpahal/comment-layout'],
  eslintComments: ['@eslint-community/eslint-comments/'],
  jsdoc: ['jsdoc/'],
  json: ['json/'],
  yaml: ['yml/'],
  toml: ['toml/'],
  pnpm: ['pnpm/'],
  packageJson: ['package-json/'],
  markdown: ['markdown/', '@gpahal/markdown/', 'markdown-preferences/'],
  node: ['n/', '@gpahal/no-js-specifier-for-ts', '@gpahal/no-unstrippable-syntax'],
  react: ['@eslint-react/', 'react-hooks/', 'jsx-a11y-x/', 'react-refresh/'],
  nextjs: ['@next/next/', '@gpahal/nextjs-server-component'],
  astro: ['astro/'],
  html: ['@html-eslint/'],
  tailwindcss: ['better-tailwindcss/'],
  turbo: ['turbo/'],
  vitest: ['vitest/'],
  playwright: ['playwright/'],
  storybook: ['storybook/'],
  antislop: ['slop/', 'sonarjs/'],
  browser: ['@gpahal/no-node-'],
  server: ['@gpahal/no-browser-'],
} as const

export type AreaName = keyof typeof AREA_RULE_PREFIXES

/**
 * `''` is the core rules, whose names have no `/`
 */
export function hasRulePrefix(rule: string, prefixes: ReadonlyArray<string>): boolean {
  return prefixes.some((prefix) => (prefix === '' ? !rule.includes('/') : rule.startsWith(prefix)))
}

/**
 * Fixed, so the names don't depend on which ignore files a checkout has
 */
export const GITIGNORE_CONFIG_NAMES = [
  'gpahal/ignores/git-info-exclude',
  'gpahal/ignores/gitignore',
  'gpahal/ignores/git-modules',
] as const

/**
 * The first area with the rule prefix `<name>/`. `@gpahal` has none, as its rules span areas
 */
export const PLUGIN_AREAS: ReadonlyMap<string, string> = new Map(
  Object.entries(AREA_RULE_PREFIXES)
    .toReversed()
    .flatMap(([area, prefixes]) =>
      prefixes
        .filter((prefix) => prefix.endsWith('/'))
        .map((prefix): [string, string] => [prefix.slice(0, -1), area]),
    ),
)
