import * as z from 'zod/mini'

import {
  booleanOr,
  deferred,
  optionsObject,
  resolveSubOptions,
  type OptionsShape,
} from '@gpahal/internal/node/options'
import { plainObject, stringOrStrings, typeCheck } from '@gpahal/internal/node/zod'

import { GLOB_LIST, GLOBS } from '@/internal/checks'
import { browser, server } from '@/internal/configs/browser'
import { commentLayout } from '@/internal/configs/comment-layout'
import {
  CODE_BLOCK_JSON_FILES,
  ESLINT_COMMENTS_MARKDOWN_RULES,
  FIXTURE_IGNORES,
  IMPORTS_CODE_BLOCK_RULES,
  PACKAGE_JSON_FILES,
  PNPM_FILES,
  UNICORN_CODE_BLOCK_RULES,
} from '@/internal/configs/constants'
import {
  bidiCharacters,
  javascript,
  JAVASCRIPT_ASTRO_SCRIPT_RULES,
  JAVASCRIPT_CODE_BLOCK_RULES,
} from '@/internal/configs/javascript'
import {
  JAVASCRIPT_ONLY_CODE_BLOCK_RULES,
  javascriptOnlyExemptions,
  javascriptOnlyTypescript,
} from '@/internal/configs/typescript-core'
import {
  ASTRO_FILES,
  ASTRO_SCRIPT_FILES,
  CODE_BLOCK_FILES,
  HTML_FILES,
  JSON_FILES,
  MARKDOWN_FILES,
  TOML_FILES,
  YAML_FILES,
} from '@/internal/files'
import type { Scope } from '@/internal/globs'
import { isInPnpmWorkspace } from '@/internal/manifests'
import { AREA_RULE_PREFIXES, PLUGIN_AREAS, type AreaName } from '@/internal/names'
import { rulesConfig } from '@/internal/naming'
import { warnOfSonarjsTypescriptCopy } from '@/internal/peers'
import {
  antislop,
  ANTISLOP_MARKDOWN_RULES,
  antislopDataFiles,
  antislopExemptions,
  SLOP_PEER,
} from '@/internal/presets/antislop'
import { astro, ASTRO_PEERS } from '@/internal/presets/astro'
import { html, HTML_PEERS } from '@/internal/presets/html'
import { nextjs, NEXTJS_PEERS } from '@/internal/presets/nextjs'
import { node, NODE_CODE_BLOCK_RULES, nodeAstroScriptRules } from '@/internal/presets/node'
import { playwright, PLAYWRIGHT_PEERS } from '@/internal/presets/playwright'
import {
  react,
  REACT_PEERS,
  REACT_REFRESH_PEER,
  reactCodeBlockRules,
} from '@/internal/presets/react'
import { storybook, STORYBOOK_PEERS } from '@/internal/presets/storybook'
import { tailwindcss, TAILWINDCSS_PEERS } from '@/internal/presets/tailwindcss'
import { turbo, TURBO_CODE_BLOCK_RULES, TURBO_PEERS } from '@/internal/presets/turbo'
import { vitest, VITEST_PEERS } from '@/internal/presets/vitest'
import type { ResolvedOptions } from '@/internal/resolve'
import { getRules, isEnabled, pickRules } from '@/internal/rules'
import type {
  EslintConfigOptions,
  ImportsCyclesOptions,
  LooseRules,
  TypedConfig,
  TypedRules,
} from '@/internal/types'

export type AreaBuild = {
  configs: Array<TypedConfig>
  /**
   * Off in Markdown code blocks, which are excerpts
   */
  codeBlockRules?: TypedRules | undefined
  /**
   * Off in Astro `<script>` blocks, which run in the browser
   */
  astroScriptRules?: TypedRules | undefined
  /**
   * The area's `rules` option, after every area's configs, per kind of file its rules apply to
   */
  userRules?: Array<TypedConfig> | undefined
  /**
   * Turn the area's rules off for kinds of files, after every area's `rules`, before your `configs`
   */
  exemptions?: Array<TypedConfig> | undefined
  /**
   * After your `configs`
   */
  codeBlockConfigs?: Array<TypedConfig> | undefined
}

type AreaObject<A extends AreaName> = Exclude<EslintConfigOptions[A], boolean | undefined>

