import path from 'node:path'

import { ESLint, type Linter, type Rule } from 'eslint'
import eslintPluginSlop from 'eslint-plugin-slop'
import { defineConfig as eslintDefineConfig } from 'eslint/config'
import { configs as tsEslintConfigs } from 'typescript-eslint'

import { runNodeOk } from '@gpahal/internal/node/testing'
import { isRecord } from '@gpahal/std/objects'

import {
  defineConfig,
  files,
  untyped,
  type ConfigNames,
  type TypedConfig,
  type TypedRules,
} from '@/index'
import { slopPlugin } from '@/slop'

import { ALL_ON_OPTIONS } from '../scripts/typegen'
import {
  collator,
  eslintWith,
  FIXTURES_DIR,
  lint,
  ruleIdOf,
  ruleSeverity,
  severityOf,
  withProject,
} from './helpers'

function formattingRuleHint(isExtended: boolean): string {
  return isExtended
    ? " A plugin's preset that the config is or extends may turn on such rules: wrap it in `withoutFormattingRules`."
    : " To use a plugin's preset that turns on such rules, wrap it in `withoutFormattingRules`."
}

function formattingRuleError(subject: string, rule: string): string {
  return `@gpahal/eslint-config: ${subject}: \`${rule}\`: is a rule that eslint-config-prettier turns off, since it conflicts with Prettier or is only safe with some options.${formattingRuleHint(false)} Turn it off, or list it in \`allowFormattingRules\``
}

function formattingRulesError(subject: string, rules: Array<string>): string {
  return [
    `@gpahal/eslint-config: ${subject}: ${String(rules.length)} issues`,
    ...rules.map(
      (rule) =>
        `  \`${rule}\`: is a rule that eslint-config-prettier turns off, since it conflicts with Prettier or is only safe with some options`,
    ),
    `${formattingRuleHint(true).trim()} Turn them off, or list them in \`allowFormattingRules\``,
  ].join('\n')
}

function markdownParseError(subject: string): string {
  return `@gpahal/eslint-config: ${subject}: \`languageOptions.math\`: can apply to Markdown files, whose parse this package's Markdown processor shares with the language. Set the \`markdown.math\` option instead`
}

function thrownBy(run: () => void): string | undefined {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : 'a non-error'
  }
  return undefined
}

function names(configs: Array<Linter.Config>): Array<string | undefined> {
  return configs.map((config) => config.name)
}

const RULES_ROOT = path.join(FIXTURES_DIR, 'rules')

async function severityWith(
  options: Partial<Parameters<typeof defineConfig>[0]>,
  file: string,
  rule: string,
) {
  const configs = await defineConfig({ root: RULES_ROOT, ...options })
  return ruleSeverity(eslintWith(RULES_ROOT, configs), path.join(RULES_ROOT, file), rule)
}

describe('composer', () => {
  const root = RULES_ROOT
  const SCOPE_CHECKED = [
    'src/a.ts',
    'src/a.js',
    'src/sub/c.ts',
    'src/a.json',
    'tsconfig.json',
    'src/a.yml',
    'README.md',
  ]
  let scopeProject: AsyncDisposable & { dir: string }

  beforeAll(async () => {
    scopeProject = await withProject(Object.fromEntries(SCOPE_CHECKED.map((file) => [file, ''])))
  })

  afterAll(async () => {
    await scopeProject[Symbol.asyncDispose]()
  })

  it('names every config uniquely under `gpahal/`', async () => {
    const configs = await defineConfig({
      ...ALL_ON_OPTIONS,
      root,
      tailwindcss: { entryPoint: '../tailwindcss/src/styles.css' },
    })
    const configNames = names(configs)
    expect(configNames.filter((name) => name?.startsWith('gpahal/') !== true)).toEqual([])
    expect(new Set(configNames).size).toBe(configNames.length)
  })

  it.each<[string, TypedConfig]>([
    ['no files', {}],
    ['a folder', { files: ['src/**'] }],
    ['only a negated glob', { files: ['!**/*.json'] }],
    ['ignores that un-ignore', { files: ['src/**'], ignores: ['**/*', '!**/*.ts'] }],
    ['braces over code and JSON', { files: ['**/*.{ts,json}'] }],
    ['a basePath', { basePath: 'src' }],
  ])('turns a rule on with %s where ESLint would, in code files only', async (_name, scope) => {
    const rule = 'no-plusplus'
    const project = scopeProject
    const configs = await defineConfig({
      root: project.dir,
      typeAware: false,
      isInEditor: false,
      configs: [{ ...scope, rules: { [rule]: 'error' } }],
    })
    const composed = eslintWith(project.dir, configs)
    // ESLint's own matching of the scope, with a config that gives every file a config
    const raw = eslintWith(project.dir, [
      { files: ['**/*.*'] },
      { ...scope, rules: { [rule]: 'error' } },
    ])
    for (const file of SCOPE_CHECKED) {
      const isMatched = (await ruleSeverity(raw, path.join(project.dir, file), rule)) === 2
      const expected = isMatched && /\.[cm]?[jt]sx?$/.test(file) ? 2 : 0
      expect({
        file,
        severity: (await ruleSeverity(composed, path.join(project.dir, file), rule)) ?? 0,
      }).toEqual({ file, severity: expected })
    }
  })

  it('keeps the `ignores` of a config of yours without `files` local, without changing it', async () => {
    await using project = await withProject({
      'index.ts': 'export const a = null\n',
      'legacy/old.ts': 'export const b = null\n',
    })
    const userConfig: TypedConfig = {
      ignores: ['legacy/**'],
      rules: { 'unicorn/no-null': 'error' },
    }
    const snapshot = structuredClone(userConfig)
    const configs = await defineConfig({
      root: project.dir,
      typeAware: false,
      configs: [userConfig],
    })
    expect(userConfig).toEqual(snapshot)
    const eslint = eslintWith(project.dir, configs)
    expect(await ruleSeverity(eslint, path.join(project.dir, 'index.ts'), 'unicorn/no-null')).toBe(
      2,
    )
    expect(
      await ruleSeverity(eslint, path.join(project.dir, 'legacy/old.ts'), 'unicorn/no-null'),
    ).toBe(0)
    expect(await eslint.isPathIgnored(path.join(project.dir, 'legacy/old.ts'))).toBe(false)
  })

  it('applies a config of yours without `files` that only turns rules off to every file', async () => {
    await using project = await withProject({
      'c.md': '# Title\n\nA \u{2014} b\n',
      'c.json': '{ "a": "b \u{2014} c" }\n',
    })
    const lintWith = async (configs: Array<TypedConfig>) =>
      lint(
        eslintWith(
          project.dir,
          await defineConfig({
            root: project.dir,
            antislop: { rules: { 'slop/no-em-dash': 'error' } },
            configs,
          }),
        ),
        ['c.md', 'c.json'],
        ruleIdOf,
      )
    expect(await lintWith([])).toEqual({
      'c.json': ['slop/no-em-dash'],
      'c.md': ['slop/no-em-dash'],
    })
    // A rule turned on beside them doesn't keep them to code files
    expect(
      await lintWith([{ rules: { 'slop/no-em-dash': 'off', 'no-console': 'error' } }]),
    ).toEqual({ 'c.json': [], 'c.md': [] })
  })

  it('keeps a config of yours with only `ignores` a global ignore', async () => {
    const configs = await defineConfig({ root, configs: [{ ignores: ['src/**'] }] })
    expect(await eslintWith(root, configs).isPathIgnored('src/x.ts')).toBe(true)
  })

  it("applies an area's rules to its files only", async () => {
    const configs = await defineConfig({
      root,
      unicorn: { rules: { 'unicorn/filename-case': ['error', { case: 'camelCase' }] } },
      vitest: { rules: { 'vitest/no-disabled-tests': 'off' } },
    })
    const eslint = eslintWith(root, configs)
    const tsConfig = (await eslint.calculateConfigForFile(
      path.join(root, 'src/x.ts'),
    )) as Linter.Config
    expect(tsConfig.rules?.['unicorn/filename-case']).toEqual([2, { case: 'camelCase' }])
    expect(
      await ruleSeverity(eslint, path.join(root, 'src/x.ts'), 'vitest/no-disabled-tests'),
    ).toBeUndefined()
    expect(
      await ruleSeverity(eslint, path.join(root, 'src/x.test.ts'), 'vitest/no-disabled-tests'),
    ).toBe(0)
    expect(
      await ruleSeverity(eslint, path.join(root, 'x.json'), 'unicorn/filename-case'),
    ).toBeUndefined()
  })
})

