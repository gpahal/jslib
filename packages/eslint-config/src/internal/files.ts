export const JAVASCRIPT_EXTNS: ReadonlyArray<string> = ['js', 'mjs', 'cjs']
/**
 * Without JSX, which Node's type stripping runs
 */
const TYPESCRIPT_EXTNS: ReadonlyArray<string> = ['ts', 'mts', 'cts']
export const UNTYPED_CODE_EXTNS: ReadonlyArray<string> = [...JAVASCRIPT_EXTNS, 'jsx']
const TYPED_CODE_EXTNS = ['ts', 'tsx', 'mts', 'cts']

export const CODE_EXTNS: Array<string> = [...UNTYPED_CODE_EXTNS, ...TYPED_CODE_EXTNS]
export const TYPED_CODE_EXTNS_WITH_DOT: Array<string> = TYPED_CODE_EXTNS.map((extn) => `.${extn}`)
export const CODE_EXTNS_WITH_DOT: Array<string> = CODE_EXTNS.map((extn) => `.${extn}`)
const CODE_EXTNS_GLOB = `{${CODE_EXTNS.join(',')}}`

export const UNTYPED_CODE_FILES: Array<string> = [`**/*.{${UNTYPED_CODE_EXTNS.join(',')}}`]
export const TYPED_CODE_FILES: Array<string> = [`**/*.{${TYPED_CODE_EXTNS.join(',')}}`]
export const CODE_FILES: Array<string> = [`**/*.${CODE_EXTNS_GLOB}`]
export const TYPESCRIPT_FILES: Array<string> = [`**/*.{${TYPESCRIPT_EXTNS.join(',')}}`]
export const DECLARATION_FILES: Array<string> = [`**/*.d.{${TYPESCRIPT_EXTNS.join(',')}}`]
export const COMMONJS_FILES: Array<string> = ['**/*.{cjs,cts}']
export const JSX_FILES: Array<string> = ['**/*.{jsx,tsx}']
/**
 * As in `x.config.d.ts` and `x.config.e2e.test.ts`
 */
export const NOT_CONFIG_INFIXES: ReadonlyArray<string> = ['d', 'test', 'spec', 'test-d', 'spec-d']
/**
 * A nested extglob doesn't match in ESLint, so each part is listed alone, first, last and inside
 */
const CONFIG_INFIX_GLOB = `!(${NOT_CONFIG_INFIXES.flatMap((infix) => [infix, `*.${infix}`, `${infix}.*`, `*.${infix}.*`]).join('|')})`
/**
 * Also with an infix, as in `vitest.config.e2e.ts`, and dotfile configs such as `.prettierrc.mjs`
 */
export const CONFIG_FILES: Array<string> = [
  `**/*.config.${CODE_EXTNS_GLOB}`,
  `**/*.config.${CONFIG_INFIX_GLOB}.${CODE_EXTNS_GLOB}`,
  `**/.*rc.${CODE_EXTNS_GLOB}`,
  `**/.*rc.*.${CODE_EXTNS_GLOB}`,
]
/**
 * By the names Vitest's, Jest's and Testing Library's docs use
 */
export const TEST_SETUP_FILES: Array<string> = [
  `**/{vitest,jest,test}{-,.}setup.${CODE_EXTNS_GLOB}`,
  `**/setup{Tests,-tests}.${CODE_EXTNS_GLOB}`,
]
export const TEST_FILES: Array<string> = [
  `**/*.{test,spec}.${CODE_EXTNS_GLOB}`,
  `**/*.{test,spec}-d.${CODE_EXTNS_GLOB}`,
  `**/__tests__/**/*.${CODE_EXTNS_GLOB}`,
  `**/tests/**/*.${CODE_EXTNS_GLOB}`,
  `**/test/**/*.${CODE_EXTNS_GLOB}`,
  `**/__mocks__/**/*.${CODE_EXTNS_GLOB}`,
  ...TEST_SETUP_FILES,
]
export const PLAYWRIGHT_FILES: Array<string> = [
  `**/e2e/**/*.${CODE_EXTNS_GLOB}`,
  `**/playwright/**/*.${CODE_EXTNS_GLOB}`,
  `**/*.e2e.${CODE_EXTNS_GLOB}`,
]
export const STORYBOOK_FILES: Array<string> = [
  `**/*.stories.${CODE_EXTNS_GLOB}`,
  `**/.storybook/**/*.${CODE_EXTNS_GLOB}`,
]
/**
 * They run at build or test time, so they may import dev dependencies
 */
