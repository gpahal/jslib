import type { ESLint } from 'eslint'
import type { defineConfig } from 'eslint/config'

import type { ListOption, ListTransform } from '@gpahal/internal/node/options'

import type { AREA_RULE_PREFIXES, AreaName } from '@/internal/names'
import type { RuleOptions } from '@/internal/typegen.gen'
import type { GpahalWarningCode } from '@/internal/utils'

export type { ConfigNames } from '@/internal/typegen.gen'

/**
 * A resolved config, as `defineConfig` from `eslint/config` returns it
 */
type Config = ReturnType<typeof defineConfig>[number]

/**
 * Rules typed with the name and options of every rule the presets can turn on. A config that
 * registers `plugins` of its own takes any rule name
 */
export type TypedRules = RuleOptions

/**
 * `TypedRules` whose entries may be `undefined`, for `exactOptionalPropertyTypes`. `rulesConfig`
 * leaves an `undefined` entry out
 */
export type LooseRules = { [K in keyof RuleOptions]?: RuleOptions[K] | undefined }

type RulesWithPrefix<P extends string> = {
  [K in keyof RuleOptions as K extends `${P}${string}` ? K : never]?: RuleOptions[K] | undefined
}

type CoreRules = {
  [K in keyof RuleOptions as K extends `${string}/${string}` ? never : K]?:
    RuleOptions[K] | undefined
}

/**
 * An area's plugins' rules, plus the core rules for `javascript` and `typescript`
 */
type AreaRules<A extends AreaName> = RulesWithPrefix<
  Exclude<(typeof AREA_RULE_PREFIXES)[A][number], ''>
> &
  ('' extends (typeof AREA_RULE_PREFIXES)[A][number] ? CoreRules : unknown)

/**
 * A config whose `rules` are typed
 */
export type TypedConfig = Omit<Config, 'rules'> & {
  rules?: TypedRules | undefined
}

/**
 * A plugin config's name, such as `'js/recommended'`, a config, or an array of them
 */
type ExtendsElement =
  string | ConfigWithExtends | PluginConfig | ReadonlyArray<ConfigWithExtends | PluginConfig>

/**
 * A config that may `extends` others, with typed `rules` there too
 */
export type ConfigWithExtends = TypedConfig & {
  extends?: ReadonlyArray<ExtendsElement> | undefined
}

/**
 * A config that registers plugins of its own. Its `rules` take any rule name
 */
type PluginConfig = Omit<Config, 'plugins'> & {
  plugins: Record<string, ESLint.Plugin>
  extends?: ReadonlyArray<ExtendsElement> | undefined
}

/**
 * A config, or an array of them, nested as deep as a plugin's config arrays come
 */
export type ConfigsElement = ConfigWithExtends | PluginConfig | ReadonlyArray<ConfigsElement>

/**
 * A config from a plugin or shareable config, often loosely typed
 */
export type UpstreamConfig = object

/**
 * An area's `rules`, which take only the rules of `A`
 */
type AreaRulesOptions<A extends AreaName> = {
  /**
   * Rules for every file the area lints. They come before the exemptions, so they don't turn an
   * exempted rule back on: use `configs` for that. A rule the area's plugins don't have throws,
   * even when it's off
   */
  rules?: AreaRules<A> | undefined
}

type AreaOption<A extends AreaName> = boolean | AreaRulesOptions<A>

export type TypeAwareOptions = {
  /**
   * Lints JavaScript files with type information too, for a project that checks them with
   * `checkJs`. Each must then be in a tsconfig with `allowJs` or in `allowDefaultProject`. Off by
   * default
   */
  javascript?: boolean | undefined
  /**
   * Globs of files that no tsconfig includes, which get type information from a default project
   * with the compiler options of `root`'s `tsconfig.json`. By default, the config files, such as
   * `*.config.ts`, `vitest.config.e2e.ts` and `.prettierrc.mjs`, outside the ignores and dot
   * folders, and the code files in `.storybook` folders, that no tsconfig under `root` lists. A config file that a project includes only through
   * an import stays in the defaults and fails with a message that names the fix.
   *
   * An array replaces the defaults and skips parsing the tsconfigs. A function maps a copy of the
   * defaults, escaped as globs. A file that a tsconfig also includes fails in typescript-estree
   *
   * @throws TypeError when a glob starts with `/`, `..` or `!`, has `**` or a `\` separator, or is
   *   `*` or `./*`, which typescript-eslint rejects
   */
  allowDefaultProject?: ListOption | undefined
  /**
   * Globs of code files to lint without type information, as JavaScript files are. The project
   * service never opens them. A function gets `[]`. A `!` glob leaves out the files it matches
   *
   * @throws TypeError when a glob starts with `/` or `..`, has a `\` separator, or is a glob without
   *   `!` that can't match a code file, or when the globs are all `!` ones
   */
  ignores?: ListOption | undefined
}