describe("the package's own rules in areas", () => {
  it.each([
    [
      'browser',
      '@gpahal/no-node-globals',
      { files: ['src/client/**'] },
      'src/client/x.ts',
      'src/x.ts',
    ],
    ['javascript', '@gpahal/no-esm-in-commonjs', {}, 'x.cjs', 'x.json'],
  ])('%s.rules takes %s and applies to its files', async (area, rule, option, file, otherFile) => {
    const options = { [area]: { ...option, rules: { [rule]: 'off' } } }
    expect(await severityWith(options, file, rule)).toBe(0)
    expect(await severityWith(options, otherFile, rule)).toBeUndefined()
  })
})

describe('exemptions', () => {
  const root = RULES_ROOT

  it('keeps a rule off in a code block, whether `configs`, an area or a config scoped to `**/*.ts` turns it on', async () => {
    await using project = await withProject({
      'README.md': '# Title\n\n```ts\nconst unused = 1\n```\n',
    })
    const rules: TypedRules = { '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }] }
    for (const options of [
      { configs: [{ rules }] },
      { typescript: { rules } },
      { configs: [{ files: ['**/*.ts'], rules }] },
    ]) {
      const configs = await defineConfig({ root: project.dir, ...options })
      expect(await lint(eslintWith(project.dir, configs), ['README.md'], ruleIdOf)).toEqual({
        'README.md': [],
      })
    }
  })

  it.each([
    ['tests', 'src/x.test.ts', '@typescript-eslint/no-non-null-assertion', 'typescript'],
    ['`.cjs` files', 'src/x.cjs', 'unicorn/prefer-module', 'unicorn'],
    [
      'config files',
      'x.config.ts',
      '@eslint-community/eslint-comments/require-description',
      'eslintComments',
    ],
  ])(
    'keep a rule off in %s with an area rule, but not with `configs`',
    async (_, file, rule, area) => {
      expect(await severityWith({ [area]: { rules: { [rule]: 'error' } } }, file, rule)).toBe(0)
      expect(
        await severityWith(
          { configs: [{ files: [...files.code], rules: { [rule]: 'error' } }] },
          file,
          rule,
        ),
      ).toBe(2)
    },
  )

  it('turns a rule back on with `.remove` by name or `.append`', async () => {
    const file = path.join(root, 'scripts/run.ts')
    const removed = await defineConfig({ root }).remove('gpahal/config-files/console')
    expect(await ruleSeverity(eslintWith(root, removed), file, 'no-console')).toBe(2)
    const appended = await defineConfig({ root }).append({
      files: ['**/scripts/**'],
      rules: { 'no-console': 'error' },
    })
    expect(await ruleSeverity(eslintWith(root, appended), file, 'no-console')).toBe(2)
  })

  it('orders presets, area rules, exemptions, `configs`, code blocks, appended configs, then the guards', async () => {
    const configNames = names(
      await defineConfig({
        root,
        javascript: { rules: { 'no-console': 'off' } },
        configs: [{ name: 'user/config', rules: {} }],
      }).append({ name: 'user/appended' }),
    )
    const order = [
      'gpahal/javascript/rules',
      'gpahal/javascript/user-rules',
      'gpahal/typescript/test-code',
      'gpahal/config-files/console',
      'user/config',
      'gpahal/virtual-files/code-blocks',
      'user/appended',
      'gpahal/formatting/off',
      'gpahal/disable-type-checked/rules',
      'gpahal/root-spelling',
    ].map((name) => configNames.indexOf(name))
    expect(order).not.toContain(-1)
    expect(order).toEqual(order.toSorted((a, b) => a - b))
  })
})

describe('names of configs of yours', () => {
  const root = RULES_ROOT

  it('names the ones without a name by where they come from', async () => {
    const configNames = names(
      await defineConfig({
        root,
        configs: [
          { rules: { 'no-plusplus': 'off' } },
          [{ rules: { 'no-console': 'off' } }],
          { name: 'user/mine', rules: { eqeqeq: 'off' } },
          { extends: [{ rules: {} }], rules: {} },
        ],
      })
        .insertBefore('gpahal/javascript/rules', { rules: {} })
        .insertAfter('gpahal/javascript/rules', { rules: {} }, { name: 'user/after', rules: {} })
        .append([{ rules: {} }], { rules: {} })
        .append({ rules: {} })
        .onResolved((resolved) => [...resolved, { rules: {} }]),
    )
    expect(configNames.filter((name) => name?.startsWith('gpahal/') !== true)).toEqual([
      'user/insertBefore[0]',
      'user/insertAfter[0]',
      'user/after',
      'user/configs[0]',
      'user/configs[1][0]',
      'user/mine',
      'user/configs[3] > ExtendedConfig[0]',
      'user/configs[3]',
      'user/append[0][0]',
      'user/append[1]',
      'user/append[0]',
      'user/onResolved[0]',
    ])
  })
})

function rulesOf(configs: Array<Linter.Config>): Linter.Config['rules'] {
  return configs.find((config) => config.name === 'gpahal/javascript/rules')?.rules
}

describe('composer methods', () => {
  const root = RULES_ROOT

  it('runs the methods in order when awaited', async () => {
    const configs = await defineConfig({ root })
      .override('gpahal/javascript/rules', {})
      .overrideRules({ eqeqeq: 'off' })
      .removeRules('no-var')
      .remove('gpahal/jsdoc/rules')
      .insertBefore('gpahal/javascript/rules', { name: 'user/before' })
      .insertAfter('gpahal/javascript/rules', { name: 'user/after' })
      .append({ name: 'user/appended' }, [[{ name: 'user/nested' }]])
      .onResolved((resolved) => resolved)
    const configNames = names(configs)
    expect(configNames).not.toContain('gpahal/jsdoc/rules')
    expect(configNames.indexOf('user/before') + 2).toBe(configNames.indexOf('user/after'))
    expect(configNames.indexOf('user/appended') + 1).toBe(configNames.indexOf('user/nested'))
    expect(rulesOf(configs)?.['eqeqeq']).toEqual(['off', 'smart'])
  })

  it('runs its queued changes again on fresh copies each time it is awaited', async () => {
    let overrides = 0
    let callbacks = 0
    const composer = defineConfig({ root })
      .override('gpahal/javascript/rules', (config) => {
        overrides += 1
        return config
      })
      .onResolved(() => {
        callbacks += 1
        return undefined
      })
    const first = await composer
    const rules = rulesOf(first) ?? {}
    rules['no-console'] = 'off'
    const second = await composer
    expect([overrides, callbacks]).toEqual([2, 2])
    expect(second).not.toBe(first)
    expect(rulesOf(second)?.['no-console']).toEqual(['error', { allow: ['warn', 'error'] }])
  })

  it.each<[string, (composer: ReturnType<typeof defineConfig>) => unknown]>([
    ['override', (composer) => composer.override('gpahal/react/rules', {})],
    ['remove', (composer) => composer.remove('gpahal/react/rules')],
    ['insertBefore', (composer) => composer.insertBefore('gpahal/react/rules', {})],
    ['insertAfter', (composer) => composer.insertAfter('gpahal/react/rules', {})],
  ])('`.%s()` throws on a config name that no config has', async (method, change) => {
    const composer = defineConfig({ root })
    change(composer)
    // `.remove()` may name several configs
    const call = method === 'remove' ? `.${method}()` : `.${method}('gpahal/react/rules')`
    await expect(composer).rejects.toThrow(
      `@gpahal/eslint-config: \`${call}\`: no config has the name \`gpahal/react/rules\`. \`gpahal/react/rules\` comes from the \`react\` option, which is off`,
    )
  })

  it.each<[string, Partial<Parameters<typeof defineConfig>[0]>, string, string]>([
    [
      'an option that is on, without the setting that adds it',
      {},
      'gpahal/typescript/library',
      '. `gpahal/typescript/library` comes from the `typescript` option, which is on; it needs another of its settings',
    ],
    [
      "an area's user rules, without its `rules`",
      {},
      'gpahal/unicorn/user-rules',
      '. `gpahal/unicorn/user-rules` comes from the `unicorn` option, which is on; it needs `unicorn.rules`',
    ],
    [
      'a type-aware config with `typeAware: false`',
      { typeAware: false },
      'gpahal/typescript/type-aware',
      '. `gpahal/typescript/type-aware` needs type information, which `typeAware: false` turns off',
    ],
    ['a name no config of the package has', {}, 'gpahal/typescript/rulez', ''],
  ])('hints at the cause of a missing name for %s', async (_, options, name, hint) => {
    const composer = defineConfig({ root, ...options }).remove(name as ConfigNames)
    await expect(composer).rejects.toMatchObject({
      message: `@gpahal/eslint-config: \`.remove()\`: no config has the name \`${name}\`${hint}`,
    })
  })

  it('names the `.remove()` that removed a config', async () => {
    const composer = defineConfig({ root })
      .remove('gpahal/jsdoc/rules', 'gpahal/typescript/rules')
      .override('gpahal/typescript/rules', {})
    await expect(composer).rejects.toMatchObject({
      message:
        "@gpahal/eslint-config: `.override('gpahal/typescript/rules')`: no config has the name `gpahal/typescript/rules`. An earlier `.remove()` removed it",
    })
  })

  it.each<[string, Array<ConfigNames>, string]>([
    ['without a name', [], '`.remove()`: names no config. Pass at least one config name'],
    [
      'with a name twice',
      ['gpahal/jsdoc/rules', 'gpahal/jsdoc/rules'],
      '`.remove()`: names `gpahal/jsdoc/rules` twice',
    ],
  ])('throws on `.remove()` %s', (_, removedNames, message) => {
    expect(() => defineConfig({ root }).remove(...removedNames)).toThrow(
      `@gpahal/eslint-config: ${message}`,
    )
  })

  it('`.disableRulesFix()` makes the named rules report without fixing', async () => {
    const code = 'let a = 10000000\n\nexport const b = a\n'
    const fixedBy = async (composer: ReturnType<typeof defineConfig>) => {
      const eslint = eslintWith(root, await composer, { fix: true })
      const [result] = await eslint.lintText(code, {
        filePath: path.join(root, 'src/dead-store.ts'),
      })
      return {
        output: result?.output,
        rules: result?.messages.map((message) => message.ruleId),
      }
    }
    expect((await fixedBy(defineConfig({ root }))).output).toBe(
      'const a = 10_000_000\n\nexport const b = a\n',
    )
    expect(
      await fixedBy(
        defineConfig({ root }).disableRulesFix('prefer-const', 'unicorn/numeric-separators-style'),
      ),
    ).toEqual({ output: undefined, rules: ['prefer-const', 'unicorn/numeric-separators-style'] })
  })

  it('`.disableRulesFix()` throws on an argument that is not a rule name, and rejects on an unknown rule', async () => {
    expect(() =>
      // @ts-expect-error a rule name is a string
      defineConfig({ root }).disableRulesFix('prefer-const', 1),
    ).toThrow(
      '@gpahal/eslint-config: `.disableRulesFix()`: argument 2: expected a rule name, received `1`',
    )
    await expect(
      // @ts-expect-error no preset turns on a rule of this name
      defineConfig({ root }).disableRulesFix('prefer-konst'),
    ).rejects.toThrow(
      "@gpahal/eslint-config: `.disableRulesFix()`: `prefer-konst`: isn't a rule that ESLint has",
    )
  })

  it('`.clone()` gives a composer that shares neither queued changes nor resolved configs', async () => {
    const base = defineConfig({ root }).overrideRules({ 'no-console': 'warn' })
    const clone = base.clone()
    expect(base.removeRules('no-var')).toBe(base)
    expect(clone.append({ name: 'user/clone-only' })).toBe(clone)
    const [baseConfigs, cloneConfigs] = await Promise.all([base, clone])
    expect(names(baseConfigs)).not.toContain('user/clone-only')
    expect(names(cloneConfigs)).toContain('user/clone-only')
    // The change queued before cloning reaches both
    expect(severityOf(rulesOf(baseConfigs)?.['no-console'])).toBe(1)
    expect(severityOf(rulesOf(cloneConfigs)?.['no-console'])).toBe(1)
    expect(rulesOf(baseConfigs)?.['no-var']).toBeUndefined()
    expect(rulesOf(cloneConfigs)?.['no-var']).toBeDefined()
    Reflect.set(rulesOf(cloneConfigs) ?? {}, 'eqeqeq', 'off')
    expect(rulesOf(await base)?.['eqeqeq']).not.toBe('off')
  })

  it("removes a config whose plugin's rules the other configs have off, but not on", async () => {
    await using project = await withProject({ 'index.js': 'export const a = 1\n' })
    const plugin = { rules: { always: { create: () => ({}) } } }
    const options = (severity: Linter.RuleSeverity) => ({
      root: project.dir,
      typeAware: false,
      configs: [
        { name: 'user/plugin', plugins: { mine: plugin } },
        untyped({ name: 'user/rules', files: ['**/*.js'], rules: { 'mine/always': severity } }),
      ],
    })
    await expect(
      defineConfig(options('error')).remove('user/plugin' as ConfigNames),
    ).rejects.toThrow(
      "@gpahal/eslint-config: `.remove('user/plugin')`: removes the plugin `mine` that rules of the other configs turn on, such as `mine/always`. Remove or turn off those rules, or keep the config",
    )
    const configs = await defineConfig(options('off')).remove('user/plugin' as ConfigNames)
    const [result] = await eslintWith(project.dir, configs).lintFiles(['index.js'])
    expect(result?.messages).toEqual([])
  })

  it('replaces `files` and `ignores` with `override`, and merges `languageOptions`', async () => {
    const name = 'gpahal/javascript/rules'
    const before = (await defineConfig({ root })).find((config) => config.name === name)
    const configs = await defineConfig({ root }).override(name, {
      files: ['src/**/*.ts'],
      ignores: ['src/legacy/**'],
      languageOptions: { globals: { custom: 'readonly' } },
    })
    const config = configs.find((entry) => entry.name === name)
    expect(config?.files).toEqual(['src/**/*.ts'])
    expect(config?.ignores).toEqual(['src/legacy/**'])
    expect(config?.languageOptions).toEqual({
      ...before?.languageOptions,
      globals: { custom: 'readonly' },
    })
    const eslint = eslintWith(root, configs)
    expect(await ruleSeverity(eslint, path.join(root, 'x.js'), 'eqeqeq')).toBeUndefined()
    expect(await ruleSeverity(eslint, path.join(root, 'src/x.ts'), 'eqeqeq')).toBe(2)
  })

  it('skips the keys that `override` sets to `undefined`', async () => {
    const name = 'gpahal/javascript/rules'
    const before = (await defineConfig({ root })).find((config) => config.name === name)
    // As a caller without `exactOptionalPropertyTypes` can pass it
    const override: Record<string, unknown> = { files: undefined, ignores: undefined }
    const configs = await defineConfig({ root }).override(name, override)
    expect(configs.find((config) => config.name === name)).toEqual(before)
  })

  it.each([['languageOptions', 'parserOptions'], ['settings']])(
    'keeps prototype-named override keys as own data in %j',
    async (...keys) => {
      // A config with only rules, none of which `withRulesOn` records in its settings
      const name = 'gpahal/typescript/rules'
      const nest = (value: Record<string, unknown>): TypedConfig =>
        keys.reduceRight<Record<string, unknown>>((nested, key) => ({ [key]: nested }), value)
      const values = JSON.parse(
        '{"__proto__":{"polluted":true},"constructor":{"fresh":true}}',
      ) as Record<string, unknown>
      const configs = await defineConfig({ root })
        .override(name, nest({ constructor: { stale: true } }))
        .override(name, nest(values))
      const merged = keys.reduce<unknown>(
        (value, key) => (isRecord(value) ? value[key] : undefined),
        configs.find((entry) => entry.name === name),
      )
      expect(merged).toEqual(values)
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
      expect(Object.hasOwn(merged as object, '__proto__')).toBe(true)
      expect({}).not.toHaveProperty('polluted')
    },
  )

  it('merges `parserOptions` and `globals` with `override`, keeping the project service', async () => {
    const name = 'gpahal/javascript/language-options'
    const before = (await defineConfig({ root })).find((config) => config.name === name)
    const configs = await defineConfig({ root }).override(name, {
      languageOptions: {
        parserOptions: { ecmaFeatures: { jsx: true } },
        globals: { custom: 'readonly' },
      },
    })
    const languageOptions = configs.find((config) => config.name === name)?.languageOptions
    const beforeOptions = before?.languageOptions as Record<string, object> | undefined
    expect(languageOptions?.['parserOptions']).toEqual({
      ...beforeOptions?.['parserOptions'],
      ecmaFeatures: { jsx: true },
    })
    expect(languageOptions?.['parserOptions']).toHaveProperty('projectService')
    expect(languageOptions?.['globals']).toEqual({
      ...beforeOptions?.['globals'],
      custom: 'readonly',
    })
  })
})

describe('the guards after `.onResolved()`', () => {
  const root = RULES_ROOT

  it('reject a formatting rule that a callback turns on in place', async () => {
    const composer = defineConfig({ root }).onResolved((resolved) => {
      const config = resolved.find(({ name }) => name === 'gpahal/javascript/rules')
      if (config?.rules !== undefined) {
        config.rules.curly = 'error'
      }
      return undefined
    })
    await expect(composer).rejects.toThrow(
      formattingRuleError('`.onResolved()` (`gpahal/javascript/rules`)', 'curly'),
    )
  })

  it('register the wrapped slop plugin in place of the upstream one a callback registers', async () => {
    const configs = await defineConfig({ root, antislop: true }).onResolved((resolved) => [
      ...resolved,
      { plugins: { slop: eslintPluginSlop } },
    ])
    const slopPlugins = new Set(configs.flatMap((config) => config.plugins?.['slop'] ?? []))
    expect([...slopPlugins]).toEqual([slopPlugin])
  })

  it("keep the guards out of a callback's configs", async () => {
    const seen: Array<string | undefined> = []
    await defineConfig({ root }).onResolved((resolved) => {
      seen.push(...resolved.map((config) => config.name))
      return undefined
    })
    expect(
      seen.filter(
        (name) =>
          name === 'gpahal/formatting/off' ||
          name?.startsWith('gpahal/disable-type-checked/') === true,
      ),
    ).toEqual([])
  })
})

describe('rule changes through the composer', () => {
  const root = RULES_ROOT
  const unusedVars = '@typescript-eslint/no-unused-vars'

  async function freshEntry(name: string, rule: string): Promise<unknown> {
    const configs = await defineConfig({ root })
    return configs.find((config) => config.name === name)?.rules?.[rule]
  }

  it('overrideRules and removeRules change a rule in its own configs only', async () => {
    const name = 'gpahal/typescript/typescript-eslint/strict-type-checked'
    const rule = '@typescript-eslint/no-floating-promises'
    const before = await freshEntry(name, rule)
    expect(before).toBeDefined()
    const overridden = await defineConfig({ root }).overrideRules({ [rule]: 'off' })
    expect(overridden.find((config) => config.name === name)?.rules?.[rule]).toBe('off')
    const removed = await defineConfig({ root }).removeRules(rule)
    expect(removed.find((config) => config.name === name)?.rules?.[rule]).toBeUndefined()
    expect(await freshEntry(name, rule)).toEqual(before)
  })

  it.each(['warning', ['warning']])(
    'overrideRules rejects invalid severity %j immediately',
    (entry) => {
      expect(() => {
        // @ts-expect-error -- Invalid severities from JavaScript callers
        return defineConfig({ root }).overrideRules({ 'no-console': entry })
      }).toThrow('@gpahal/eslint-config: `.overrideRules()`: `no-console`: expected a severity')
    },
  )

  it('overrideRules leaves a rule set to `undefined` alone, and removes one set to `null`', async () => {
    const fresh = await defineConfig({ root })
    const kept = await defineConfig({ root }).overrideRules({ 'no-console': undefined })
    expect(kept.map((config) => config.rules)).toEqual(fresh.map((config) => config.rules))
    const removed = await defineConfig({ root }).overrideRules({ 'no-console': null })
    expect(removed.filter((config) => config.rules?.['no-console'] !== undefined)).toEqual([])
  })

  it('overrideRules keeps the options of a rule set to a severity alone', async () => {
    const configs = await defineConfig({ root }).overrideRules({ 'no-console': 'warn' })
    const entries = configs.flatMap((config) => {
      const value: unknown = config.rules?.['no-console']
      return value === undefined || value === 'off' ? [] : [value]
    })
    expect(entries).toEqual([['warn', { allow: ['warn', 'error'] }]])
  })

  it('overrideRules leaves the configs where the rule is off alone', async () => {
    const entry = ['error', { argsIgnorePattern: '^_' }] as const
    const configs = await defineConfig({ root })
      .overrideRules({ [unusedVars]: [...entry], 'no-console': 'error' })
      .removeRules('no-var')
    const eslint = eslintWith(root, configs)
    const tsConfig = (await eslint.calculateConfigForFile(
      path.join(root, 'src/x.ts'),
    )) as Linter.Config
    expect(tsConfig.rules?.[unusedVars]).toEqual([2, entry[1]])
    expect(tsConfig.rules?.['no-var']).toBeUndefined()
    expect(await ruleSeverity(eslint, path.join(root, 'scripts/run.ts'), 'no-console')).toBe(0)
    expect(await ruleSeverity(eslint, path.join(root, 'README.md/0.ts'), unusedVars)).toBe(0)
  })
})

describe('config copies', () => {
  const root = RULES_ROOT

  it('keeps a change to a config of yours after `defineConfig` or `.append()` out of the configs', async () => {
    const inConfigs: TypedConfig = {
      name: 'user/in-configs',
      files: ['src/**/*.ts'],
      rules: { 'max-params': ['error', { max: 1 }] },
      settings: { a: 1 },
    }
    const appended: TypedConfig = { name: 'user/appended', rules: { 'no-plusplus': 'off' } }
    const composer = defineConfig({ root, configs: [inConfigs] }).append([appended])
    inConfigs.name = 'user/renamed'
    inConfigs.files?.push('**/*.js')
    Object.assign(inConfigs.rules ?? {}, { 'no-debugger': 'off' })
    Object.assign(inConfigs.settings ?? {}, { b: 2 })
    Reflect.set((inConfigs.rules?.['max-params'] as Array<object>)[1] ?? {}, 'max', 9)
    Object.assign(appended.rules ?? {}, { 'no-plusplus': 'error' })
    const configs = await composer
    expect(configs.find((config) => config.name === 'user/in-configs')).toEqual({
      name: 'user/in-configs',
      basePath: root,
      files: ['src/**/*.ts'],
      rules: { 'max-params': ['error', { max: 1 }] },
      settings: { a: 1 },
    })
    expect(configs.find((config) => config.name === 'user/appended')?.rules).toEqual({
      'no-plusplus': 'off',
    })
  })

  it("keeps a change to `override`'s `files`, `globals` or `settings` in place out of a fresh `defineConfig`", async () => {
    await defineConfig({ root })
      .override('gpahal/javascript/language-options', (config) => {
        ;(config.files as Array<string>).push('**/*.leaked')
        Reflect.set(config.languageOptions?.['globals'] as object, 'leaked', 'readonly')
        return config
      })
      .override('gpahal/imports/settings', (config) => {
        ;(config.settings?.['import-x/extensions'] as Array<string>).push('.leaked')
        return config
      })
    const configs = await defineConfig({ root })
    const json = JSON.stringify(
      configs.map((config) => [config.files, config.languageOptions?.['globals'], config.settings]),
    )
    expect(json).toContain('import-x/extensions')
    expect(json).not.toContain('leaked')
  })

  it('keeps each plugin object itself in every config, and in `extends`', async () => {
    const plugin: ESLint.Plugin = {
      rules: {
        demo: {
          create: (context: Rule.RuleContext) => ({
            Program: (node: Rule.Node) => {
              context.report({ node, message: 'demo' })
            },
          }),
        },
      },
    }
    const configs = await defineConfig({
      root,
      typeAware: false,
      configs: [
        { files: ['**/*.ts'], plugins: { custom: plugin } },
        { extends: [{ plugins: { custom: plugin }, rules: { 'custom/demo': 'error' } }] },
      ],
    })
    const plugins = configs.flatMap((config) => config.plugins?.['custom'] ?? [])
    expect(plugins.length).toBeGreaterThan(1)
    expect(plugins.every((entry) => entry === plugin)).toBe(true)
  })

  it("copies the type-aware guards, so a change in place reaches neither typescript-eslint's configs nor another `defineConfig`'s", async () => {
    await using project = await withProject({
      'tsconfig.json': '{ "compilerOptions": { "types": ["*"] }, "include": ["src"] }\n',
      'src/a.ts': 'export const a = 1\n',
    })
    const name = 'gpahal/disable-type-checked/typescript-eslint/disable-type-checked'
    const first = await defineConfig({ root: project.dir })
    const guard = first.find((config) => config.name === name)
    expect(guard?.rules).toBeDefined()
    expect(guard?.rules).not.toBe(tsEslintConfigs.disableTypeChecked.rules)
    Reflect.set(guard?.rules ?? {}, '@typescript-eslint/await-thenable', 'error')
    const second = await defineConfig({ root: project.dir })
    expect(
      second.find((config) => config.name === name)?.rules?.['@typescript-eslint/await-thenable'],
    ).toBe('off')
  })
})

describe('formatting rules', () => {
  const root = RULES_ROOT
  const file = path.join(root, 'src/x.ts')

  it('throws on the ones a config of yours extends', () => {
    const extended: Linter.Config = { rules: { curly: 'error', semi: 'error' } }
    expect(() => defineConfig({ root, configs: [{ extends: [extended] }] })).toThrow(
      formattingRulesError('`configs[0]` (`user/configs[0] > ExtendedConfig[0]`)', [
        'curly',
        'semi',
      ]),
    )
  })

  it('throws on the ones `.override()` turns on', async () => {
    await expect(
      defineConfig({ root }).override('gpahal/javascript/rules', { rules: { semi: 'error' } }),
    ).rejects.toThrow(formattingRuleError("`.override('gpahal/javascript/rules')`", 'semi'))
  })

  it('leaves out formatting rules, unless `allowFormattingRules` lists them', async () => {
    // Unicorn's recommended config turns it on, and eslint-config-prettier lists it
    const rule = 'unicorn/template-indent'
    expect((await severityWith({}, 'src/x.ts', rule)) ?? 0).toBe(0)
    expect(await severityWith({ allowFormattingRules: [rule] }, 'src/x.ts', rule)).toBe(2)
    // eslint-config-prettier lists it too, but it only reports code without semicolons that
    // Prettier hasn't formatted yet
    expect(await severityWith({}, 'src/x.ts', 'no-unexpected-multiline')).toBe(2)
    const configs = await defineConfig({
      root,
      allowFormattingRules: ['curly'],
      javascript: { rules: { curly: ['error', 'all'] } },
    })
    const config = (await eslintWith(root, configs).calculateConfigForFile(file)) as Linter.Config
    expect(config.rules?.['curly']).toEqual([2, 'all'])
  })

  it("applies an area's rules after every area's configs, keeping their severity", async () => {
    // typescript-eslint turns the core rule off for TypeScript files after the `javascript` area
    const rule = 'no-unused-vars'
    expect(
      await severityWith({ javascript: { rules: { [rule]: 'error' } } }, 'src/x.ts', rule),
    ).toBe(2)
    expect(
      await severityWith(
        { unicorn: { rules: { 'unicorn/no-null': 'warn' } } },
        'src/x.ts',
        'unicorn/no-null',
      ),
    ).toBe(1)
  })
})

describe('configs of yours through `configs` and the composer methods', () => {
  type Source = 'configs' | 'append' | 'insertBefore' | 'insertAfter' | 'onResolved'
  const sources: Array<[Source, string]> = [
    ['configs', '`configs[0]`'],
    ['append', '`.append()`: item `[0]`'],
    ['insertBefore', '`.insertBefore()`: item `[0]`'],
    ['insertAfter', '`.insertAfter()`: item `[0]`'],
    ['onResolved', '`.onResolved()`'],
  ]

  // `console.log` in each code file, and a TypeScript code block in `README.md`
  const SCOPE_FILES = {
    'App.widget': 'console.log(1)\n',
    'x.js': 'console.log(1)\n',
    'data.json': '{ "a": 1 }\n',
    'data.yaml': 'a: 1\n',
    'data.toml': 'a = 1\n',
    'README.md': '# Title\n\n```ts\nexport const b = 1\n```\n\n```toml\nb = 1\n```\n',
    'page.html': '<p>A</p>\n',
  }

  let scopeFilesProject: AsyncDisposable & { dir: string }

  beforeAll(async () => {
    scopeFilesProject = await withProject(SCOPE_FILES)
  })

  afterAll(async () => {
    await scopeFilesProject[Symbol.asyncDispose]()
  })

  function addAllThrough(
    root: string,
    source: Source,
    added: Array<TypedConfig>,
    options: Partial<Parameters<typeof defineConfig>[0]> = {},
  ) {
    if (source === 'configs') {
      return defineConfig({ root, ...options, configs: added })
    }
    const composer = defineConfig({ root, ...options })
    if (source === 'onResolved') {
      return composer.onResolved((configs) => [...configs, ...added])
    }
    return source === 'append'
      ? composer.append(added)
      : composer[source]('gpahal/config-files/console', added)
  }

  // A plugin whose rule `r` reports every file
  const fake = {
    rules: {
      r: {
        meta: { type: 'problem' },
        create: (context) => ({
          Program: (node) => {
            context.report({ node, message: 'Reported.' })
          },
        }),
      },
    },
  } satisfies ESLint.Plugin

  it.each(sources)(
    'turns the rules of a config without `files` on in every file but JSON, YAML, TOML, Markdown and HTML files through %s',
    async (source) => {
      const project = scopeFilesProject
      const configs = await addAllThrough(
        project.dir,
        source,
        [
          { plugins: { fake } },
          { files: ['**/*.widget'] },
          untyped({ rules: { 'fake/r': 'error', 'no-console': 'error' } }),
        ],
        { html: true },
      )
      const messages = await lint(
        eslintWith(project.dir, configs),
        Object.keys(SCOPE_FILES),
        (message) => `${String(message.line)}:${ruleIdOf(message)}`,
      )
      expect(
        Object.fromEntries(
          Object.entries(messages).map(([file, fileMessages]) => [
            file,
            fileMessages
              .filter((message) => /:(?:fake\/r|no-console)$/.test(message))
              .toSorted((a, b) => collator.compare(a, b)),
          ]),
        ),
      ).toEqual({
        'App.widget': ['1:fake/r', '1:no-console'],
        'x.js': ['1:fake/r', '1:no-console'],
        'data.json': [],
        'data.yaml': [],
        'data.toml': [],
        // The TypeScript code block only
        'README.md': ['4:fake/r'],
        'page.html': [],
      })
    },
  )

  it('keeps a type-aware rule of a config without `files` to code files, and off JSON and Markdown files', async () => {
    await using project = await withProject({
      'tsconfig.json': '{ "compilerOptions": { "strict": true }, "include": ["*.ts"] }\n',
      'index.ts': 'export const a = 1\n',
      'App.widget': 'export const b = 1\n',
      'data.json': '{ "a": null }\n',
      'README.md': '# Title\n\n```ts\nexport const b = 1\n```\n',
    })
    const rule = '@typescript-eslint/no-floating-promises'
    const configs = await defineConfig({ root: project.dir }).onResolved((resolved) => [
      ...resolved,
      { files: ['**/*.widget'] },
      { rules: { [rule]: 'error' } },
    ])
    const eslint = eslintWith(project.dir, configs)
    expect(await ruleSeverity(eslint, path.join(project.dir, 'App.widget'), rule)).toBeUndefined()
    expect(await ruleSeverity(eslint, path.join(project.dir, 'index.ts'), rule)).toBe(2)
    expect(await lint(eslint, ['data.json', 'README.md'])).toEqual({
      'README.md': [],
      'data.json': [],
    })
  })

  function addThrough(source: Source, config: TypedConfig) {
    if (source === 'configs' || source === 'onResolved') {
      return addAllThrough(RULES_ROOT, source, [config])
    }
    const composer = defineConfig({ root: RULES_ROOT })
    return source === 'append'
      ? composer.append(config)
      : composer[source]('gpahal/config-files/console', config)
  }

  /**
   * How adding `config` through `source` fails: its message, and whether it throws from
   * `defineConfig` rather than rejecting when awaited
   */
  async function failureOf(source: Source, config: TypedConfig) {
    let composer: ReturnType<typeof defineConfig> | undefined
    const thrown = thrownBy(() => {
      composer = addThrough(source, config)
    })
    if (thrown !== undefined) {
      return { isSync: true, message: thrown }
    }
    try {
      await composer
    } catch (error) {
      return { isSync: false, message: error instanceof Error ? error.message : 'a non-error' }
    }
    return undefined
  }

  it.each(sources)('throws on a formatting rule turned on through %s', async (source, place) => {
    const failure = await failureOf(source, {
      name: 'user/curly',
      rules: { curly: ['error', 'all'] },
    })
    expect(failure?.isSync).toBe(source === 'configs')
    expect(failure?.message).toBe(formattingRuleError(`${place} (\`user/curly\`)`, 'curly'))
  })

  it.each(sources)(
    'throws on a rule for non-code files in a config without `files` through %s',
    async (source, place) => {
      const failure = await failureOf(source, { rules: { 'yml/no-empty-key': 'error' } })
      expect(failure?.isSync).toBe(source === 'configs')
      expect(failure?.message).toBe(
        `@gpahal/eslint-config: ${place}: \`yml/no-empty-key\`: is a rule for YAML files, which a config of yours without \`files\` or \`language\` doesn't reach. Give it \`files: [...files.yaml]\`, with \`files\` from this package`,
      )
    },
  )
})

describe('split configs of yours through `.override()`', () => {
  const root = RULES_ROOT

  it('reaches every part', async () => {
    const configs = await defineConfig({
      root,
      antislop: true,
      configs: [
        {
          name: 'user/split',
          rules: {
            'no-console': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            'slop/no-em-dash': 'off',
          },
        },
      ],
    }).override('user/split' as ConfigNames, { settings: { marker: true } })
    const parts = configs.filter((config) => config.name === 'user/split')
    expect(parts.map((config) => [Object.keys(config.rules ?? {}), config.settings])).toEqual([
      [['slop/no-em-dash'], { marker: true }],
      [['no-console'], { marker: true }],
      [['@typescript-eslint/no-floating-promises'], { marker: true }],
    ])
  })

  it('keeps its JavaScript rules out of JSON, YAML and Markdown files after a change to `files`', async () => {
    const nullFiles = {
      'src/a.ts': 'export const a = null\n',
      'src/data.json': '{ "a": null }\n',
      'src/data.yml': 'a: null\n',
      'README.md': '# Title\n',
    }
    await using project = await withProject(nullFiles)
    const configs = await defineConfig({
      root: project.dir,
      typeAware: false,
      isInEditor: false,
      configs: [{ name: 'mine', rules: { 'unicorn/no-null': 'error' } }],
    }).override('mine' as ConfigNames, { files: ['src/**'] })
    expect(await lint(eslintWith(project.dir, configs), Object.keys(nullFiles), ruleIdOf)).toEqual({
      'src/a.ts': ['unicorn/no-null'],
      'src/data.json': [],
      'src/data.yml': [],
      'README.md': [],
    })
  })

  it.each<[string, TypedConfig, TypedRules, Array<TypedRules>]>([
    [
      'a rule turned on into the part of the rules turned on',
      { rules: { 'no-console': 'off', eqeqeq: 'error' } },
      { 'no-console': 'warn' },
      [{}, { eqeqeq: 'error', 'no-console': 'warn' }],
    ],
    [
      'a rule turned off into the part of the rules turned off',
      { rules: { 'no-console': 'error', eqeqeq: 'off' } },
      { 'no-console': 'off' },
      [{ eqeqeq: 'off', 'no-console': 'off' }, {}],
    ],
    [
      'a rule that needs type information into the part with the code files',
      { rules: { eqeqeq: 'off', '@typescript-eslint/no-floating-promises': 'error' } },
      { '@typescript-eslint/no-floating-promises': 'warn' },
      [{ eqeqeq: 'off' }, { '@typescript-eslint/no-floating-promises': 'warn' }],
    ],
  ])('merges rules: %s', async (_name, config, rules, expected) => {
    const configs = await defineConfig({
      root,
      configs: [{ name: 'user/split', ...config }],
    }).override('user/split' as ConfigNames, { rules })
    expect(
      configs.filter((found) => found.name === 'user/split').map((found) => found.rules),
    ).toEqual(expected)
  })
})

describe('Markdown parse options through the composer', () => {
  const root = path.join(FIXTURES_DIR, 'markdown')
  const name = 'gpahal/markdown/rules'

  it('throws on them from `.override()` and from an `.onResolved()` callback that sets them in place', async () => {
    await expect(
      defineConfig({ root, markdown: true }).override(name, {
        languageOptions: { math: true },
      }),
    ).rejects.toThrow(markdownParseError(`\`.override('${name}')\``))
    await expect(
      defineConfig({ root, markdown: true }).onResolved((resolved) => {
        for (const config of resolved) {
          if (config.name === name) {
            config.languageOptions = { ...config.languageOptions, math: true }
          }
        }
      }),
    ).rejects.toThrow(markdownParseError(`\`.onResolved()\` (\`${name}\`)`))
  })
})

describe('configs for code files only through `.override()`', () => {
  const root = RULES_ROOT
  const name = 'gpahal/javascript/rules'

  it('throws on a function that drops `files`', async () => {
    await expect(
      defineConfig({ root }).override('gpahal/unicorn/rules', ({ files: _files, ...rest }) => rest),
    ).rejects.toThrow(
      "@gpahal/eslint-config: `.override('gpahal/unicorn/rules')`: `files`: removes them from a config for code files only, so its rules would run on JSON, YAML, TOML, Markdown and HTML files too. Keep `files` within the code files, as in `[...files.code]`, with `files` from this package",
    )
  })

  // A negated glob matches every file but those it names, JSON and YAML files included
  it.each(['**/*', '!**/*.md'])('throws on `files: [%j]`, which widens them', async (glob) => {
    await expect(
      defineConfig({ root, typeAware: false }).override('gpahal/unicorn/rules', { files: [glob] }),
    ).rejects.toThrow(
      "@gpahal/eslint-config: `.override('gpahal/unicorn/rules')`: `files`: widens a config for code files only to files that can be JSON, YAML, TOML, Markdown or HTML, where its rules would run too. Keep `files` within the code files, as in `[...files.code]`, with `files` from this package",
    )
  })

  it('takes globs within the code files, and a config that only turns rules off', async () => {
    await expect(
      defineConfig({ root })
        .override('gpahal/unicorn/rules', { files: ['src/**/*.ts'] })
        .override(name, ({ files: _files, languageOptions: _languageOptions, ...rest }) => ({
          ...rest,
          rules: { 'no-console': 'off' },
        })),
    ).resolves.toBeDefined()
  })

  it('throws on a rule for non-code files added to one', async () => {
    await expect(
      defineConfig({ root }).override(name, { rules: { 'json/no-duplicate-keys': 'error' } }),
    ).rejects.toThrow(
      `@gpahal/eslint-config: \`.override('${name}')\`: \`json/no-duplicate-keys\`: is a rule for JSON files, and the config it changes applies to code files only. Add it in a config of its own with \`files: [...files.json]\`, with \`files\` from this package`,
    )
  })
})

describe('composer methods on a name that several configs share', () => {
  const name = 'gpahal/ignores/gitignore'
  const gitignores = {
    '.gitignore': 'root-ignored.js\n',
    'a/.gitignore': 'sub-ignored.js\n',
    'root-ignored.js': 'export const a = 1\n',
    'a/sub-ignored.js': 'export const b = 1\n',
  }

  it('`.remove()` removes every match', async () => {
    await using project = await withProject(gitignores)
    const configs = await defineConfig({ root: project.dir }).remove(name)
    expect(names(configs)).not.toContain(name)
    const eslint = eslintWith(project.dir, configs)
    expect(await eslint.isPathIgnored(path.join(project.dir, 'a/sub-ignored.js'))).toBe(false)
    expect(await eslint.isPathIgnored(path.join(project.dir, 'root-ignored.js'))).toBe(false)
  })

  it('`.insertBefore()` inserts before the first match, and `.insertAfter()` after the last', async () => {
    await using project = await withProject(gitignores)
    const configs = await defineConfig({ root: project.dir })
      .insertBefore(name, { name: 'user/before' })
      .insertAfter(name, { name: 'user/after' })
    const configNames = names(configs)
    const first = configNames.indexOf(name)
    const last = configNames.lastIndexOf(name)
    expect(last).toBeGreaterThan(first)
    expect(configNames.indexOf('user/before')).toBe(first - 1)
    expect(configNames.indexOf('user/after')).toBe(last + 1)
  })
})

describe('promised composer configs', () => {
  it('copies frozen configs, and leaves a promised preset that two composers share unchanged', async () => {
    await using project = await withProject()
    const frozen = Object.freeze({ rules: Object.freeze({ 'no-console': 'off' as const }) })
    const preset = Promise.resolve([{ rules: { 'no-plusplus': 'off' as const } }])
    const first = await defineConfig({ root: project.dir, typeAware: false }).append(
      Promise.resolve(frozen),
      preset,
    )
    const second = await defineConfig({ root: project.dir, typeAware: false }).insertAfter(
      'gpahal/javascript/rules',
      preset,
    )
    expect(first.some((entry) => entry.rules?.['no-console'] === 'off')).toBe(true)
    expect(await preset).toEqual([{ rules: { 'no-plusplus': 'off' } }])
    expect(names(first)).toContain('user/append[1][0]')
    expect(names(second)).toContain('user/insertAfter[0][0]')
  })

  it('handles rejected inputs before the composer is awaited, and when a method throws', async () => {
    // A fresh process, since unhandled rejections are per process
    const output = await runNodeOk(
      [
        '--input-type=module',
        '--eval',
        `
const { defineConfig } = await import('@gpahal/eslint-config')
const rejections = []
process.on('unhandledRejection', (error) => rejections.push(error.message))
const root = process.argv[1]
const results = {}
for (const method of ['append', 'insertBefore']) {
  const composer = defineConfig({ root, typeAware: false, gitignore: false })
  const input = Promise.reject(new Error('config failed'))
  if (method === 'append') composer.append(input)
  else composer[method]('gpahal/javascript/rules', input)
  await new Promise((resolve) => setTimeout(resolve, 20))
  const error = await composer.then(() => undefined, (caught) => caught.message)
  results[method] = { error, rejections: rejections.splice(0) }
}
let error
try {
  defineConfig({ root, typeAware: false, gitignore: false }).insertAfter(undefined, Promise.reject(new Error('config failed')))
} catch (caught) {
  error = caught.message
}
await new Promise((resolve) => setTimeout(resolve, 20))
results.throws = { error, rejections: rejections.splice(0) }
console.log(JSON.stringify(results))
`,
        path.join(FIXTURES_DIR, 'typescript'),
      ],
      { cwd: path.join(import.meta.dirname, '..') },
    )
    expect(JSON.parse(output)).toEqual({
      append: { error: 'config failed', rejections: [] },
      insertBefore: { error: 'config failed', rejections: [] },
      throws: {
        error:
          '@gpahal/eslint-config: `.insertAfter()`: expected a config name, received `undefined`',
        rejections: [],
      },
    })
  })
})

describe('plugins that the presets register, in configs of yours', () => {
  const root = path.join(FIXTURES_DIR, 'markdown')
  const other = { rules: {} }

  it.each<[string, () => PromiseLike<unknown>, string]>([
    [
      'a nested array of configs',
      () => defineConfig({ root, configs: [[{}, { plugins: { 'package-json': other } }]] }),
      '`configs[0][1].plugins`',
    ],
    [
      '.override()',
      () => defineConfig({ root }).override('gpahal/setup', { plugins: { 'package-json': other } }),
      "`.override('gpahal/setup')`: `plugins`",
    ],
    [
      '.onResolved()',
      () =>
        defineConfig({ root }).onResolved((configs) => [
          ...configs,
          { plugins: { 'package-json': other } },
        ]),
      '`.onResolved()`: `plugins`',
    ],
  ])(
    'throws on another plugin under a preset plugin name through %s',
    async (_, build, subjects) => {
      await expect(build()).rejects.toThrow(
        `@gpahal/eslint-config: ${subjects}: registers \`package-json\` again with a different plugin. Set its rules with \`packageJson.rules\` instead`,
      )
    },
  )

  it('names no area for the `@gpahal` plugin, whose rules span areas', async () => {
    await expect(
      defineConfig({ root, configs: [{ plugins: { '@gpahal': other } }] }),
    ).rejects.toThrow(
      '@gpahal/eslint-config: `configs[0].plugins`: registers `@gpahal` again with a different plugin. Remove it from the config',
    )
  })

  it('takes the plugin object the preset registers, and a name no preset registers', async () => {
    const presets = await defineConfig({ root })
    const plugin = presets.find((config) => config.plugins?.['package-json'] !== undefined)
      ?.plugins?.['package-json']
    expect(plugin).toBeDefined()
    await expect(
      defineConfig({
        root,
        configs: [{ plugins: { 'package-json': plugin ?? other, mine: other } }],
      }),
    ).resolves.toBeDefined()
  })
})

describe('an un-awaited composer', () => {
  const KEY =
    '@gpahal/eslint-config: `defineConfig()`: returns a composer, which ESLint reads as a config object. Await it before using it in an array or `extends`'
  let project: AsyncDisposable & { dir: string }

  beforeAll(async () => {
    project = await withProject({ 'src/index.ts': 'var q = 1\nexport { q }\n' })
  })

  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  it.each([
    ['an array', (root: string) => [defineConfig({ root, typeAware: false })]],
    [
      "ESLint's `defineConfig`",
      (root: string) => eslintDefineConfig(defineConfig({ root, typeAware: false }) as never),
    ],
    [
      '`extends`',
      (root: string) =>
        eslintDefineConfig([{ extends: [defineConfig({ root, typeAware: false }) as never] }]),
    ],
  ])("names the mistake in ESLint's error in %s", async (_where, build) => {
    const eslint = new ESLint({
      cwd: project.dir,
      overrideConfigFile: true,
      overrideConfig: build(project.dir) as Array<Linter.Config>,
      fix: true,
    })
    await expect(eslint.lintFiles(['src/index.ts'])).rejects.toThrow(KEY)
  })

  it('throws a formatted error when spread', async () => {
    const composer: unknown = defineConfig({ root: project.dir, typeAware: false })
    expect(() => [...(composer as Iterable<unknown>)]).toThrow(
      '@gpahal/eslint-config: `defineConfig()`: returns a composer, which is iterable only once awaited. Await it, as in `export default await defineConfig(...)` or `...(await defineConfig(...))`',
    )
    await composer
  })

  it("isn't a key of the awaited configs", async () => {
    const configs = await defineConfig({ root: project.dir, typeAware: false })
    expect(Object.keys(configs)).toEqual(configs.map((_config, index) => String(index)))
    expect(configs.some((config) => Object.hasOwn(config, KEY))).toBe(false)
  })
})