export const REPO_SCRIPT_FILES: Array<string> = [`**/scripts/**/*.${CODE_EXTNS_GLOB}`]
export const SCRIPT_FILES: Array<string> = [
  `**/scripts/**/*.${CODE_EXTNS_GLOB}`,
  `**/cli/**/*.${CODE_EXTNS_GLOB}`,
  `**/cli.${CODE_EXTNS_GLOB}`,
  `**/bin/**/*.${CODE_EXTNS_GLOB}`,
  `**/bin.${CODE_EXTNS_GLOB}`,
]

const JSON_EXTNS = ['json', 'jsonc', 'json5']
const YAML_EXTNS = ['yml', 'yaml']
const TOML_EXTNS = ['toml']
export const MARKDOWN_EXTNS: ReadonlyArray<string> = ['md', 'markdown']
const HTML_EXTNS = ['html']
export const NON_CODE_KIND_EXTNS: ReadonlyArray<[kind: string, extensions: ReadonlyArray<string>]> =
  [
    ['JSON', JSON_EXTNS],
    ['YAML', YAML_EXTNS],
    ['TOML', TOML_EXTNS],
    ['Markdown', MARKDOWN_EXTNS],
    ['HTML', HTML_EXTNS],
  ]
export const NON_CODE_EXTNS: ReadonlyArray<string> = [
  ...JSON_EXTNS,
  ...YAML_EXTNS,
  ...TOML_EXTNS,
  ...MARKDOWN_EXTNS,
  ...HTML_EXTNS,
]
/**
 * As an `ignores` entry for your configs' JavaScript rules. It skips a JSON code block, as
 * `README.md/0.json`, but not a TypeScript one
 */
export const NON_CODE_FILES: string = `**/*.{${NON_CODE_EXTNS.join(',')}}`

export const JSON_FILES: Array<string> = JSON_EXTNS.map((extn) => `**/*.${extn}`)

export const YAML_FILES: Array<string> = [`**/*.{${YAML_EXTNS.join(',')}}`]

export const TOML_FILES: Array<string> = TOML_EXTNS.map((extn) => `**/*.${extn}`)

export const MARKDOWN_FILES: Array<string> = MARKDOWN_EXTNS.map((extn) => `**/*.${extn}`)

export const CODE_BLOCK_FILES: Array<string> = MARKDOWN_FILES.map((glob) => `${glob}/**`)

export const ASTRO_FILES: Array<string> = ['**/*.astro']
/**
 * The `astro/client-side-ts` processor's virtual files
 */
export const ASTRO_SCRIPT_FILES: Array<string> = ASTRO_FILES.map((file) => `${file}/*.ts`)

export const HTML_FILES: Array<string> = HTML_EXTNS.map((extn) => `**/*.${extn}`)

type FileKind =
  | 'code'
  | 'typedCode'
  | 'untypedCode'
  | 'test'
  | 'config'
  | 'script'
  | 'declaration'
  | 'commonjs'
  | 'jsx'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'markdown'
  | 'codeBlock'
  | 'astro'
  | 'astroScript'
  | 'html'

/**
 * The default globs of each kind of file the presets lint, for your own `configs`. `files.test` is
 * the default `testFiles`, not the `testFiles` you pass
 *
 * @example
 * ```ts
 * import { defineConfig, files } from '@gpahal/eslint-config'
 *
 * defineConfig({
 *   root: import.meta.dirname,
 *   configs: [{ files: [...files.test], rules: { 'no-console': 'off' } }],
 * })
 * ```
 */
export const files: Readonly<Record<FileKind, ReadonlyArray<string>>> = Object.freeze({
  code: Object.freeze([...CODE_FILES]),
  typedCode: Object.freeze([...TYPED_CODE_FILES]),
  untypedCode: Object.freeze([...UNTYPED_CODE_FILES]),
  test: Object.freeze([...TEST_FILES]),
  config: Object.freeze([...CONFIG_FILES]),
  script: Object.freeze([...SCRIPT_FILES]),
  declaration: Object.freeze([...DECLARATION_FILES]),
  commonjs: Object.freeze([...COMMONJS_FILES]),
  jsx: Object.freeze([...JSX_FILES]),
  json: Object.freeze([...JSON_FILES]),
  yaml: Object.freeze([...YAML_FILES]),
  toml: Object.freeze([...TOML_FILES]),
  markdown: Object.freeze([...MARKDOWN_FILES]),
  codeBlock: Object.freeze([...CODE_BLOCK_FILES]),
  astro: Object.freeze([...ASTRO_FILES]),
  astroScript: Object.freeze([...ASTRO_SCRIPT_FILES]),
  html: Object.freeze([...HTML_FILES]),
})
