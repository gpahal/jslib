import fs from 'node:fs/promises'
import path from 'node:path'

import { runNode, withTmpProject, writeFiles } from '@gpahal/internal/node/testing'

const PACKAGE_DIR = path.join(import.meta.dirname, '..')

const BUILD_DIR = path.join(PACKAGE_DIR, 'build')

/**
 * Lints `files` with `config` as the project's `stylelint.config.mjs`, in a directory of its own in
 * `projectDir`, with the Stylelint CLI of `projectDir`. Files in `node_modules` are written, not
 * linted
 */
async function runStylelint(projectDir: string, config: string, files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(projectDir, 'case-'))
  await writeFiles(dir, {
    ...files,
    'package.json': '{"type":"module"}\n',
    'stylelint.config.mjs': config,
  })
  const { status, stdout, stderr } = await runNode(
    [
      path.join(projectDir, 'node_modules/stylelint/bin/stylelint.mjs'),
      ...Object.keys(files).filter((file) => !file.startsWith('node_modules/')),
      '--formatter',
      'json',
    ],
    { cwd: dir },
  )
  return { status, output: `${stdout}${stderr}` }
}

const DEFINE_CONFIG =
  "import { defineConfig } from '@gpahal/stylelint-config'\n\nexport default defineConfig({ root: import.meta.dirname })\n"

/**
 * Links `name` in `nodeModulesDir` to the real directory of `from`'s dependency `name`
 */
async function linkDependency(nodeModulesDir: string, from: string, name: string) {
  const link = path.join(nodeModulesDir, name)
  await fs.mkdir(path.dirname(link), { recursive: true })
  await fs.symlink(await fs.realpath(path.join(from, 'node_modules', name)), link)
}

/**
 * A team preset's folder in `projectDir`, with `config` as its `stylelint.config.mjs`, and the path
 * of that file
 */
async function writePreset(projectDir: string, config: string) {
  const dir = await fs.mkdtemp(path.join(projectDir, 'preset-'))
  await writeFiles(dir, {
    'package.json': '{"type":"module"}\n',
    'stylelint.config.mjs': config,
    'src/a.css': 'a {\n  color: red;\n}\n',
  })
  return path.join(dir, 'stylelint.config.mjs')
}

/**
 * A `stylelint.config.mjs` of `defineConfig` with `options`, a string of JavaScript
 */
function presetConfig(options: string) {
  return `import { defineConfig } from '@gpahal/stylelint-config'\n\nexport default defineConfig({ root: import.meta.dirname, ${options} })\n`
}