/**
 * The `typescript` area, whose `rules` apply to every code file, JavaScript files included. Put a
 * TypeScript-only rule in `configs` with `files: [...files.typedCode]`. `rulesTypeAware`,
 * `exhaustiveSwitch` and `strictBooleanExpressions` throw with `typeAware: false`
 */
export type TypescriptOptions = AreaRulesOptions<'typescript'> & {
  /**
   * Rules for the files linted with type information, after the type-aware ones
   */
  rulesTypeAware?: AreaRules<'typescript'> | undefined
  /**
   * For a published library, outside tests, configs and scripts: exported functions and methods
   * declare their types, with `@typescript-eslint/explicit-module-boundary-types`, which pairs with
   * `isolatedDeclarations`. `@typescript-eslint/no-inferrable-types` is off there, since
   * `isolatedDeclarations` needs the types it would remove. Off by default
   */
  library?: boolean | undefined
  /**
   * `@typescript-eslint/switch-exhaustiveness-check`: `'strict'`, the default, reports a union's
   * missing members even with a `default` case, and requires a `default` otherwise. `'default'`
   * lets a `default` case cover them
   */
  exhaustiveSwitch?: 'default' | 'strict' | undefined
  /**
   * `@typescript-eslint/strict-boolean-expressions`: a condition can't be `any`, a number, or a
   * nullable string or number, whose `''` or `0` is easily taken for a missing value. On by default
   */
  strictBooleanExpressions?: boolean | undefined
}

type PresetScopeOptions = {
  /**
   * Globs, relative to `root`, that limit the preset to the files they match, such as
   * `['apps/web/**']`. A `!` glob leaves out the files it matches. Every file of the preset's kinds
   * by default, but `react` defaults to `nextjs.scope`, and with both set covers both
   *
   * @throws TypeError when it lists no globs or only `!` ones, a glob starts with `/` or `..` or has a `\` separator, or a
   *   glob without `!` can't match one of the preset's kinds of files, has more than 4096
   *   characters, nests braces more than 10 deep or has braces that expand to more than 1000 globs
   */
  scope?: ReadonlyArray<string> | undefined
}

/**
 * `@eslint-react`, React Hooks (`recommended-latest`) and `jsx-a11y-x` recommended rules, and
 * browser globals for every code file in `scope` but config and CommonJS files
 */
export type ReactOptions = AreaRulesOptions<'react'> &
  PresetScopeOptions & {
    /**
     * `react-refresh/only-export-components`, which keeps hot reloading working. React Router's
     * route exports, and with `nextjs` Next.js's page exports, are allowed. Needs
     * eslint-plugin-react-refresh. On by default
     */
    refresh?: boolean | undefined
    /**
     * Turns on the react-hooks rules for the React Compiler, such as
     * `react-hooks/incompatible-library`. By default, whether `root`'s or a workspace package's
     * `package.json` lists `babel-plugin-react-compiler` or `react-compiler-runtime`
     */
    compiler?: boolean | undefined
  }

export type NextjsOptions = AreaRulesOptions<'nextjs'> & {
  /**
   * Globs that limit the Next.js rules to the code files they match, `react.scope` by default.
   * React's rules take it too, and only these files may have Next.js's page exports
   *
   * @throws TypeError as `react.scope` does
   */
  scope?: ReadonlyArray<string> | undefined
  /**
   * The Next.js apps' folders, relative to `root`, which set `scope` when it's unset.
   * `@next/next/no-html-link-for-pages` checks each app's links against its `pages` folder. `'.'`
   * by default
   *
   * @throws TypeError when it lists no folders, or a folder is absolute, is a glob, or isn't a
   *   folder under `root`
   */
  rootDir?: string | ReadonlyArray<string> | undefined
}

