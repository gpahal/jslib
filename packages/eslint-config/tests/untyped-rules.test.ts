import path from 'node:path'

import {
  defineConfig,
  files,
  type ConfigNames,
  type EslintConfigOptions,
  type TypedConfig,
} from '@/index'

import { FIXTURES_DIR } from './helpers'

const root = path.join(FIXTURES_DIR, 'rules')

const RULE = '@typescript-eslint/no-floating-promises'

function typedRuleConfig(filesGlobs: NonNullable<TypedConfig['files']>): TypedConfig {
  return { files: filesGlobs, rules: { [RULE]: 'error' } }
}

async function build(
  config: TypedConfig,
  options: Partial<EslintConfigOptions> = {},
): Promise<unknown> {
  return defineConfig({ root, isInEditor: false, ...options, configs: [config] })
}

const JAVASCRIPT_FIX = 'Set `typeAware: { javascript: true }` or remove the rule'

describe('a type-aware rule in a config whose files get no type information', () => {
  it.each<[NonNullable<TypedConfig['files']>, Partial<EslintConfigOptions>, string]>([
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
  ])('throws for %j', async (globs, options, message) => {
    await expect(build(typedRuleConfig(globs), options)).rejects.toThrow(
      `@gpahal/eslint-config: \`configs[0]\`: \`${RULE}\`: needs type information, which ${message}`,
    )
  })

  it('reads the globs of a config with a `basePath` relative to it', async () => {
    const ignores = { typeAware: { ignores: ['packages/app/gen/**'] } }
    await expect(
      build({ ...typedRuleConfig(['gen/**']), basePath: 'packages/app' }, ignores),
    ).rejects.toThrow("`gen/**` files don't get")
    await expect(
      build({ ...typedRuleConfig(['packages/app/gen/**']), basePath: 'packages/app' }, ignores),
    ).resolves.toBeInstanceOf(Array)
  })

  it.each<[string, NonNullable<TypedConfig['files']>, Partial<EslintConfigOptions>]>([
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
  ])('keeps the rule for %s', async (_name, globs, options) => {
    await expect(build(typedRuleConfig(globs), options)).resolves.toBeInstanceOf(Array)
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
    const composer = defineConfig({ root, isInEditor: false })
    await expect(change(composer)).rejects.toThrow(
      `\`${RULE}\`: needs type information, which \`**/*.js\` files don't get. ${JAVASCRIPT_FIX}`,
    )
  })
})
