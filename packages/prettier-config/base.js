/** @typedef  {import("prettier").Config} PrettierConfigLib */
/** @typedef  {import("@ianvs/prettier-plugin-sort-imports").PluginConfig} SortImportsConfig */
/** @typedef  {{ tailwindConfig?: string }} TailwindConfig */
/** @typedef  {PrettierConfigLib | SortImportsConfig | TailwindConfig} PrettierConfig */

/** @type {PrettierConfig} */
const config = {
  $schema: 'http://json.schemastore.org/prettierrc',
  endOfLine: 'lf',
  printWidth: 120,
  tabWidth: 2,
  trailingComma: 'all',
  semi: false,
  singleQuote: true,
  jsxSingleQuote: false,
  plugins: ['@ianvs/prettier-plugin-sort-imports', 'prettier-plugin-tailwindcss', 'prettier-plugin-astro'],
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
    '^@/components/lib/(.*)$',
    '^@/components/(.*)$',
    '^@/styles/(.*)$',
    '^@/assets/(.*)$',
    '^@/(.*)$',
    '',
    '^[./]',
  ],
  overrides: [
    {
      files: '*.astro',
      options: {
        parser: 'astro',
        astroAllowShorthand: false,
      },
    },
  ],
}

module.exports = config