/**
 * eslint-plugin-n's recommended rules, with its script config for CommonJS files.
 * `n/no-missing-import` and `n/no-unpublished-import` are off, since they report path aliases. Set
 * `engines.node` in `package.json`, or `n/no-unsupported-features/*` assumes Node 16
 */
export type NodeOptions = AreaRulesOptions<'node'> &
  PresetScopeOptions & {
    /**
     * For apps that Node runs from their `.ts` sources. Turns on `@gpahal/no-js-specifier-for-ts`,
     * since Node loads the `./b.js` a specifier names, not `./b.ts`, and
     * `@gpahal/no-unstrippable-syntax`, for syntax type stripping can't run, such as enums. Off by
     * default
     */
    typeStripping?: boolean | undefined
  }

export type ImportsOptions = AreaRulesOptions<'imports'> & {
  /**
   * Makes `--fix` remove unused import specifiers outside an editor. An import with none left
   * becomes a side-effect import, so its module still loads, or goes when it imports only types.
   * Off by default
   */
  removeUnused?: boolean | undefined
  /**
   * `import-x/no-cycle`. An object sets `maxDepth`. Off by default, since it parses every module a
   * file imports
   */
  cycles?: boolean | ImportsCyclesOptions | undefined
}

export type ImportsCyclesOptions = {
  /**
   * How many imports deep `import-x/no-cycle` follows, at least 1. No limit by default
   */
  maxDepth?: number | undefined
}

/**
 * Turning all three groups off throws unless `rules` turns a rule on: use `e18e: false`
 */
export type E18eOptions = AreaRulesOptions<'e18e'> & {
  /**
   * Rules that prefer newer APIs, such as `e18e/prefer-object-has-own`. On by default
   */
  modernization?: boolean | undefined
  /**
   * `e18e/ban-dependencies`, for dependencies with lighter replacements. Off by default
   */
  moduleReplacements?: boolean | undefined
  /**
   * Rules that prefer faster code, such as `e18e/prefer-static-collator`. On by default
   */
  performanceImprovements?: boolean | undefined
}

/**
 * `slop/no-em-dash` skips JSON, YAML and TOML files, whose text is often quoted, unless `rules`
 * turns it on there. `slop/max-comment-length` counts a run of `//` lines as one comment.
 *
 * Turning `slop` and `sonarjs` both off throws unless `rules` turns a rule on: use
 * `antislop: false`
 */
export type AntislopOptions = AreaRulesOptions<'antislop'> & {
  /**
   * eslint-plugin-slop's rules. An object is the plugin's settings, such as
   * `{ inspection: 'uncommitted' }`. On by default
   */
  slop?: boolean | Record<string, unknown> | undefined
  /**
   * eslint-plugin-sonarjs's rules for redundant, duplicated and dead code. On by default
   */
  sonarjs?: boolean | undefined
  /**
   * The highest cognitive complexity a function may have, an integer ≥ 0, or `false` for none. 25
   * by default, above SonarSource's 15. Throws with `antislop.sonarjs: false`
   */
  cognitiveComplexity?: number | false | undefined
}

/**
 * eslint-plugin-better-tailwindcss for code files, and `.astro` and `.html` files with `astro` and
 * `html`. Class order is reported only in `.astro` files and in string variables such as
 * `className`, since `prettier-plugin-tailwindcss` sorts the rest
 */
export type TailwindcssOptions = AreaRulesOptions<'tailwindcss'> &
  PresetScopeOptions & {
    /**
     * The Tailwind CSS v4 entry stylesheet: a path relative to `root`, an absolute path, or a
     * `file:` URL, such as `import.meta.resolve('./src/styles.css')`. It applies to every file in
     * `scope`
     *
     * @throws TypeError when it's missing or isn't a file, or when it's given as
     *   `settings.entryPoint`
     */
    entryPoint: string | URL
    /**
     * eslint-plugin-better-tailwindcss's other settings, passed as they are, except that `cwd`,
     * where the plugin loads Tailwind CSS from, resolves against `root`, its default
     *
     * @throws Error when Tailwind CSS isn't installed in `cwd`
     */
    settings?: Record<string, unknown> | undefined
  }

