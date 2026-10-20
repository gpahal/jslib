import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolve } from 'import-meta-resolve'
import stylelint, { type Config } from 'stylelint'

import { assertBuildIsCurrent, runNodeOk, withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig, type StylelintExtendedConfig, type StylelintRules } from '@/index'

/**
 * The package's folder, which holds a `package.json`, as `root` requires
 */
const PACKAGE_ROOT = path.dirname(import.meta.dirname)

const syntax = (name: string) => ({ syntax: { atRules: { [name]: { prelude: '<ident>' } } } })

/**
 * The rules that `config` reports on `code` in `file`
 */
async function rulesAt(config: Config, file: string, code = 'a {\n  color: red;\n}\n') {
  const { results } = await stylelint.lint({ code, config, codeFilename: file })
  return results.flatMap((result) => result.warnings.map((warning) => warning.rule))
}

/**
 * The rule and severity of each warning that `config` reports on `code` in `file`
 */
async function warningsOf(config: Config, file: string, code: string): Promise<Array<string>> {
  const { results } = await stylelint.lint({ code, codeFilename: file, config })
  return results.flatMap((result) =>
    result.warnings.map((warning) => `${warning.rule}: ${warning.severity}`),
  )
}

test('resolves references, ignores and overrides from a root with glob characters', async () => {
  await using project = await withTmpProject('stylelint-config-root', {
    'root[+](x){a}/package.json': '{}',
    'root[+](x){a}/tokens.css': ':root { --source: red; }',
    'root[+](x){a}/syntax.mjs': `export { default } from ${JSON.stringify(import.meta.resolve('postcss'))}`,
    'root[+](x){a}/loader.mjs':
      "export default { postcssPlugin: 'reference-loader', Once(root) { root.append(':root { --brand: red; }') } }",
    'elsewhere/package.json': '{}',
  })
  const root = path.join(project.dir, 'root[+](x){a}')
  const config = await defineConfig({
    root,
    markdown: false,
    customSyntax: './syntax.mjs',
    referenceFiles: [{ files: 'tokens.css', customSyntax: './syntax.mjs', loader: './loader.mjs' }],
    rules: { 'declaration-property-value-no-unknown': null },
    ignoreFiles: () => ['vendor/**', '!vendor/keep.css'],
    overrides: [
      {
        files: ['src/**/*.css'],
        ignoreFiles: ['src/ignored/**'],
        rules: { 'color-no-invalid-hex': null },
      },
    ],
  })
  for (const [file, expected] of [
    ['src/a.css', []],
    ['other/a.css', ['color-no-invalid-hex']],
    ['vendor/a.css', []],
    ['vendor/keep.css', ['color-no-invalid-hex']],
    ['src/ignored/a.css', []],
  ] as const) {
    const { results } = await stylelint.lint({
      code: 'a {\n  color: #ff00zz;\n  background: var(--brand);\n}\n',
      codeFilename: path.join(root, file),
      config,
      configBasedir: path.join(project.dir, 'elsewhere'),
      cwd: project.dir,
    })
    expect(results.flatMap((result) => result.warnings.map((warning) => warning.rule))).toEqual(
      expected,
    )
  }
})

test('keeps nested object extends lists, syntax and disable settings ahead of user settings', async () => {
  await using project = await withTmpProject('stylelint-config-extends', {
    'tokens.css': ':root { --brand: red; }',
  })
  const shared = {
    extends: [{ ignoreFiles: ['generated/**'], reportInvalidScopeDisables: false }],
    ignoreFiles: ['vendor/**'],
    referenceFiles: ['tokens.css'],
    languageOptions: syntax('brand'),
    reportNeedlessDisables: false,
    rules: { 'number-max-precision': 2 },
  }
  const original = structuredClone(shared)
  const config = await defineConfig({
    root: project.dir,
    extends: [shared],
    markdown: false,
    tailwindcss: false,
    ignoreFiles: () => ['local/**', 'vendor/**'],
    reportNeedlessDisables: true,
  })
  expect(config.ignoreFiles).toEqual([
    `${project.dir}/**/*.{md,markdown}`,
    `${project.dir}/generated/**`,
    `${project.dir}/local/**`,
    `${project.dir}/vendor/**`,
  ])
  expect(config.reportInvalidScopeDisables).toBe(false)
  expect(config.reportNeedlessDisables).toBe(true)
  expect(
    await rulesAt(
      config,
      path.join(project.dir, 'a.css'),
      '@brand primary;\n\na {\n  color: var(--brand);\n}\n',
    ),
  ).toEqual([])
  expect(shared).toEqual(original)
})

