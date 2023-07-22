/** @typedef  {import("prettier").Config} PrettierConfigLib */
/** @typedef  {import("@ianvs/prettier-plugin-sort-imports").PluginConfig} SortImportsConfig */
/** @typedef  {PrettierConfigLib | SortImportsConfig} PrettierBaseConfig */

/** @type {PrettierBaseConfig} */
const config = {
  $schema: 'http://json.schemastore.org/prettierrc',
  endOfLine: 'lf',
  printWidth: 120,
  tabWidth: 2,
  trailingComma: 'all',
  semi: false,
  singleQuote: true,
  jsxSingleQuote: false,
  plugins: ['@ianvs/prettier-plugin-sort-imports'],
  importOrderTypeScriptVersion: '5.0.0',
  importOrder: [
    '<BUILTIN_MODULES>',
    '',
    '^(react/(.*)$)|^(react$)',
    '^(next/(.*)$)|^(next$)',
    '^(astro/(.*)$)|(astro:(.*)$)|^(astro$)',
    '',
    '<THIRD_PARTY_MODULES>',
    '',
    '^@gpahal/(.*)$',
    '',
    '^@public/(.*)$',
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
    '',
    '^[./]',
  ],
}

module.exports = config