/**
 * `.md` and `.markdown` files, linted with `@eslint/markdown`'s GFM language with YAML and TOML
 * front matter. `rules` takes the `markdown/*`, `@gpahal/markdown/*` and `markdown-preferences/*`
 * rules. MDX files aren't linted. Code blocks are linted as virtual files such as
 * `README.md/1_0.tsx`, without type information
 */
export type MarkdownOptions = AreaRulesOptions<'markdown'> & {
  /**
   * Parses `$` and `$$` math, as GitHub renders it. Set it here, not in `languageOptions`, which the
   * processor that finds the code blocks doesn't see. Off by default
   */
  math?: boolean | undefined
}

export type VitestOptions = AreaRulesOptions<'vitest'> & {
  /**
   * The files that get Vitest's rules and globals and the test exemptions, `testFiles` by default,
   * without the files of `playwright`. An array replaces the defaults, and a function maps them
   */
  files?: ListOption | undefined
}

export type CommonjsOptions = {
  /**
   * The globs of the CommonJS `.js` files, `['**\/*.js']` by default. An array replaces the
   * defaults, and a function maps them
   *
   * @throws TypeError as `testFiles` does, and when a glob without `!` can't match a `.js` file
   */
  files?: ListOption | undefined
}

export type PlaywrightOptions = AreaRulesOptions<'playwright'> & {
  /**
   * The files that get eslint-plugin-playwright's rules and the test exemptions: the code files in
   * `e2e` and `playwright` folders and `*.e2e.*` files by default. An array replaces the defaults,
   * and a function maps them
   */
  files?: ListOption | undefined
}

export type StorybookOptions = AreaRulesOptions<'storybook'> & {
  /**
   * The files that get eslint-plugin-storybook's rules: `*.stories.*` files and the code files in
   * `.storybook` folders by default. An array replaces the defaults, and a function maps them
   */
  files?: ListOption | undefined
}

type CodeFilesOptions<A extends 'browser' | 'server'> = AreaRulesOptions<A> & {
  /**
   * At least one glob, such as `['src/client/**']`, or a function that gets `[]`
   */
  files: readonly [string, ...Array<string>] | ListTransform
}