test.each(['.mjs', '.cjs'])(
  'loads named nested configs relative to their modules and reloads %s files',
  async (extension) => {
    const exported = extension === '.cjs' ? 'module.exports =' : 'export default'
    await using project = await withTmpProject('stylelint-config-loaded', {
      'package.json': '{"type":"module"}',
      'node_modules/shared/package.json': `{"type":"module","main":"index${extension}"}`,
      [`node_modules/shared/index${extension}`]: `${exported} { extends: './nested.mjs', ignoreFiles: ['vendor/**'], referenceFiles: ['tokens.css'] }`,
      'node_modules/shared/nested.mjs':
        "export default { plugins: ['local-plugin'], rules: { 'local/report': true } }",
      'node_modules/shared/node_modules/local-plugin/package.json':
        '{"type":"module","main":"index.mjs"}',
      'node_modules/shared/node_modules/local-plugin/index.mjs':
        "const rule = () => (_root, result) => { result.warn('local', { rule: 'local/report' }) }; rule.ruleName = 'local/report'; export default { ruleName: 'local/report', rule }",
      'node_modules/shared/tokens.css': ':root { --brand: red; }',
    })
    const config = await defineConfig({ root: project.dir, extends: 'shared', markdown: false })
    expect(config.referenceFiles).toEqual([`${project.dir}/node_modules/shared/tokens.css`])
    expect(
      await rulesAt(config, path.join(project.dir, 'a.css'), 'a {\n  color: var(--brand);\n}\n'),
    ).toEqual(['local/report'])
    await fs.writeFile(
      path.join(project.dir, `node_modules/shared/index${extension}`),
      `${exported} { reportInvalidScopeDisables: false }`,
    )
    expect(
      (await defineConfig({ root: project.dir, extends: 'shared' })).reportInvalidScopeDisables,
    ).toBe(false)
  },
)

test('loads override extends from their declaring config folder', async () => {
  await using project = await withTmpProject('stylelint-config-override-extends', {
    'configs/shared.mjs':
      "export default { overrides: [{ files: 'src/**/*.css', extends: './override.mjs' }] }",
    'configs/override.mjs': "export default { rules: { 'color-named': 'never' } }",
  })
  const config = await defineConfig({
    root: project.dir,
    extends: './configs/shared.mjs',
    rules: { 'declaration-property-value-no-unknown': null },
  })
  expect(await rulesAt(config, path.join(project.dir, 'src/a.css'))).toEqual(['color-named'])
})

test('rejects cyclic and over-deep extends graphs and keeps load failures as causes', async () => {
  const cycle: StylelintExtendedConfig = {}
  cycle.extends = cycle
  await expect(defineConfig({ root: PACKAGE_ROOT, extends: cycle })).rejects.toThrow(
    'extends contains a cycle',
  )
  // The depth check also counts a subtree reached again from the cache
  const shared: StylelintExtendedConfig = { extends: { ignoreFiles: ['vendor/**'] } }
  let deep: StylelintExtendedConfig = shared
  for (let index = 0; index < 31; index++) deep = { extends: deep }
  await expect(defineConfig({ root: PACKAGE_ROOT, extends: [shared, deep] })).rejects.toThrow(
    'extends nests more than 32 deep',
  )
  await expect(
    defineConfig({ root: PACKAGE_ROOT, extends: 'missing-config-39418' }),
  ).rejects.toMatchObject({
    message: expect.stringContaining(
      "@gpahal/stylelint-config: `extends[0]`: can't load `missing-config-39418`:",
    ) as unknown,
    cause: expect.any(Error) as unknown,
  })
})

