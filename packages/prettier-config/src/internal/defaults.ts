import type { Config } from '@/internal/types'

/**
 * The sorter puts an import in the first group that matches it, so the scheme pattern leaves out
 * `astro:`, whose imports go with Astro's, and `npm:`, `jsr:` and `https:`, which name packages
 */
export const IMPORT_ORDER: Array<string> = [
  '<BUILTIN_MODULES>',
  String.raw`^(?!(?:astro|npm|jsr|https):)[a-zA-Z][a-zA-Z\d+.-]*:`,
  '',
  '^(react|react-dom|react-native)(/(.*))?$',
  '^(next/(.*)$)|^(next$)',
  '^(astro/(.*)$)|^(astro:(.*)$)|^(astro$)',
  '',
  '<THIRD_PARTY_MODULES>',
  '',
  '^@gpahal/(.*)$',
  '',
  '^@/public/(.*)$',
  '^@/common/(.*)$',
  '',
  '^@/types/(.*)$',
  '^@/config/(.*)$',
  '^@/lib/(.*)$',
  '^@/actions/(.*)$',
  '^@/contexts/(.*)$',
  '^@/hooks/(.*)$',
  '^@/layouts/(.*)$',
  '^@/pages/(.*)$',
  '^@/components/lib/(.*)$',
  '^@/components/(.*)$',
  '^@/styles/(.*)$',
  '^@/assets/(.*)$',
  '^@/(.*)$',
  '^~/(.*)$',
  '^#(.*)$',
  '',
  '^[./]',
]

export const IMPORT_ORDER_PARSER_PLUGINS: NonNullable<Config['importOrderParserPlugins']> = [
  'typescript',
  'jsx',
  // Decorators, such as Lit's `@customElement`, would otherwise make the sorter skip the file
  'decorators',
  'decoratorAutoAccessors',
  // `import defer` and `import source`, which the sorter can't parse without them
  'deferredImportEvaluation',
  'sourcePhaseImports',
]

/**
 * The callee names that eslint-plugin-better-tailwindcss checks, which `tests/index.test.ts`
 * checks this against
 */
export const TAILWIND_FUNCTIONS: Array<string> = [
  'cc',
  'clb',
  'clsx',
  'cn',
  'cnb',
  'ctl',
  'cva',
  'cx',
  'dcnb',
  'objstr',
  'tv',
  'twJoin',
  'twMerge',
]

/**
 * Every extension of Prettier's `jsonc` language, whose tools read them without trailing commas.
 * Not `*.sublime-*`, which would also match YAML's `.sublime-syntax`. `tests/format.test.ts` checks
 * the list against Prettier's
 */
export const JSONC_FILES: Array<string> = [
  '*.jsonc',
  '*.code-workspace',
  '*.code-snippets',
  '*.sublime-build',
  '*.sublime-color-scheme',
  '*.sublime-commands',
  '*.sublime-completions',
  '*.sublime-keymap',
  '*.sublime-macro',
  '*.sublime-menu',
  '*.sublime-mousemap',
  '*.sublime-project',
  '*.sublime-settings',
  '*.sublime-theme',
  '*.sublime-workspace',
  '*.sublime_metrics',
  '*.sublime_session',
]

/**
 * Every extension and filename of Prettier's `markdown` language. `tests/format.test.ts` checks the
 * list against Prettier's
 */
export const MARKDOWN_FILES: Array<string> = [
  '*.md',
  '*.livemd',
  '*.markdown',
  '*.mdown',
  '*.mdwn',
  '*.mkd',
  '*.mkdn',
  '*.mkdown',
  '*.ronn',
  '*.scd',
  '*.workbook',
  'contents.lr',
  'README',
]

/**
 * Files that tools write and rewrite, which the preset leaves as they are
 */
export const GENERATED_FILES: Array<string> = [
  'pnpm-lock.yaml',
  '**/next-env.d.ts',
  '**/routeTree.gen.ts',
  '**/convex/_generated/**',
  '**/worker-configuration.d.ts',
]