// Runs Stylelint's CLI in a project whose `node_modules` holds only this package and Stylelint, as
// pnpm lays out a consumer: the package's own dependencies aren't visible from the project. It loads
// the build
describe('a pnpm consumer', () => {
  let project: Awaited<ReturnType<typeof withTmpProject>>
  let projectDir: string

  beforeAll(async () => {
    project = await withTmpProject('stylelint-config-consumer')
    projectDir = project.dir
    const link = path.join(projectDir, 'node_modules/@gpahal/stylelint-config')
    await fs.mkdir(path.dirname(link), { recursive: true })
    await fs.symlink(PACKAGE_DIR, link)
    await linkDependency(path.join(projectDir, 'node_modules'), PACKAGE_DIR, 'stylelint')
  })

  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  it("reports the package's error for a rejected option in an extended config", async () => {
    const preset = await writePreset(projectDir, presetConfig('bogus: 1'))
    const { status, output } = await runStylelint(
      projectDir,
      `export default { extends: [${JSON.stringify(preset)}] }\n`,
      { 'a.css': 'a {}\n' },
    )
    expect(output).toContain('@gpahal/stylelint-config: `bogus`: unknown option')
    expect(output).not.toContain('ERR_REQUIRE_ASYNC_MODULE')
    expect(status).not.toBe(0)
  })

  it('extends the Tailwind CSS entry', async () => {
    const { status, output } = await runStylelint(
      projectDir,
      "export default { extends: ['@gpahal/stylelint-config/tailwindcss'] }\n",
      { 'a.css': '@theme {\n  --color-brand: red;\n}\n\na {\n  color: theme(--color-brand);\n}\n' },
    )
    expect(output).toContain('"warnings":[]')
    expect(status).toBe(0)
  })

  describe('with a shared preset in another folder', () => {
    it.each([
      ['the default export', async () => "'@gpahal/stylelint-config'"],
      [
        'a defineConfig preset',
        async () => JSON.stringify(await writePreset(projectDir, presetConfig(''))),
      ],
    ])('lints each file type with its syntax through %s', async (_name, preset) => {
      const { output } = await runStylelint(
        projectDir,
        `export default { extends: [${await preset()}] }\n`,
        FILE_TYPES,
      )
      expect(rulesByFile(output)).toEqual({
        'a.astro': ['property-no-unknown'],
        'a.html': ['property-no-unknown'],
        'a.md': ['property-no-unknown'],
        'a.css': ['property-no-unknown'],
        'b.css': ['order/properties-order'],
      })
    })

    it('keeps the override globs of a preset relative to its root', async () => {
      const preset = await writePreset(
        projectDir,
        presetConfig("overrides: [{ files: ['src/*.css'], rules: { 'color-named': 'never' } }]"),
      )
      const consumer = await runStylelint(
        projectDir,
        `export default { extends: [${JSON.stringify(preset)}] }\n`,
        { 'src/a.css': 'a {\n  color: red;\n}\n' },
      )
      expect(rulesByFile(consumer.output)).toEqual({ 'a.css': [] })
      const { stdout, stderr } = await runNode(
        [
          path.join(projectDir, 'node_modules/stylelint/bin/stylelint.mjs'),
          'src/a.css',
          '--formatter',
          'json',
        ],
        { cwd: path.dirname(preset) },
      )
      expect(rulesByFile(`${stdout}${stderr}`)).toEqual({ 'a.css': ['color-named'] })
    })
  })
})

/**
 * The rules each file of Stylelint's JSON `output` reports, by file name, or `ignored`
 */
function rulesByFile(output: string): Record<string, Array<string> | 'ignored'> {
  const results = JSON.parse(
    output.slice(output.indexOf('['), output.lastIndexOf(']') + 1),
  ) as Array<{
    source: string
    ignored?: boolean
    warnings: Array<{ rule: string }>
  }>
  return Object.fromEntries(
    results.map(({ source, ignored, warnings }) => [
      path.basename(source),
      ignored === true
        ? 'ignored'
        : warnings.map(({ rule }) => rule).toSorted((a, b) => (a < b ? -1 : Number(a > b))),
    ]),
  )
}

/**
 * A file of each type that Stylelint lints with its own syntax, each with an unknown property, and
 * CSS out of order for the stylelint-order plugin, which the package resolves
 */
const FILE_TYPES = {
  'a.astro': '<style>\n  a {\n    colr: red;\n  }\n</style>\n',
  'a.html': '<style>\n  a {\n    colr: red;\n  }\n</style>\n',
  'a.md': '# A\n\n```css\na {\n  colr: red;\n}\n```\n',
  'a.css': 'a {\n  colr: red;\n}\n',
  'b.css': 'a {\n  color: red;\n  display: block;\n}\n',
}