test.each([
  ['commonjs', 'module.exports ='],
  [undefined, 'export default await Promise.resolve'],
])('reloads .js configs with package type %s and %s in Node', async (type, exported) => {
  const buildDir = path.join(import.meta.dirname, '../build')
  await assertBuildIsCurrent(buildDir)
  await using project = await withTmpProject('stylelint-config-js-reload', {
    'package.json': JSON.stringify(type === undefined ? {} : { type }),
    'check.mjs': `
      import assert from 'node:assert/strict'
      import fs from 'node:fs/promises'
      import { defineConfig } from ${JSON.stringify(pathToFileURL(path.join(buildDir, 'index.js')).href)}
      for (const value of [true, false]) {
        await fs.writeFile(new URL('./config.js', import.meta.url), ${JSON.stringify(exported)} + ' ({ reportInvalidScopeDisables: ' + value + ' })')
        const config = await defineConfig({ root: import.meta.dirname, extends: './config.js' })
        assert.equal(config.reportInvalidScopeDisables, value)
      }
    `,
  })
  await runNodeOk([path.join(project.dir, 'check.mjs')], { cwd: project.dir })
})

/**
 * The source of a config module that counts its evaluations in the file `count` next to it
 */
function countingModule(format: 'esm' | 'cjs', value: string): string {
  const count =
    "const count = path.join(__dirname, 'count'); fs.writeFileSync(count, String(fs.existsSync(count) ? Number(fs.readFileSync(count, 'utf8')) + 1 : 1));"
  return format === 'esm'
    ? `import fs from 'node:fs'; import path from 'node:path'; const __dirname = import.meta.dirname; ${count} export default ${value}`
    : `const fs = require('node:fs'); const path = require('node:path'); ${count} module.exports = ${value}`
}

async function evaluations(dir: string): Promise<string> {
  return fs.readFile(path.join(dir, 'count'), 'utf8')
}

describe.each([
  ['esm', '.mjs'],
  ['cjs', '.cjs'],
] as const)('reuses an unchanged %s config module', (format, extension) => {
  const file = `shared${extension}`

  it('across calls, and once per call', async () => {
    await using project = await withTmpProject('stylelint-config-module-reuse', {
      [file]: countingModule(format, '{}'),
    })
    await defineConfig({
      root: project.dir,
      extends: [`./${file}`, { extends: `./${file}` }],
      overrides: [{ files: '*.css', extends: `./${file}` }],
    })
    expect(await evaluations(project.dir)).toBe('1')
    await defineConfig({ root: project.dir, extends: `./${file}` })
    expect(await evaluations(project.dir)).toBe('1')
  })

  it('until its content changes, even with the same length and timestamps', async () => {
    await using project = await withTmpProject('stylelint-config-module-reuse', {
      [file]: countingModule(format, '{ reportInvalidScopeDisables: true }'),
    })
    const filename = path.join(project.dir, file)
    const load = async () =>
      (await defineConfig({ root: project.dir, extends: `./${file}` })).reportInvalidScopeDisables
    expect(await load()).toBe(true)
    const { atime, mtime } = await fs.stat(filename)
    await fs.writeFile(filename, countingModule(format, '{ reportInvalidScopeDisables: 1234 }'))
    await fs.utimes(filename, atime, mtime)
    expect(await load()).toBe(1234)
    expect(await evaluations(project.dir)).toBe('2')
  })
})

