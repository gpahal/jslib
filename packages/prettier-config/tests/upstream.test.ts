// Canaries for the upstream bugs this package works around. Each runs the stock behaviour, without
// the workaround, and fails once the bug is fixed, naming the workaround to remove

import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { format, type Options } from 'prettier'

import { runNode, withTmpProject } from '@gpahal/internal/node/testing'

import { resolveSortImportsPlugin } from '@/internal/plugins'

const require = createRequire(import.meta.url)

const PRETTIER_BIN = path.join(
  path.dirname(require.resolve('prettier/package.json')),
  'bin/prettier.cjs',
)

/**
 * The message of a canary that fails because `issue` is fixed
 */
function fixed(issue: string, file: string): string {
  return `upstream fixed ${issue}: remove the workaround in ${file}`
}

/**
 * The absolute path of a package's entry, as the config gives plugins
 */
function modulePath(id: string): string {
  return fileURLToPath(import.meta.resolve(id))
}

const SORTER_PLUGIN = modulePath('@ianvs/prettier-plugin-sort-imports')
const TAILWIND_PLUGIN = modulePath('prettier-plugin-tailwindcss')
const STYLESHEET = path.join(import.meta.dirname, 'fixtures/tailwind.css')

const UNSORTED_IMPORTS = "import z from 'zod'\nimport path from 'node:path'\n\nexport const a = z\n"

/**
 * The URL of a package's entry, for a config file to import
 */
function moduleUrl(id: string): string {
  return pathToFileURL(require.resolve(id)).href
}

/**
 * Run Prettier's CLI on `file` from `cwd`: its output when it succeeds, and its errors otherwise
 */
async function runPrettier(file: string, cwd: string) {
  const { status, stdout, stderr } = await runNode([PRETTIER_BIN, file], { cwd })
  return status === 0 ? { ok: true, output: stdout } : { ok: false, output: stderr }
}