// As above, but postcss-markdown can't see a hoisted `postcss-html`. It loads `postcss-html` by name
// from the working directory, then from its own location. This repo hoists `postcss-html` where the latter sees
// it, so the project gets copies of this package's build and of postcss-markdown, whose
// `node_modules` hold only their dependencies
describe('a pnpm consumer without hoisting', () => {
  let project: Awaited<ReturnType<typeof withTmpProject>>
  let projectDir: string

  beforeAll(async () => {
    project = await withTmpProject('stylelint-config-no-hoist')
    projectDir = project.dir
    const nodeModulesDir = path.join(projectDir, 'node_modules')
    await linkDependency(nodeModulesDir, PACKAGE_DIR, 'stylelint')

    const packageDir = path.join(nodeModulesDir, '@gpahal/stylelint-config')
    await fs.mkdir(packageDir, { recursive: true })
    await fs.cp(path.join(PACKAGE_DIR, 'package.json'), path.join(packageDir, 'package.json'))
    await fs.cp(BUILD_DIR, path.join(packageDir, 'build'), {
      recursive: true,
    })
    const { dependencies } = JSON.parse(
      await fs.readFile(path.join(PACKAGE_DIR, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    for (const name of Object.keys(dependencies)) {
      if (name !== 'postcss-markdown') {
        await linkDependency(path.join(packageDir, 'node_modules'), PACKAGE_DIR, name)
      }
    }

    // pnpm puts a package in `.pnpm/<package>/node_modules`, next to links to its dependencies, and
    // links it from its dependents' `node_modules`
    const realMarkdownDir = await fs.realpath(
      path.join(PACKAGE_DIR, 'node_modules/postcss-markdown'),
    )
    const storeDir = path.join(projectDir, 'store/postcss-markdown/node_modules')
    const markdownDir = path.join(storeDir, 'postcss-markdown')
    await fs.cp(realMarkdownDir, markdownDir, { recursive: true })
    const realStoreDir = path.dirname(realMarkdownDir)
    const siblings = await fs.readdir(realStoreDir)
    for (const name of siblings) {
      if (name === 'postcss-markdown') {
        continue
      }
      const target = await fs.realpath(path.join(realStoreDir, name))
      await fs.symlink(target, path.join(storeDir, name))
    }
    await fs.symlink(markdownDir, path.join(packageDir, 'node_modules/postcss-markdown'))
  })

  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  const MARKDOWN = '<style>\n  a {\n    colr: red;\n  }\n</style>\n'

  it('lints the HTML <style> blocks of .md files', async () => {
    const { status, output } = await runStylelint(projectDir, DEFINE_CONFIG, { 'a.md': MARKDOWN })
    expect(output).toContain('property-no-unknown')
    expect(status).toBe(2)
  })
})

// pnpm puts this package in the project's `node_modules/.pnpm`, so TypeScript can't name a type of
// Stylelint's that reaches a config file only through this package's declarations
describe('a TypeScript consumer that emits declarations', () => {
  it('names the type of a defineConfig config file', async () => {
    await using project = await withTmpProject('stylelint-config-declarations', {
      'package.json': '{"type":"module"}\n',
      'stylelint.config.mjs':
        "import { defineConfig } from '@gpahal/stylelint-config'\n\nexport default defineConfig({ root: '/project' })\n",
      // As a composite tsconfig of config files does, such as the root README's Astro recipe's
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          strict: true,
          allowJs: true,
          checkJs: true,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: 'out',
          types: [],
        },
        include: ['stylelint.config.mjs'],
      }),
    })
    const storeDir = path.join(project.dir, 'node_modules/.pnpm/stylelint-config/node_modules')
    const packageDir = path.join(storeDir, '@gpahal/stylelint-config')
    await fs.mkdir(packageDir, { recursive: true })
    await fs.cp(path.join(PACKAGE_DIR, 'package.json'), path.join(packageDir, 'package.json'))
    await fs.cp(BUILD_DIR, path.join(packageDir, 'build'), { recursive: true })
    for (const name of ['stylelint', 'postcss', 'zod']) {
      await linkDependency(storeDir, PACKAGE_DIR, name)
    }
    await fs.mkdir(path.join(project.dir, 'node_modules/@gpahal'))
    await fs.symlink(packageDir, path.join(project.dir, 'node_modules/@gpahal/stylelint-config'))
    const { status, stdout, stderr } = await runNode(
      [path.join(PACKAGE_DIR, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
      { cwd: project.dir },
    )
    expect(`${stdout}${stderr}`).toBe('')
    expect(status).toBe(0)
  })
})