test("keeps a returned config's changes out of later calls", async () => {
  await using project = await withTmpProject('stylelint-config-module-reuse', {
    'shared.mjs':
      "export default { ignoreFiles: ['vendor/**'], rules: { 'color-named': 'never' } }",
  })
  const first = await defineConfig({ root: project.dir, extends: './shared.mjs' })
  ;(first.ignoreFiles as Array<string>).push('mutated/**')
  const extended = (first.extends as Array<unknown>).find(
    (entry): entry is Config => typeof entry === 'object' && entry !== null && 'rules' in entry,
  )
  extended!.rules!['color-named'] = 'always-where-possible'
  const second = await defineConfig({ root: project.dir, extends: './shared.mjs' })
  expect(second.ignoreFiles).toEqual([`${project.dir}/vendor/**`])
  expect(await rulesAt(second, path.join(project.dir, 'a.css'))).toContain('color-named')
})

test.each([
  ['extends: [42]', 'extends[0].extends[0]', 'expected a config object, received `42`'],
  ['overrides: {}', 'extends[0].overrides', 'expected an array of overrides, received an object'],
  [
    `ignoreFiles: [${JSON.stringify(`${'{a,'.repeat(11)}b${'}'.repeat(11)}`)}]`,
    'extends[0].ignoreFiles[0]',
    'glob',
  ],
  ['fix: true', 'extends[0].fix', "isn't taken, since it hides problems without writing fixes"],
])('validates loaded config %s', async (source, subject, reason) => {
  await using project = await withTmpProject('stylelint-config-invalid-loaded', {
    'shared.mjs': `export default { ${source} }`,
  })
  await expect(defineConfig({ root: project.dir, extends: './shared.mjs' })).rejects.toThrow(
    `@gpahal/stylelint-config: \`${subject}\`: ${reason}`,
  )
})

test.each(['.yaml', ''])(
  'loads and reloads %s data configs from their own folder',
  async (extension) => {
    const serialize = (value: boolean) =>
      `referenceFiles:\n  - tokens.css\nreportInvalidScopeDisables: ${String(value)}\n`
    await using project = await withTmpProject('stylelint-config-data', {
      'shared/tokens.css': ':root { --brand: red; }',
    })
    for (const value of [true, false]) {
      await fs.writeFile(
        path.join(project.dir, `shared/.stylelintrc${extension}`),
        serialize(value),
      )
      const config = await defineConfig({
        root: project.dir,
        extends: `./shared/.stylelintrc${extension}`,
      })
      expect(config.reportInvalidScopeDisables).toBe(value)
      expect(config.referenceFiles).toEqual([`${project.dir}/shared/tokens.css`])
    }
  },
)

test.each(['object', 'module'])(
  'preserves matching inherited settings from a %s config',
  async (form) => {
    const shared = {
      languageOptions: syntax('base'),
      ignoreFiles: ['vendor/**'],
      referenceFiles: ['base.css'],
      reportDescriptionlessDisables: true,
      overrides: [
        {
          files: ['vendor/**/*.css'],
          languageOptions: syntax('brand'),
          ignoreFiles: ['!vendor/**'],
          referenceFiles: ['brand.css'],
          reportDescriptionlessDisables: false,
        },
      ],
    }
    const original = structuredClone(shared)
    await using project = await withTmpProject('stylelint-config-inherited-overrides', {
      'shared.mjs': `export default ${JSON.stringify(shared)}`,
      'base.css': ':root { --base: red; }',
      'brand.css': ':root { --brand: red; }',
    })
    const config = await defineConfig({
      root: project.dir,
      extends: form === 'object' ? shared : './shared.mjs',
    })
    const file = path.join(project.dir, 'vendor/a.css')
    const { results } = await stylelint.lint({
      code: '@brand primary;\n\na {\n  color: var(--brand);\n}\n',
      codeFilename: file,
      config,
    })
    expect(results[0]!.ignored).not.toBe(true)
    expect(results[0]!.warnings).toEqual([])
    expect((await stylelint.resolveConfig(file, { config }))?.reportDescriptionlessDisables).toBe(
      false,
    )
    expect(shared).toEqual(original)
  },
)