type AreaOptionKeys<A extends AreaName> = Exclude<keyof AreaObject<A>, 'rules'>

/**
 * One check per key of the option type, and no other, so validation and types can't drift
 */
export type AreaKeyChecks<A extends AreaName> = Omit<OptionsShape<AreaObject<A>>, 'rules'>

type AreaBase = {
  /**
   * `''` is the core rules, whose names have no `/`
   */
  prefixes: ReadonlyArray<string>
  /**
   * `code` areas' configs come before the CommonJS config, `file` ones after, then `preset` ones
   */
  kind: 'code' | 'file' | 'preset'
  isOnByDefault: boolean | ((options: EslintConfigOptions) => boolean)
  /**
   * The area can't be turned off, or has a required key, with `isFalseAllowed`
   */
  isObjectOnly?: true
  isFalseAllowed?: true
  /**
   * For the error when the value isn't a boolean or an object
   */
  expected?: string
  /**
   * A sentence after the error for a value of the wrong type
   */
  hint?: string
  /**
   * A function of the options, so a peer an option turns off, such as `react.refresh`, isn't checked
   */
  peers?: ReadonlyArray<string> | ((options: EslintConfigOptions) => ReadonlyArray<string>)
  /**
   * Rules the area turns on in Markdown files, leaving out those whose plugin isn't registered
   */
  markdownRules?: TypedRules
  build: (resolved: ResolvedOptions) => AreaBuild | Promise<AreaBuild>
}

export type AreaDefinition = AreaBase & {
  keys?: Readonly<Record<string, z.ZodMiniType>> | undefined
}

type TypedAreaDefinition<A extends AreaName> = AreaBase &
  ([AreaOptionKeys<A>] extends [never] ? unknown : { keys: AreaKeyChecks<A> })

/**
 * With the area's Markdown rules for those files too
 */
function userRules(
  area: string,
  scope: Scope,
  rules: LooseRules,
  { isOn, markdownRules = {} }: { isOn: ResolvedOptions['isOn']; markdownRules?: TypedRules },
): Array<TypedConfig> {
  return [
    ...rulesConfig(area, scope, rules),
    ...(isOn.markdown
      ? rulesConfig(
          `${area}/markdown`,
          { files: MARKDOWN_FILES },
          pickRules(rules, Object.keys(markdownRules)),
        )
      : []),
  ]
}

function reactPeers({ react: reactOption }: EslintConfigOptions): Array<string> {
  return [
    ...REACT_PEERS,
    ...(resolveSubOptions(reactOption)?.refresh === false ? [] : [REACT_REFRESH_PEER]),
  ]
}

/**
 * In config order
 */