export type EslintConfigOptions = {
  /**
   * The project folder, usually `import.meta.dirname`. Every path and glob option is relative to
   * it, and the project service and the import resolver resolve from it. The configs get it as an
   * absolute `basePath`, so globs work when the config file is elsewhere. Use the same path
   * spelling for `root` and linted files: a symbolic link and its real path don't match
   *
   * @throws TypeError when it's relative, isn't a folder, or lacks read or search access.
   */
  root: string
  /**
   * Whether ESLint runs in an editor, where `prefer-const` reports without fixing and
   * `imports.removeUnused` removes nothing. Detected from the variables that VS Code, JetBrains
   * IDEs, Vim, Neovim, Zed and Emacs shells set; set it for other editors, such as Helix
   */
  isInEditor?: boolean | undefined
  /**
   * Ignore what git ignores, on by default: `info/exclude`, the `.gitignore` files from the
   * repository's root down and under `root`, and submodule folders. Patterns apply in git's order.
   * An ignore file that can't be read throws
   */
  gitignore?:
    | boolean
    | {
        /**
         * More ignore files, relative to `root`, after the files found, so they win
         *
         * @throws TypeError when a file is missing, or its path is absolute or has a `..` segment
         */
        files?: ReadonlyArray<string> | undefined
      }
    | undefined
  /**
   * The ignored globs. The defaults are framework output, such as `dist` and `.next`, generated
   * files and lockfiles. An array replaces them, and a function maps them, as in
   * `(defaults) => [...defaults, '**\/fixtures']`. A `!` glob un-ignores what an earlier glob
   * ignores
   *
   * @throws TypeError when a glob starts with `/` or `..`, or has a `\` separator
   */
  ignores?: ListOption | undefined
  /**
   * The test files, which get Vitest's rules with `vitest`, may import dev dependencies and allow
   * non-null and unsafe type assertions. By default, `*.test.*`, `*.spec.*`, `*.test-d.*` and
   * `*.spec-d.*` files, the files in `__tests__`, `tests`, `test` and `__mocks__` folders, and test
   * setup files. An array replaces the defaults, and a function maps them. A `!` glob leaves out
   * the files it matches
   *
   * @throws TypeError when it lists no globs or only `!` ones, a glob that starts with `/` or `..`
   *   or has a `\` separator, or one without `!` that can't match a code file, has more than 4096
   *   characters, nests braces more than 10 deep or has braces that expand to more than 1000 globs
   */
  testFiles?: ListOption | undefined
  /**
   * Lints `.js` files as CommonJS, as `.cjs` files are: `true` for every `.js` file, or `files`.
   * Off by default, and `defineConfig` warns when `root`'s `package.json` has `"type": "commonjs"`
   * or no `"type"` and the project has `.js` or `.jsx` files. `false` turns the warning off
   */
  commonjs?: boolean | CommonjsOptions | undefined
  /**
   * Type information from the TypeScript project service, and the rules that need it. `false`
   * lints every file without it. On by default
   */
  typeAware?: boolean | TypeAwareOptions | undefined
  /**
   * `@eslint/js` rules
   */
  javascript?: AreaRulesOptions<'javascript'> | undefined
  /**
   * typescript-eslint rules
   */
  typescript?: TypescriptOptions | undefined
  /**
   * eslint-plugin-import-x rules. On by default
   */
  imports?: boolean | ImportsOptions | undefined
  /**
   * eslint-plugin-unicorn rules. On by default
   */
  unicorn?: AreaOption<'unicorn'> | undefined
  /**
   * eslint-plugin-regexp rules. On by default
   */
  regexp?: AreaOption<'regexp'> | undefined
  /**
   * eslint-plugin-sonarjs's bug rules. On by default. `antislop` adds the style rules
   */
  sonarjs?: AreaOption<'sonarjs'> | undefined
  /**
   * `@gpahal/comment-layout`: a `/**` doc block on module-level declarations and members, `//`
   * elsewhere. On by default
   */
  commentLayout?: AreaOption<'commentLayout'> | undefined
  /**
   * @e18e/eslint-plugin rules. On by default
   */
  e18e?: boolean | E18eOptions | undefined
  /**
   * Rules for code that reads as generated without care: eslint-plugin-sonarjs's for redundant,
   * duplicated and dead code, and eslint-plugin-slop's. Needs eslint-plugin-slop, unless `slop` is
   * `false`. Off by default
   */
  antislop?: boolean | AntislopOptions | undefined
  /**
   * eslint-comments rules: an `eslint-disable` directive needs a reason after `--`, except in
   * config files. On by default
   */
  eslintComments?: AreaOption<'eslintComments'> | undefined
  /**
   * eslint-plugin-jsdoc rules, which check what blocks say but require none. On by default
   */
  jsdoc?: AreaOption<'jsdoc'> | undefined
  /**
   * `@eslint/json`. Files that usually have comments, such as `tsconfig.json`, are parsed as JSONC.
   * On by default
   */
  json?: AreaOption<'json'> | undefined
  /**
   * eslint-plugin-yml, without its formatting rules. On by default
   */
  yaml?: AreaOption<'yaml'> | undefined
  /**
   * eslint-plugin-toml, with its layout rules, since Prettier doesn't format TOML. On by default
   */
  toml?: AreaOption<'toml'> | undefined
  /**
   * eslint-plugin-pnpm rules. On by default when the nearest `pnpm-workspace.yaml` at or above
   * `root`, up to the git root, is at `root` or lists it in `packages`; `true` without one throws.
   * Fixture manifests are skipped
   */
  pnpm?: AreaOption<'pnpm'> | undefined
  /**
   * eslint-plugin-package-json rules, without the sorting ones. Fixture manifests are skipped. On
   * by default
   */
  packageJson?: AreaOption<'packageJson'> | undefined
  /**
   * `.md` and `.markdown` files and their code blocks. On by default
   */
  markdown?: boolean | MarkdownOptions | undefined
  /**
   * React, React Hooks and jsx-a11y rules, and browser globals for the files in `scope`
   */
  react?: boolean | ReactOptions | undefined
  /**
   * The Next.js recommended and Core Web Vitals rules on top of `react`, which it turns on, and
   * `@gpahal/nextjs-server-component`
   *
   * @throws TypeError with `react: false`
   */
  nextjs?: boolean | NextjsOptions | undefined
  /**
   * Lints `.astro` files with the TypeScript rules and eslint-plugin-astro's recommended and
   * jsx-a11y configs, and their `<script>` blocks as browser code. A file gets type information
   * from the nearest `tsconfig.json` above it, if any. Run `astro sync` first
   *
   * Without eslint-plugin-jsx-a11y-x or eslint-plugin-jsx-a11y where ESLint runs, the
   * `astro/jsx-a11y/*` rules are off and `GPAHAL_ASTRO_JSX_A11Y_MISSING` warns
   */
  astro?: AreaOption<'astro'> | undefined
  /**
   * Lints `.html` files with html-eslint's recommended rules, without its style rules, and its
   * accessibility rules. Inline `<script>` isn't linted
   */
  html?: AreaOption<'html'> | undefined
  /**
   * eslint-plugin-better-tailwindcss rules. Off by default
   *
   * @throws TypeError when it's `true`, without the entry stylesheet to check classes against
   */
  tailwindcss?: TailwindcssOptions | false | undefined
  /**
   * eslint-plugin-n rules
   */
  node?: boolean | NodeOptions | undefined
  /**
   * Reports environment variables missing from `turbo.json`
   */
  turbo?: AreaOption<'turbo'> | undefined
  /**
   * Vitest rules and globals for `vitest.files`
   */
  vitest?: boolean | VitestOptions | undefined
  /**
   * eslint-plugin-playwright's recommended rules for `playwright.files`. Off by default
   */
  playwright?: boolean | PlaywrightOptions | undefined
  /**
   * eslint-plugin-storybook's recommended rules for `storybook.files`. Off by default
   */
  storybook?: boolean | StorybookOptions | undefined
  /**
   * Browser code. Node's globals and built-in modules are reported, except as the operand of
   * `typeof` and `process.env`, which bundlers replace. A built-in's name is reported even when
   * `package.json` declares a browser port of it. A file that `server` also matches is server
   * code. Off by default
   */
  browser?: CodeFilesOptions<'browser'> | false | undefined
  /**
   * Server code, such as Next.js route handlers. Browser globals that Node lacks are reported,
   * except as the operand of `typeof`. It wins over `browser`. Off by default
   */
  server?: CodeFilesOptions<'server'> | false | undefined
  /**
   * Formatting rules, those `eslint-config-prettier` turns off, that your configs, composer methods
   * and areas' `rules` may turn on. `no-unexpected-multiline` always stays on
   *
   * @throws TypeError when a config, one it extends or an area's `rules` turns on a formatting
   *   rule that this doesn't list
   */
  allowFormattingRules?: ReadonlyArray<string> | undefined
  /**
   * Your own configs, or arrays of them, after the presets, the areas' `rules` and the exemptions.
   * The code-block configs come after them, so `.append()` a config to change a rule in code
   * blocks. `basePath` defaults to `root`, and a relative one resolves from it. Each config is
   * split so each rule reaches only the files it can run on
   *
   * @throws TypeError on configs ESLint's `defineConfig` rejects, formatting rules that
   *   `allowFormattingRules` doesn't list, project-service parser options, unknown rules, or rules
   *   that can't run on the files a config's `files` can match
   */
  configs?: ReadonlyArray<ConfigsElement> | undefined
  /**
   * The setup warnings to silence, by code, as in `{ GPAHAL_COMMONJS_PACKAGE: false }`. Unlike
   * `NODE_OPTIONS=--disable-warning`, it reaches an editor's ESLint server too
   */
  warnings?: WarningsOptions | undefined
}

export type WarningsOptions = Partial<Record<GpahalWarningCode, boolean | undefined>>