test('keeps native sibling precedence, nested conditions and user merges', async () => {
  const first = {
    languageOptions: syntax('first'),
    overrides: [
      { files: '**/*.css', languageOptions: syntax('brand'), reportNeedlessDisables: false },
    ],
  }
  const second = { languageOptions: syntax('second'), reportNeedlessDisables: true }
  const root = PACKAGE_ROOT
  const config = await defineConfig({
    root,
    extends: [{ extends: first }, second],
    languageOptions: syntax('user'),
  })
  const resolved = await stylelint.resolveConfig(path.join(root, 'a.css'), { config })
  expect(resolved?.languageOptions).toEqual({
    syntax: {
      atRules: {
        first: { prelude: '<ident>' },
        second: { prelude: '<ident>' },
        user: { prelude: '<ident>' },
      },
    },
  })
  expect(resolved?.reportNeedlessDisables).toBe(true)
  const nested = await defineConfig({
    root,
    // @ts-expect-error - Native Stylelint accepts object extends inside inherited overrides
    extends: {
      extends: first,
      overrides: [
        {
          files: '**/special/*.css',
          extends: { overrides: [{ files: '**/*.css', languageOptions: syntax('nested') }] },
        },
      ],
    },
    languageOptions: syntax('user'),
    reportNeedlessDisables: true,
    overrides: [{ files: '**/special/*.css', languageOptions: syntax('local') }],
  })
  const special = await stylelint.resolveConfig(path.join(root, 'special/a.css'), {
    config: nested,
  })
  expect(special?.languageOptions).toEqual({
    syntax: {
      atRules: {
        nested: { prelude: '<ident>' },
        user: { prelude: '<ident>' },
        local: { prelude: '<ident>' },
      },
    },
  })
  expect(special?.reportNeedlessDisables).toBe(true)
})

test('activates conditional reference rules while preserving Markdown and explicit settings', async () => {
  await using project = await withTmpProject('stylelint-config-conditional-references', {
    'tokens.css': ':root { --brand: red; }',
  })
  const config = await defineConfig({
    root: project.dir,
    extends: { overrides: [{ files: '**/special/**', referenceFiles: ['tokens.css'] }] },
    overrides: [
      { files: '**/special/allowed.css', rules: { 'no-unknown-custom-properties': null } },
    ],
  })
  for (const [file, expected] of [
    ['special/a.css', ['no-unknown-custom-properties']],
    ['special/allowed.css', []],
    ['a.css', []],
    ['special/a.md', []],
  ] as const) {
    const css = 'a {\n  color: var(--missing);\n}\n'
    expect(
      await rulesAt(
        config,
        path.join(project.dir, file),
        file.endsWith('.md') ? `\`\`\`css\n${css}\`\`\`\n` : css,
      ),
      file,
    ).toEqual(expected)
  }
})

// Stylelint matches globs against the spelling of the path it lints, so a `root` spelled through a
// symlink gets globs for its real path too
test("applies globs to files spelled from root's link and real path", async () => {
  await using project = await withTmpProject('stylelint-config-root-spelling', {
    'real/package.json': '{"type":"module"}\n',
  })
  const real = await fs.realpath(path.join(project.dir, 'real'))
  const link = path.join(project.dir, 'link')
  await fs.symlink(real, link)
  const config = await defineConfig({
    root: link,
    ignoreFiles: ['vendor/**'],
    overrides: [{ files: ['src/legacy/**'], rules: { 'color-named': 'never' } }],
  })
  for (const folder of [link, real]) {
    const { results } = await stylelint.lint({
      code: 'a {\n  color: #ff00zz;\n}\n',
      config,
      codeFilename: path.join(folder, 'vendor/a.css'),
    })
    expect(results[0]?.ignored).toBe(true)
    expect(await rulesAt(config, path.join(folder, 'src/legacy/a.css'))).toContain('color-named')
  }
})

/**
 * The rules native Stylelint reports for `config` on a CSS file in `dir`, or its error message
 */
async function nativeRules(dir: string, config: Config): Promise<Array<string> | string> {
  try {
    const { results } = await stylelint.lint({
      code: 'a {\n  color: red;\n}\n',
      codeFilename: path.join(dir, 'a.css'),
      config,
      configBasedir: dir,
      cwd: dir,
    })
    return results.flatMap((result) => result.warnings.map((warning) => warning.rule))
  } catch (error) {
    return (error as Error).message
  }
}