export const AREAS: { readonly [A in AreaName]: TypedAreaDefinition<A> } = {
  javascript: {
    prefixes: AREA_RULE_PREFIXES.javascript,
    kind: 'code',
    isOnByDefault: true,
    isObjectOnly: true,
    build: ({ options, codeFiles, isOn }) => {
      const otherBidiFiles = [
        ...(isOn.json ? JSON_FILES : []),
        ...(isOn.yaml ? YAML_FILES : []),
        ...(isOn.toml ? TOML_FILES : []),
        ...(isOn.markdown ? MARKDOWN_FILES : []),
        ...(isOn.html ? HTML_FILES : []),
      ]
      const rules = getRules(options.javascript)
      return {
        configs: [
          ...javascript({ files: codeFiles }),
          ...bidiCharacters({ files: [...codeFiles, ...otherBidiFiles] }),
        ],
        codeBlockRules: JAVASCRIPT_CODE_BLOCK_RULES,
        astroScriptRules: isOn.astro ? JAVASCRIPT_ASTRO_SCRIPT_RULES : undefined,
        userRules: [
          ...rulesConfig('javascript', { files: codeFiles }, rules),
          ...(otherBidiFiles.length > 0
            ? rulesConfig(
                'javascript/bidi-characters',
                { files: otherBidiFiles },
                pickRules(rules, ['@gpahal/no-bidi-characters']),
              )
            : []),
        ],
      }
    },
  },
  typescript: {
    prefixes: AREA_RULE_PREFIXES.typescript,
    kind: 'code',
    isOnByDefault: true,
    isObjectOnly: true,
    hint: "TypeScript's rules can't be turned off; `typeAware: false` lints without type information",
    keys: {
      rulesTypeAware: plainObject(),
      library: z.boolean(),
      exhaustiveSwitch: z.literal(['default', 'strict']),
      strictBooleanExpressions: z.boolean(),
    },
    build: async ({
      options,
      codeFiles,
      typedCodeFiles,
      typeAware,
      untyped,
      testFiles,
      nonTestFiles,
      isOn,
      javascriptOnly,
    }) => {
      const {
        rules = {},
        rulesTypeAware = {},
        ...typescriptOptions
      } = resolveSubOptions(options.typescript) ?? {}
      if (javascriptOnly) {
        return {
          configs: javascriptOnlyTypescript({ untyped, isUnicornOn: isOn.unicorn }),
          exemptions: javascriptOnlyExemptions({ testFiles }),
          codeBlockRules: JAVASCRIPT_ONLY_CODE_BLOCK_RULES,
          userRules: rulesConfig('typescript', { files: codeFiles }, rules),
        }
      }
      // Imported only when needed, as typescript-eslint loads TypeScript
      const { typescript, TYPESCRIPT_CODE_BLOCK_RULES, typescriptExemptions } =
        await import('@/internal/configs/typescript')
      return {
        configs: typescript({
          ...typescriptOptions,
          files: codeFiles,
          untyped,
          typedFiles: typedCodeFiles,
          typeAware,
          nonTestFiles,
          testFiles,
          isUnicornOn: isOn.unicorn,
        }),
        exemptions: typescriptExemptions({ testFiles }),
        codeBlockRules: TYPESCRIPT_CODE_BLOCK_RULES,
        userRules: [
          ...rulesConfig('typescript', { files: codeFiles }, rules),
          ...(typeAware ? rulesConfig('typescript/type-aware', typeAware, rulesTypeAware) : []),
        ],
      }
    },
  },
  regexp: {
    prefixes: AREA_RULE_PREFIXES.regexp,
    kind: 'code',
    isOnByDefault: true,
    build: async ({ options, codeFiles }) => {
      const { regexp } = await import('@/internal/configs/regexp')
      return {
        configs: regexp({ files: codeFiles }),
        userRules: rulesConfig('regexp', { files: codeFiles }, getRules(options.regexp)),
      }
    },
  },
  unicorn: {
    prefixes: AREA_RULE_PREFIXES.unicorn,
    kind: 'code',
    isOnByDefault: true,
    build: async ({
      options,
      codeFiles,
      testFiles,
      isOn,
      browserFiles,
      presetFiles,
      serverIgnores,
    }) => {
      const { unicorn, unicornBrowserExemptions, unicornNodeExemptions, unicornTestExemptions } =
        await import('@/internal/configs/unicorn')
      return {
        configs: unicorn({ files: codeFiles }),
        exemptions: [
          ...unicornTestExemptions({ testFiles }),
          ...unicornNodeExemptions({ files: isOn.node ? presetFiles.node : [] }),
          ...unicornBrowserExemptions({
            files: [
              ...browserFiles,
              ...(isOn.react ? presetFiles.react : []),
              ...(isOn.nextjs ? presetFiles.nextjs : []),
              ...(isOn.astro ? [...ASTRO_FILES, ...ASTRO_SCRIPT_FILES] : []),
            ],
            ignores: serverIgnores,
          }),
        ],
        codeBlockRules: UNICORN_CODE_BLOCK_RULES,
        userRules: rulesConfig('unicorn', { files: codeFiles }, getRules(options.unicorn)),
      }
    },
  },
  sonarjs: {
    prefixes: AREA_RULE_PREFIXES.sonarjs,
    kind: 'code',
    isOnByDefault: true,
    build: async ({ options, codeFiles, typeAware }) => {
      const { sonarjs, SONARJS_CODE_BLOCK_RULES } = await import('@/internal/configs/sonarjs')
      // With or without type information, since the lockfile's copies outlive a `typeAware` setting
      warnOfSonarjsTypescriptCopy()
      return {
        configs: sonarjs({ files: codeFiles, typeAware }),
        codeBlockRules: SONARJS_CODE_BLOCK_RULES,
        userRules: rulesConfig('sonarjs', { files: codeFiles }, getRules(options.sonarjs)),
      }
    },
  },
  e18e: {
    prefixes: AREA_RULE_PREFIXES.e18e,
    kind: 'code',
    isOnByDefault: true,
    keys: {
      modernization: z.boolean(),
      moduleReplacements: z.boolean(),
      performanceImprovements: z.boolean(),
    },
    build: async ({ options, codeFiles }) => {
      const { e18e, E18E_CODE_BLOCK_RULES } = await import('@/internal/configs/e18e')
      const { rules = {}, ...e18eOptions } = resolveSubOptions(options.e18e) ?? {}
      return {
        configs: e18e({ ...e18eOptions, files: codeFiles }),
        codeBlockRules: E18E_CODE_BLOCK_RULES,
        userRules: rulesConfig('e18e', { files: codeFiles }, rules),
      }
    },
  },
  imports: {
    prefixes: AREA_RULE_PREFIXES.imports,
    kind: 'code',
    isOnByDefault: true,
    keys: {
      removeUnused: z.boolean(),
      cycles: booleanOr(
        optionsObject<ImportsCyclesOptions>({
          maxDepth: typeCheck<number>(
            (value) => Number.isSafeInteger(value) && Number(value) >= 1,
            { expected: 'an integer ≥ 1' },
          ),
        }),
        { expected: 'a boolean or an object with `maxDepth`' },
      ),
    },
    build: async ({
      options,
      codeFiles,
      typedCodeFiles,
      testFiles,
      packageSourceGlobs,
      commonjs,
      untyped,
      isOn,
    }) => {
      const { imports } = await import('@/internal/configs/imports')
      const cyclesOption = resolveSubOptions(options.imports)?.cycles
      const cycles = cyclesOption === true ? {} : cyclesOption === false ? undefined : cyclesOption
      return {
        configs: imports({
          cycles,
          files: codeFiles,
          typedFiles: typedCodeFiles,
          testFiles,
          sourceGlobs: packageSourceGlobs,
          commonjsFiles: commonjs.files,
          untyped,
          astro: isOn.astro,
        }),
        codeBlockRules: IMPORTS_CODE_BLOCK_RULES,
        userRules: rulesConfig('imports', { files: codeFiles }, getRules(options.imports)),
      }
    },
  },
  commentLayout: {
    prefixes: AREA_RULE_PREFIXES.commentLayout,
    kind: 'code',
    isOnByDefault: true,
    build: ({ options, codeFiles }) => ({
      configs: commentLayout({ files: codeFiles }),
      userRules: rulesConfig(
        'comment-layout',
        { files: codeFiles, ignores: CODE_BLOCK_FILES },
        getRules(options.commentLayout),
      ),
    }),
  },
  eslintComments: {
    prefixes: AREA_RULE_PREFIXES.eslintComments,
    kind: 'code',
    isOnByDefault: true,
    markdownRules: ESLINT_COMMENTS_MARKDOWN_RULES,
    build: async ({ options, codeFiles, isOn }) => {
      const { eslintComments, eslintCommentsExemptions } =
        await import('@/internal/configs/eslint-comments')
      return {
        configs: eslintComments({ files: codeFiles }),
        exemptions: eslintCommentsExemptions(),
        userRules: userRules(
          'eslint-comments',
          { files: codeFiles },
          getRules(options.eslintComments),
          { isOn, markdownRules: ESLINT_COMMENTS_MARKDOWN_RULES },
        ),
      }
    },
  },
  jsdoc: {
    prefixes: AREA_RULE_PREFIXES.jsdoc,
    kind: 'code',
    isOnByDefault: true,
    build: async ({ options, codeFiles, typedCodeFiles }) => {
      const { jsdoc } = await import('@/internal/configs/jsdoc')
      return {
        configs: jsdoc({ files: codeFiles, typedFiles: typedCodeFiles }),
        userRules: rulesConfig(
          'jsdoc',
          { files: codeFiles, ignores: CODE_BLOCK_FILES },
          getRules(options.jsdoc),
        ),
      }
    },
  },
  json: {
    prefixes: AREA_RULE_PREFIXES.json,
    kind: 'file',
    isOnByDefault: true,
    build: async ({ options }) => ({
      configs: (await import('@/internal/configs/json')).json(),
      userRules: rulesConfig(
        'json',
        { files: [...JSON_FILES, ...CODE_BLOCK_JSON_FILES] },
        getRules(options.json),
      ),
    }),
  },
  yaml: {
    prefixes: AREA_RULE_PREFIXES.yaml,
    kind: 'file',
    isOnByDefault: true,
    build: async ({ options }) => ({
      configs: (await import('@/internal/configs/yaml')).yaml(),
      userRules: rulesConfig('yaml', { files: YAML_FILES }, getRules(options.yaml)),
    }),
  },
  toml: {
    prefixes: AREA_RULE_PREFIXES.toml,
    kind: 'file',
    isOnByDefault: true,
    build: async ({ options }) => ({
      configs: (await import('@/internal/configs/toml')).toml(),
      userRules: rulesConfig('toml', { files: TOML_FILES }, getRules(options.toml)),
    }),
  },
  pnpm: {
    prefixes: AREA_RULE_PREFIXES.pnpm,
    kind: 'file',
    isOnByDefault: ({ root }) => isInPnpmWorkspace(root),
    build: async ({ options }) => ({
      configs: (await import('@/internal/configs/pnpm')).pnpm(),
      userRules: rulesConfig(
        'pnpm',
        // Its preset skips fixture manifests, but not a fixture's `pnpm-workspace.yaml`
        { files: PNPM_FILES, ignores: FIXTURE_IGNORES.map((glob) => `${glob}/package.json`) },
        getRules(options.pnpm),
      ),
    }),
  },
  packageJson: {
    prefixes: AREA_RULE_PREFIXES.packageJson,
    kind: 'file',
    isOnByDefault: true,
    build: async ({ options }) => {
      const { packageJson } = await import('@/internal/configs/package-json')
      return {
        configs: packageJson(),
        userRules: rulesConfig(
          'package-json',
          { files: PACKAGE_JSON_FILES, ignores: FIXTURE_IGNORES },
          getRules(options.packageJson),
        ),
      }
    },
  },
  markdown: {
    prefixes: AREA_RULE_PREFIXES.markdown,
    kind: 'file',
    isOnByDefault: true,
    keys: { math: z.boolean() },
    build: async ({ options, isOn }) => {
      const { markdown, markdownCodeBlockConfigs } = await import('@/internal/configs/markdown')
      const { math = false, rules = {} } = resolveSubOptions(options.markdown) ?? {}
      const { astro: isAstro, html: isHtml, json: isJson, yaml: isYaml, toml: isToml } = isOn
      return {
        configs: await markdown({
          math,
          areas: { astro: isAstro, html: isHtml, json: isJson, yaml: isYaml, toml: isToml },
        }),
        codeBlockConfigs: markdownCodeBlockConfigs(),
        userRules: rulesConfig('markdown', { files: MARKDOWN_FILES }, rules),
      }
    },
  },
  node: {
    prefixes: AREA_RULE_PREFIXES.node,
    kind: 'preset',
    isOnByDefault: false,
    keys: { scope: GLOBS, typeStripping: z.boolean() },
    build: async ({ options, isOn, presetFiles, commonjs, packageSourceGlobs }) => ({
      configs: await node({
        files: presetFiles.node,
        commonjs,
        sourceGlobs: packageSourceGlobs,
        typeStripping: resolveSubOptions(options.node)?.typeStripping ?? false,
      }),
      codeBlockRules: NODE_CODE_BLOCK_RULES,
      astroScriptRules: isOn.astro ? await nodeAstroScriptRules() : undefined,
      userRules: rulesConfig('node', { files: presetFiles.node }, getRules(options.node)),
    }),
  },
  react: {
    prefixes: AREA_RULE_PREFIXES.react,
    kind: 'preset',
    isOnByDefault: ({ nextjs: nextjsOption }) => isEnabled(nextjsOption, false),
    peers: (options) => reactPeers(options),
    keys: { scope: GLOBS, refresh: z.boolean(), compiler: z.boolean() },
    build: async ({
      options,
      isOn,
      typeAware,
      presetFiles,
      commonjs,
      reactCompiler,
      serverIgnores,
    }) => {
      const { refresh, rules = {} } = resolveSubOptions(options.react) ?? {}
      return {
        configs: await react({
          files: presetFiles.react,
          commonjsIgnores: commonjs.ignores,
          serverIgnores,
          refresh,
          nextjsFiles: isOn.nextjs ? presetFiles.nextjs : undefined,
          typeAware,
          compiler: reactCompiler,
        }),
        codeBlockRules: reactCodeBlockRules(refresh !== false),
        userRules: rulesConfig('react', { files: presetFiles.react }, rules),
      }
    },
  },
  nextjs: {
    prefixes: AREA_RULE_PREFIXES.nextjs,
    kind: 'preset',
    isOnByDefault: false,
    peers: (options) => [...reactPeers(options), ...NEXTJS_PEERS],
    keys: { scope: GLOBS, rootDir: stringOrStrings() },
    build: async ({ options, root, nextjsRootDirs, presetFiles, serverFiles }) => ({
      configs: await nextjs({
        root,
        files: presetFiles.nextjs,
        rootDirs: nextjsRootDirs,
        serverFiles,
      }),
      userRules: rulesConfig('nextjs', { files: presetFiles.nextjs }, getRules(options.nextjs)),
    }),
  },
  astro: {
    prefixes: AREA_RULE_PREFIXES.astro,
    kind: 'preset',
    isOnByDefault: false,
    peers: ASTRO_PEERS,
    build: async ({ options }) => ({
      configs: await astro(),
      userRules: rulesConfig('astro', { files: ASTRO_FILES }, getRules(options.astro)),
    }),
  },
  html: {
    prefixes: AREA_RULE_PREFIXES.html,
    kind: 'preset',
    isOnByDefault: false,
    peers: HTML_PEERS,
    build: async ({ options }) => ({
      configs: await html(),
      userRules: rulesConfig('html', { files: HTML_FILES }, getRules(options.html)),
    }),
  },
  tailwindcss: {
    prefixes: AREA_RULE_PREFIXES.tailwindcss,
    kind: 'preset',
    isOnByDefault: false,
    peers: TAILWINDCSS_PEERS,
    isObjectOnly: true,
    isFalseAllowed: true,
    expected: 'an object with `entryPoint`, the Tailwind CSS entry stylesheet, or `false`',
    keys: {
      scope: GLOBS,
      // `checkTailwindcssEntryPoint` checks it, and that `settings` has none
      entryPoint: deferred<string | URL>(),
      settings: deferred(
        plainObject({ expected: "an object of eslint-plugin-better-tailwindcss's settings" }),
      ),
    },
    build: async ({ options, isOn, root, presetFiles }) => {
      const { entryPoint, settings = {}, rules = {} } = resolveSubOptions(options.tailwindcss) ?? {}
      return {
        configs:
          entryPoint === undefined
            ? []
            : await tailwindcss(
                { files: presetFiles.tailwindcss, astro: isOn.astro, root },
                entryPoint,
                settings,
              ),
        userRules: rulesConfig('tailwindcss', { files: presetFiles.tailwindcss }, rules),
      }
    },
  },
  turbo: {
    prefixes: AREA_RULE_PREFIXES.turbo,
    kind: 'preset',
    isOnByDefault: false,
    peers: TURBO_PEERS,
    build: async ({ options, codeFiles }) => ({
      configs: await turbo({ files: codeFiles }),
      codeBlockRules: TURBO_CODE_BLOCK_RULES,
      userRules: rulesConfig('turbo', { files: codeFiles }, getRules(options.turbo)),
    }),
  },
  vitest: {
    prefixes: AREA_RULE_PREFIXES.vitest,
    kind: 'preset',
    isOnByDefault: false,
    peers: VITEST_PEERS,
    keys: { files: GLOB_LIST },
    build: async ({ options, vitestFiles, typeAware }) => ({
      configs: await vitest({ files: vitestFiles, typeAware }),
      userRules: rulesConfig('vitest', { files: vitestFiles }, getRules(options.vitest)),
    }),
  },
  playwright: {
    prefixes: AREA_RULE_PREFIXES.playwright,
    kind: 'preset',
    isOnByDefault: false,
    peers: PLAYWRIGHT_PEERS,
    keys: { files: GLOB_LIST },
    build: async ({ options, playwrightFiles }) => ({
      configs: await playwright({ files: playwrightFiles }),
      userRules: rulesConfig(
        'playwright',
        { files: playwrightFiles },
        getRules(options.playwright),
      ),
    }),
  },
  storybook: {
    prefixes: AREA_RULE_PREFIXES.storybook,
    kind: 'preset',
    isOnByDefault: false,
    peers: STORYBOOK_PEERS,
    keys: { files: GLOB_LIST },
    build: async ({ options, storybookFiles, isOn }) => ({
      configs: await storybook({
        files: storybookFiles,
        plugins: new Set(
          PLUGIN_AREAS.entries()
            .filter(([, area]) => Reflect.get(isOn, area) === true)
            .map(([plugin]) => plugin),
        ),
      }),
      userRules: rulesConfig('storybook', { files: storybookFiles }, getRules(options.storybook)),
    }),
  },
  antislop: {
    prefixes: AREA_RULE_PREFIXES.antislop,
    kind: 'preset',
    isOnByDefault: false,
    peers: ({ antislop: antislopOption }) =>
      resolveSubOptions(antislopOption)?.slop === false ? [] : [SLOP_PEER],
    keys: {
      slop: booleanOr(plainObject(), {
        expected: "a boolean or an object of eslint-plugin-slop's settings",
      }),
      sonarjs: z.boolean(),
      cognitiveComplexity: typeCheck<number | false>(
        (value) => value === false || (Number.isSafeInteger(value) && Number(value) >= 0),
        { expected: 'an integer ≥ 0 or `false`' },
      ),
    },
    markdownRules: ANTISLOP_MARKDOWN_RULES,
    build: async ({ options, codeFiles, testFiles, isOn }) => {
      const { rules = {}, ...antislopOptions } = resolveSubOptions(options.antislop) ?? {}
      const dataFiles = antislopDataFiles(isOn)
      return {
        configs: await antislop({
          ...antislopOptions,
          files: codeFiles,
          testFiles,
        }),
        exemptions: antislopExemptions({ testFiles, sonarjs: antislopOptions.sonarjs }),
        // The Markdown file around a code block is checked, a ` ```md ` block's text too
        codeBlockRules: antislopOptions.slop === false ? undefined : { 'slop/no-em-dash': 'off' },
        userRules: [
          ...userRules('antislop', { files: codeFiles, ignores: CODE_BLOCK_FILES }, rules, {
            isOn,
            markdownRules: ANTISLOP_MARKDOWN_RULES,
          }),
          ...(dataFiles.length > 0
            ? rulesConfig(
                'antislop/data',
                { files: dataFiles },
                pickRules(rules, Object.keys(ANTISLOP_MARKDOWN_RULES)),
              )
            : []),
        ],
      }
    },
  },
  // `server` wins over `browser`, so a server folder can sit inside the browser globs
  browser: {
    prefixes: AREA_RULE_PREFIXES.browser,
    kind: 'preset',
    isOnByDefault: false,
    isObjectOnly: true,
    isFalseAllowed: true,
    expected: 'an object with `files`, or `false`',
    keys: { files: deferred(GLOB_LIST) },
    build: ({ options, browserFiles, serverIgnores }) => {
      const ignores = serverIgnores.length > 0 ? serverIgnores : undefined
      return {
        configs: browser({ files: browserFiles, ignores }),
        userRules: rulesConfig(
          'browser',
          { files: browserFiles, ...(ignores && { ignores }) },
          getRules(options.browser),
        ),
      }
    },
  },
  server: {
    prefixes: AREA_RULE_PREFIXES.server,
    kind: 'preset',
    isOnByDefault: false,
    isObjectOnly: true,
    isFalseAllowed: true,
    expected: 'an object with `files`, or `false`',
    keys: { files: deferred(GLOB_LIST) },
    build: ({ options, serverFiles }) => ({
      configs: server({ files: serverFiles }),
      userRules: rulesConfig('server', { files: serverFiles }, getRules(options.server)),
    }),
  },
}

export function mapAreas<T>(fn: (area: AreaDefinition, name: string) => T): Record<AreaName, T> {
  const entries = Object.entries(AREAS).map(([name, area]) => [name, fn(area, name)])
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `Object.fromEntries` types the keys as strings, and there's an entry for every area
  return Object.fromEntries(entries) as Record<AreaName, T>
}

export function getEnabledAreas(options: EslintConfigOptions): Record<AreaName, boolean> {
  return mapAreas(({ isOnByDefault }, area) =>
    isEnabled(Reflect.get(options, area), () =>
      typeof isOnByDefault === 'function' ? isOnByDefault(options) : isOnByDefault,
    ),
  )
}
