import path from 'node:path'

import { defineConfig, files } from '@/index'
import type { ConfigNames, EslintConfigOptions, TypedConfig } from '@/index'

import { CORE_AREAS_OFF, FIXTURES_DIR } from './helpers'

const root = path.join(FIXTURES_DIR, 'rules')

const RULE = '@typescript-eslint/no-floating-promises'

function typedRuleConfig(
  filesGlobs: NonNullable<TypedConfig['files']>,
  basePath?: string,
): TypedConfig {
  const config: TypedConfig = { files: filesGlobs, rules: { [RULE]: 'error' } }
  return basePath === undefined ? config : { ...config, basePath }
}

async function build(
  config: TypedConfig,
  options: Partial<EslintConfigOptions> = {},
): Promise<unknown> {
  return defineConfig({ root, isInEditor: false, ...CORE_AREAS_OFF, ...options, configs: [config] })
}

const JAVASCRIPT_FIX = 'Set `typeAware: { javascript: true }` or remove the rule'

describe('a type-aware rule in a config whose files get no type information', () => {
  it.each<[NonNullable<TypedConfig['files']>, Partial<EslintConfigOptions>, string, string?]>([
    [['src/x.cjs'], {}, `\`src/x.cjs\` files don't get. ${JAVASCRIPT_FIX}`],
    [
      [...files.codeBlock],
      { typeAware: { javascript: true } },
      `${files.codeBlock.map((glob) => `\`${glob}\``).join(' and ')} files don't get, as code blocks never get type information. Remove the rule`,
    ],
    [
      ['**/*.astro'],
      { root: path.join(FIXTURES_DIR, 'astro-untyped'), astro: true },
      "`**/*.astro` files don't get. Add a tsconfig.json for the `.astro` files or remove the rule",
    ],
    [
      ['generated/x.ts'],
      { typeAware: { ignores: ['generated/**'] } },
      "`generated/x.ts` files don't get. Take the files out of `typeAware.ignores` or remove the rule",
    ],
    [
      ['generated/**', '**/*.js', ...files.codeBlock],
      { typeAware: { ignores: ['generated/**'] } },
      `\`generated/**\`, \`**/*.js\`, ${files.codeBlock.map((glob) => `\`${glob}\``).join(' and ')} files don't get, as code blocks never get type information. Take the files out of \`typeAware.ignores\`, set \`typeAware: { javascript: true }\` or remove the rule`,
    ],
    // Read relative to the config's `basePath`
    [
      ['gen/**'],
      { typeAware: { ignores: ['packages/app/gen/**'] } },
      "`gen/**` files don't get. Take the files out of `typeAware.ignores` or remove the rule",
      'packages/app',
    ],
  ])('throws for %j', async (globs, options, message, basePath) => {
    await expect(build(typedRuleConfig(globs, basePath), options)).rejects.toThrow(
      `@gpahal/eslint-config: \`configs[0]\`: \`${RULE}\`: needs type information, which ${message}`,
    )
  })

  it.each<[string, NonNullable<TypedConfig['files']>, Partial<EslintConfigOptions>, string?]>([
    ['JavaScript with `typeAware.javascript`', ['**/*.js'], { typeAware: { javascript: true } }],
    [
      'JavaScript the default project types',
      ['**/*.js'],
      { typeAware: { allowDefaultProject: ['*.config.js'] } },
    ],
    [
      '`.astro` files with a tsconfig',
      ['**/*.astro'],
      { root: path.join(FIXTURES_DIR, 'astro'), astro: true },
    ],
    ['typed and untyped globs', ['**/*.js', 'src/**/*.ts'], {}],
    ['an ANDed entry with a typed glob', [['src/**', '**/*.ts']], {}],
    [
      'a glob that `typeAware.ignores` leaves out with a `!` glob',
      ['generated/**/*.ts'],
      { typeAware: { ignores: ['generated/**', '!generated/typed/**'] } },
    ],
    [
      "a glob that `typeAware.ignores` covers only when it isn't read relative to its config's `basePath`",
      ['packages/app/gen/**'],
      { typeAware: { ignores: ['packages/app/gen/**'] } },
      'packages/app',
    ],
  ])('keeps the rule for %s', async (_name, globs, options, basePath) => {
    await expect(build(typedRuleConfig(globs, basePath), options)).resolves.toBeInstanceOf(Array)
  })

  it.each<[string, (composer: ReturnType<typeof defineConfig>) => unknown]>([
    ['.append()', (composer) => composer.append(typedRuleConfig(['**/*.js']))],
    [
      '.override() with `files`',
      (composer) =>
        composer
          .append({ name: 'user/ts', files: ['**/*.ts'], rules: { [RULE]: 'error' } })
          .override('user/ts' as ConfigNames, { files: ['**/*.js'] }),
    ],
    [
      '.onResolved()',
      (composer) => composer.onResolved((configs) => [...configs, typedRuleConfig(['**/*.js'])]),
    ],
  ])('throws through %s', async (_method, change) => {
    const composer = defineConfig({ root, isInEditor: false, ...CORE_AREAS_OFF })
    await expect(change(composer)).rejects.toThrow(
      `\`${RULE}\`: needs type information, which \`**/*.js\` files don't get. ${JAVASCRIPT_FIX}`,
    )
  })
})