describe('resolves extended package configs as native Stylelint does', () => {
  const files = {
    'package.json': '{}',
    'node_modules/fake-cfg/package.json': '{ "name": "fake-cfg", "main": "index.js" }',
    'node_modules/fake-cfg/index.js': "module.exports = { rules: { 'color-named': 'never' } }",
    'node_modules/fake-cfg/strict.js': "module.exports = { rules: { 'color-named': 'never' } }",
    'node_modules/fake-cfg/data.json': JSON.stringify({ rules: { 'color-named': 'never' } }),
    'node_modules/fake-cfg/dir/index.js': "module.exports = { rules: { 'color-named': 'never' } }",
    'node_modules/exported-cfg/package.json': JSON.stringify({
      name: 'exported-cfg',
      exports: { './strict': './strict.js', './package.json': './package.json' },
    }),
    'node_modules/exported-cfg/strict.js': "module.exports = { rules: { 'color-named': 'never' } }",
    'node_modules/exported-cfg/hidden.js': "module.exports = { rules: { 'color-named': 'never' } }",
    'node_modules/fake-plugin/package.json': '{ "name": "fake-plugin" }',
    'node_modules/fake-plugin/rule.js':
      "const rule = () => (_root, result) => { result.warn('fake', { rule: 'fake/report' }) }; rule.ruleName = 'fake/report'; module.exports = { ruleName: 'fake/report', rule }",
  }

  it.each(['fake-cfg/strict', 'fake-cfg/data', 'exported-cfg/strict'])('%s', async (entry) => {
    await using project = await withTmpProject('stylelint-config-package-paths', files)
    expect(await nativeRules(project.dir, { extends: [entry] })).toContain('color-named')
    const config = await defineConfig({ root: project.dir, extends: entry })
    expect(await rulesAt(config, path.join(project.dir, 'a.css'))).toContain('color-named')
  })

  it.each([
    ['exported-cfg/hidden', 'ERR_PACKAGE_PATH_NOT_EXPORTED'],
    ['missing-cfg-5150', 'ERR_MODULE_NOT_FOUND'],
  ])("rejects %s, which native Stylelint can't find", async (entry, code) => {
    await using project = await withTmpProject('stylelint-config-package-paths', files)
    expect(await nativeRules(project.dir, { extends: [entry] })).toContain(
      `Could not find "${entry}"`,
    )
    await expect(
      defineConfig({ root: project.dir, extends: { extends: [entry] } }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        `@gpahal/stylelint-config: \`extends[0].extends[0]\`: can't load \`${entry}\`:`,
      ) as unknown,
      cause: expect.objectContaining({ code }) as unknown,
    })
  })

  it('resolves an extensionless plugin path', async () => {
    await using project = await withTmpProject('stylelint-config-package-paths', files)
    const options = { plugins: ['fake-plugin/rule'], rules: { 'fake/report': true } }
    expect(await nativeRules(project.dir, options)).toEqual(['fake/report'])
    const config = await defineConfig({ root: project.dir, ...options })
    expect(await rulesAt(config, path.join(project.dir, 'a.css'))).toContain('fake/report')
    await expect(
      defineConfig({ root: project.dir, plugins: ['fake-plugin/missing'] }),
    ).rejects.toThrow("@gpahal/stylelint-config: `plugins[0]`: can't find `fake-plugin/missing`")
    // The folder it resolves from, not a config file there that may not exist
    await expect(
      defineConfig({ root: project.dir, plugins: ['missing-plugin-5150'] }),
    ).rejects.toThrow(new RegExp(`imported from ${RegExp.escape(project.dir + path.sep)}$`))
  })
})