describe('upstream workarounds', () => {
  // The config names its plugins by absolute path
  it('prettier#17565: plugins named in a config resolve from the working directory', async () => {
    await using project = await withTmpProject('prettier-config-17565', {
      'project/node_modules/prettier-plugin-canary/package.json': JSON.stringify({
        name: 'prettier-plugin-canary',
        type: 'module',
        main: 'index.js',
      }),
      'project/node_modules/prettier-plugin-canary/index.js': 'export const options = {}\n',
      'project/.prettierrc.json': JSON.stringify({ plugins: ['prettier-plugin-canary'] }),
      'project/a.ts': 'const a = 1\n',
    })
    const projectDir = path.join(project.dir, 'project')
    const cwd = path.join(project.dir, 'cwd')
    await fs.mkdir(cwd)
    const file = path.join(projectDir, 'a.ts')

    // The project's own working directory finds the plugin
    expect(await runPrettier(file, projectDir)).toEqual({ ok: true, output: 'const a = 1;\n' })
    const result = await runPrettier(file, cwd)
    expect(result.ok, fixed('prettier#17565', 'src/internal/plugins.ts')).toBe(false)
    expect(result.output).toContain("Cannot find package 'prettier-plugin-canary'")
  }, 30_000)

  // The GitHub alerts plugin keeps the line break
  it("prettier#15479: Markdown joins a GitHub alert's marker to the next line", async () => {
    const formatted = await format('> [!NOTE]\n> Some text.\n', {
      parser: 'markdown',
      proseWrap: 'never',
    })
    expect(formatted, fixed('prettier#15479', 'src/internal/github-alerts.ts')).toBe(
      '> [!NOTE] Some text.\n',
    )
  })

  // The `*.mdx` override sets `requirePragma`, so MDX files are left as they are
  it('prettier#12209: the MDX parser reads MDX 1, and formats an MDX 2 or 3 expression as Markdown', async () => {
    const formatted = await format('Total: {a * b * c}\n', { parser: 'mdx' })
    expect(
      formatted,
      fixed('prettier#12209', 'the `*.mdx` requirePragma override in src/index.ts'),
    ).toBe('Total: {a _ b _ c}\n')
  })

  // The config passes the plugins as paths, not as their imported modules
  it('IanVS/prettier-plugin-sort-imports#233: the sorter and the Tailwind plugin fail to load as modules', async () => {
    await using project = await withTmpProject('prettier-config-233', {
      'prettier.config.mjs': `import * as sorter from ${JSON.stringify(moduleUrl('@ianvs/prettier-plugin-sort-imports'))}
import * as tailwind from ${JSON.stringify(moduleUrl('prettier-plugin-tailwindcss'))}

export default {
  plugins: [sorter, tailwind],
  tailwindStylesheet: ${JSON.stringify(path.join(import.meta.dirname, 'fixtures/tailwind.css'))},
}
`,
      'a.ts': "import z from 'zod'\nimport path from 'node:path'\n",
    })

    const result = await runPrettier(path.join(project.dir, 'a.ts'), project.dir)
    expect(
      result.ok,
      fixed('IanVS/prettier-plugin-sort-imports#233', 'src/internal/plugins.ts'),
    ).toBe(false)
    expect(result.output).toMatch(/could not be loaded\. {2}Is it installed\?/)
  }, 30_000)

  // The `.mts` and `.cts` override parses them without `jsx`
  it('IanVS/prettier-plugin-sort-imports: the sorter drops `jsx` only in .ts files, not .mts and .cts', async () => {
    // The sorter logs the parse error it aborts on
    using _error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const source =
      "import z from 'zod'\nimport path from 'node:path'\n\nexport const a = <string>z\n"
    const options: Options = {
      plugins: [SORTER_PLUGIN],
      importOrderParserPlugins: ['typescript', 'jsx'],
      semi: false,
      singleQuote: true,
    }
    expect(await format(source, { ...options, filepath: 'a.ts' })).toMatch(/^import path/)
    for (const filepath of ['a.mts', 'a.cts']) {
      expect(
        await format(source, { ...options, filepath }),
        fixed('the sorter parsing .mts and .cts files with jsx', 'src/index.ts'),
      ).toBe(source)
    }
  })

  // The README sends class sorting in `.astro` files to `@gpahal/eslint-config`
  it("prettier-plugin-tailwindcss: classes in .astro files aren't sorted with prettier-plugin-astro 1.x", async () => {
    const source = '<div class="p-4 flex"></div>\n'
    const formatted = await format(source, {
      filepath: 'a.astro',
      plugins: [modulePath('prettier-plugin-astro'), TAILWIND_PLUGIN],
      tailwindStylesheet: STYLESHEET,
    })
    expect(formatted, fixed('class sorting in .astro files', 'README.md')).toBe(source)
  })

  // `resolveSortImportsPlugin` gives the sorter at the path the Tailwind plugin resolves it to
  it('prettier-plugin-tailwindcss: it uses the sorter only at the path it resolves itself', async () => {
    const options = {
      filepath: 'a.ts',
      semi: false,
      singleQuote: true,
      tailwindStylesheet: STYLESHEET,
    }
    const tailwindSorter = resolveSortImportsPlugin(TAILWIND_PLUGIN).path
    expect(
      await format(UNSORTED_IMPORTS, { ...options, plugins: [tailwindSorter, TAILWIND_PLUGIN] }),
    ).toMatch(/^import path/)

    // The same sorter at another path, through a symlink to its package folder
    await using project = await withTmpProject('prettier-config-sorter')
    const packageName = '@ianvs/prettier-plugin-sort-imports'
    const packageDir = path.join(
      tailwindSorter.slice(0, tailwindSorter.lastIndexOf(`node_modules${path.sep}@ianvs`)),
      'node_modules',
      packageName,
    )
    const linkDir = path.join(project.dir, 'node_modules', packageName)
    await fs.mkdir(path.dirname(linkDir), { recursive: true })
    await fs.symlink(packageDir, linkDir)
    const linkedSorter = path.join(linkDir, path.relative(packageDir, tailwindSorter))
    expect(
      await format(UNSORTED_IMPORTS, { ...options, plugins: [linkedSorter, TAILWIND_PLUGIN] }),
      fixed('the Tailwind plugin finding the sorter by exact path', 'src/internal/plugins.ts'),
    ).toBe(UNSORTED_IMPORTS)
  })

  // The wrapper's parsers keep an import under a directive in place, as `// prettier-ignore` does
  it('IanVS/prettier-plugin-sort-imports: a directive above the first import stays at the top when its import moves', async () => {
    const source =
      "// @ts-expect-error -- no types\nimport untyped from 'untyped'\nimport path from 'node:path'\n\nexport const v = [untyped, path]\n"
    expect(
      await format(source, {
        filepath: 'a.ts',
        plugins: [SORTER_PLUGIN],
        semi: false,
        singleQuote: true,
      }),
      fixed(
        'the sorter leaving directives above the first import at the top',
        "src/internal/sort-imports.ts, its `pinDirectiveImports`, and README.md's line on directives",
      ),
    ).toBe(
      "// @ts-expect-error -- no types\nimport path from 'node:path'\nimport untyped from 'untyped'\n\nexport const v = [untyped, path]\n",
    )
  })

  // prettier-plugin-merge reads every parser of each plugin, and the sorter's `ember-template-tag`
  // parser is a getter that throws without prettier-plugin-ember-template-tag. The wrapper leaves
  // out such parsers, but the Tailwind plugin loads the sorter itself, so `defineConfig` rejects
  // prettier-plugin-merge with `tailwindcss` while sorting is on
  it('prettier-plugin-merge: it fails with the import sorter', async () => {
    const formatting = format(UNSORTED_IMPORTS, {
      filepath: 'a.ts',
      plugins: [SORTER_PLUGIN, require.resolve('prettier-plugin-merge')],
    })
    await expect(
      formatting,
      fixed(
        'prettier-plugin-merge failing with the import sorter',
        'src/internal/sort-imports.ts, the prettier-plugin-merge check in src/internal/merge.ts, and README.md',
      ),
    ).rejects.toThrow('prettier-plugin-ember-template-tag could not be loaded')
  })

  // prettier-plugin-merge passes `originalText` to each plugin's format, which
  // prettier-plugin-organize-imports reads as a range and skips, so `defineConfig` rejects
  // prettier-plugin-organize-imports before prettier-plugin-merge
  it("prettier-plugin-merge: it doesn't run prettier-plugin-organize-imports", async () => {
    const source = "import { unused } from 'zod'\n\nexport const a = 1\n"
    const organizeImports = require.resolve('prettier-plugin-organize-imports')
    const options = { filepath: 'a.ts', semi: false, singleQuote: true }
    expect(await format(source, { ...options, plugins: [organizeImports] })).toBe(
      'export const a = 1\n',
    )
    expect(
      await format(source, {
        ...options,
        plugins: [organizeImports, require.resolve('prettier-plugin-merge')],
      }),
      fixed(
        'prettier-plugin-merge not running prettier-plugin-organize-imports',
        'the prettier-plugin-organize-imports check in src/internal/merge.ts, and README.md',
      ),
    ).toBe(source)
  })
})

// Canaries for the upstream bugs that README.md's Known issues lists, which fail once a bug is fixed
describe('upstream known issues', () => {
  it('prettier-plugin-packagejson: it drops a `"__proto__"` key and the first of two duplicate keys', async () => {
    const options = {
      filepath: 'package.json',
      plugins: [modulePath('prettier-plugin-packagejson')],
    }
    const message = fixed(
      'prettier-plugin-packagejson dropping keys',
      "README.md's Known issues: its line on package.json keys",
    )
    expect(
      await format('{"name":"a","__proto__":{"b":1},"version":"1.0.0"}', options),
      message,
    ).toBe('{\n  "name": "a",\n  "version": "1.0.0"\n}\n')
    expect(await format('{"name":"a","scripts":{"b":"1","b":"2"}}', options), message).toBe(
      '{\n  "name": "a",\n  "scripts": {\n    "b": "2"\n  }\n}\n',
    )
  })
})