describe('extends beat the preset, and your rules merge over them', () => {
  it('merges your secondary options over the setting of an extended config', async () => {
    await using project = await withTmpProject('stylelint-config-extends-precedence', {
      'team.mjs': `export default { rules: {
        'color-named': 'never',
        'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['export'] }],
      } }`,
    })
    const rules: StylelintRules = {
      'color-named': [undefined, { severity: 'warning' }],
      'selector-pseudo-class-no-unknown': [undefined, { ignorePseudoClasses: ['deep'] }],
    }
    const file = path.join(project.dir, 'x.css')
    for (const config of [
      await defineConfig({ root: project.dir, extends: ['./team.mjs'], rules }),
      await defineConfig({
        root: project.dir,
        overrides: [{ files: ['*.css'], extends: ['./team.mjs'], rules }],
      }),
    ]) {
      const resolved = await stylelint.resolveConfig(file, { config })
      expect(resolved?.rules?.['color-named']).toEqual(['never', { severity: 'warning' }])
      expect(resolved?.rules?.['selector-pseudo-class-no-unknown']).toEqual([
        true,
        { ignorePseudoClasses: ['export', 'deep'] },
      ])
      expect(await warningsOf(config, file, 'a {\n  color: red;\n}\n')).toEqual([
        'color-named: warning',
      ])
    }
  })

  it('gives the own rule that replaces a stock rule the extended setting of the stock rule', async () => {
    await using project = await withTmpProject('stylelint-config-extends-own-rules', {
      'team.mjs': "export default { rules: { 'declaration-empty-line-before': 'never' } }",
    })
    const config = await defineConfig({
      root: project.dir,
      tailwindcss: true,
      extends: ['./team.mjs'],
    })
    const resolved = await stylelint.resolveConfig(path.join(project.dir, 'x.css'), { config })
    expect(resolved?.rules?.['declaration-empty-line-before']).toBeNull()
    expect(resolved?.rules?.['@gpahal/declaration-empty-line-before']).toEqual(['never'])
  })

  it('throws on a setting that keeps the primary option of a rule no config sets', async () => {
    await expect(
      defineConfig({
        root: PACKAGE_ROOT,
        overrides: [
          { files: 'legacy/**', rules: { 'color-named': [undefined, { severity: 'warning' }] } },
        ],
      }),
    ).rejects.toThrow(
      new TypeError(
        "@gpahal/stylelint-config: `overrides[0].rules.color-named`: keeps the primary option of a setting that no config sets, so Stylelint would turn the rule off. Set the primary option, as in ['always', { … }]",
      ),
    )
  })
})

describe('the reference rules follow the precedence of the preset settings', () => {
  const missing = 'a {\n  color: var(--missing);\n}\n'

  it("lets an override's extends turn them off for its files", async () => {
    await using project = await withTmpProject('stylelint-config-reference-override-extends', {
      'tokens.css': ':root { --brand: red; }',
      'quiet.mjs': "export default { rules: { 'no-unknown-custom-properties': null } }",
    })
    const config = await defineConfig({
      root: project.dir,
      referenceFiles: ['tokens.css'],
      overrides: [{ files: 'legacy/**', extends: ['./quiet.mjs'] }],
    })
    expect(await warningsOf(config, path.join(project.dir, 'legacy/a.css'), missing)).toEqual([])
    expect(await warningsOf(config, path.join(project.dir, 'a.css'), missing)).toEqual([
      'no-unknown-custom-properties: error',
    ])
  })
})

/**
 * A project that can resolve the base config packages by name, linked as pnpm links them
 */
async function projectWithBases(
  files: Readonly<Record<string, string>> = {},
): Promise<AsyncDisposable & { dir: string }> {
  const project = await withTmpProject('stylelint-config-extends-bases', {
    'package.json': '{}',
    ...files,
  })
  try {
    await fs.mkdir(path.join(project.dir, 'node_modules'), { recursive: true })
    for (const name of ['stylelint-config-standard', 'stylelint-config-recess-order']) {
      const target = await fs.realpath(path.join(PACKAGE_ROOT, 'node_modules', name))
      await fs.symlink(target, path.join(project.dir, 'node_modules', name), 'dir')
    }
  } catch (error) {
    await project[Symbol.asyncDispose]()
    throw error
  }
  return project
}

/**
 * The resolved rules of `options` for `file`, without `color-named`, which the team config sets.
 * A function, such as a pattern rule's `message`, is given as its source, since each load of a
 * config module makes new ones
 */
async function resolvedRules(
  options: Parameters<typeof defineConfig>[0],
  file: string,
): Promise<unknown> {
  const config = await defineConfig(options)
  const { 'color-named': _colorNamed, ...rules } =
    (await stylelint.resolveConfig(file, { config }))?.rules ?? {}
  return JSON.parse(
    JSON.stringify(rules, (_key, value: unknown) =>
      typeof value === 'function' ? String(value) : value,
    ),
  )
}

describe("skips the base configs the preset builds on when they're reached through extends", () => {
  it.each([
    ['top level', (dir: string) => ({ root: dir, extends: ['./outer.mjs'] })],
    [
      "an override's extends",
      (dir: string) => ({ root: dir, overrides: [{ files: ['*.css'], extends: ['./outer.mjs'] }] }),
    ],
  ])(
    'keeps the preset and Tailwind settings under a chain that extends a base, at %s',
    async (_name, options) => {
      await using project = await projectWithBases({
        'team.mjs':
          "export default { extends: ['stylelint-config-standard'], rules: { 'color-named': 'never' } }",
        'outer.mjs': "export default { extends: [{ extends: ['./team.mjs'] }] }",
      })
      const file = path.join(project.dir, 'x.css')
      const config = await defineConfig({ ...options(project.dir), tailwindcss: true })
      expect(
        await warningsOf(
          config,
          file,
          "@import 'tailwindcss';\n\n.a {\n  color: theme(--color-red-500);\n}\n",
        ),
      ).toEqual([])
      expect(await warningsOf(config, file, 'a {\n  color: red;\n}\n')).toEqual([
        'color-named: error',
      ])
      expect(await resolvedRules({ ...options(project.dir), tailwindcss: true }, file)).toEqual(
        await resolvedRules({ root: project.dir, tailwindcss: true }, file),
      )
    },
  )

  it.each([
    ['by name', 'stylelint-config-standard'],
    [
      'through the recommended config it extends',
      fileURLToPath(
        resolve('stylelint-config-recommended', import.meta.resolve('stylelint-config-standard')),
      ),
    ],
  ])('keeps the preset settings when you extend a base config %s', async (_name, entry) => {
    await using project = await projectWithBases()
    const file = path.join(project.dir, 'x.css')
    for (const tailwindcss of [false, true]) {
      expect(
        await resolvedRules({ root: project.dir, tailwindcss, extends: [entry] }, file),
      ).toEqual(await resolvedRules({ root: project.dir, tailwindcss }, file))
    }
  })

  it('lets another extended config beat recess order, even when a later one extends it', async () => {
    await using project = await projectWithBases({
      'node_modules/stylelint-config-clean-order/package.json':
        '{ "name": "stylelint-config-clean-order", "main": "index.js" }',
      'node_modules/stylelint-config-clean-order/index.js':
        "module.exports = { rules: { 'order/properties-order': ['color', 'display'] } }",
      'team.mjs':
        "export default { extends: ['stylelint-config-standard', 'stylelint-config-recess-order'] }",
    })
    const file = path.join(project.dir, 'x.css')
    for (const options of [
      { extends: ['./team.mjs', 'stylelint-config-clean-order'] },
      { extends: ['stylelint-config-clean-order', './team.mjs'] },
      {
        extends: ['stylelint-config-clean-order'],
        overrides: [{ files: ['*.css'], extends: ['./team.mjs'] }],
      },
    ]) {
      const config = await defineConfig({ root: project.dir, ...options })
      const resolved = await stylelint.resolveConfig(file, { config })
      expect(resolved?.rules?.['order/properties-order']).toEqual([['color', 'display']])
    }
  })
})
