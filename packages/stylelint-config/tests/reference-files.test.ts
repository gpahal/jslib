import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { resolve } from 'import-meta-resolve'
import postcss from 'postcss'
import stylelint, { type Config } from 'stylelint'
import { compile } from 'tailwindcss'

import { countWork, withTmpProject, writeFiles } from '@gpahal/internal/node/testing'
import { isRecord } from '@gpahal/std/objects'

import { defineConfig } from '@/index'
import { isReset, KEPT_NAMESPACES } from '@/internal/tailwind-theme-function'

/**
 * The `globby` that Stylelint globs `referenceFiles` with, which the package doesn't depend on
 */
type Globby = (
  patterns: ReadonlyArray<string>,
  options: { absolute: boolean },
) => Promise<Array<string>>

function isGlobbyModule(value: unknown): value is { globby: Globby } {
  return isRecord(value) && typeof value['globby'] === 'function'
}

const globbyModule: unknown = await import(resolve('globby', import.meta.resolve('stylelint')))
if (!isGlobbyModule(globbyModule)) {
  throw new TypeError("Stylelint's globby has no `globby` export")
}
const { globby } = globbyModule

const THEME = /[/\\]tailwindcss[/\\]theme\.css$/

// `referenceFiles` and the rules it turns on are experimental in Stylelint 17.15, so these pin what
// they report

/**
 * A file that uses a custom property and a custom media query it doesn't define, one the
 * reference file defines, and one of Tailwind's theme variables
 */
const CSS = [
  'a {',
  '  color: var(--color-brnd);',
  '  background: var(--color-brand);',
  '  border-color: var(--color-red-500);',
  '}',
  '',
  '@media (--small) {',
  '  a {',
  '    color: red;',
  '  }',
  '}',
  '',
  '@media (--smal) {',
  '  a {',
  '    color: red;',
  '  }',
  '}',
  '',
].join('\n')

/**
 * The reports of the reference rules on `code`, linted with `config` as if it were in `dir`, or
 * in `codeFilename`
 */
async function lintReferences(code: string, config: Config, dir: string, codeFilename?: string) {
  const { results } = await stylelint.lint({
    code,
    config,
    configBasedir: dir,
    ...(codeFilename !== undefined && { codeFilename }),
  })
  return results.flatMap((result) =>
    result.warnings
      .filter((warning) => warning.rule.startsWith('no-unknown-custom-'))
      .map((warning) => `${warning.line}:${warning.rule}`),
  )
}

/**
 * The globs of `referenceFiles`, without the entries' loaders, such as the one that adds Tailwind's
 * `--tw-*` properties to its theme
 */
function referenceGlobs(referenceFiles: Config['referenceFiles']): Array<string> {
  return [referenceFiles ?? []]
    .flat()
    .flatMap((entry) => (typeof entry === 'string' ? entry : [entry.files].flat()))
}

/**
 * Links the package's Tailwind CSS into `dir`'s `node_modules`
 */
async function linkTailwind(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true })
  await fs.symlink(
    await fs.realpath(path.join(import.meta.dirname, '../node_modules/tailwindcss')),
    path.join(dir, 'node_modules/tailwindcss'),
  )
}

describe('referenceFiles', () => {
  let project: Awaited<ReturnType<typeof withTmpProject>>
  let dir: string
  beforeAll(async () => {
    project = await withTmpProject('stylelint-config-reference', {
      'tokens.css': ':root {\n  --color-brand: red;\n}\n\n@custom-media --small (width < 40rem);\n',
    })
    dir = project.dir
    await linkTailwind(dir)
  })
  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  it("reports what neither the file nor the reference files define, with Tailwind's theme", async () => {
    const config = await defineConfig({
      root: dir,
      tailwindcss: true,
      referenceFiles: 'tokens.css',
    })
    expect(config.referenceFiles).toEqual([`${dir}/tokens.css`, expect.stringMatching(THEME)])
    expect(await lintReferences(CSS, config, dir)).toEqual([
      '13:no-unknown-custom-media',
      '2:no-unknown-custom-properties',
    ])
  })

  it('leaves the rules off without reference files', async () => {
    for (const config of [
      await defineConfig({ root: dir, tailwindcss: true }),
      await defineConfig({ root: dir, referenceFiles: [] }),
    ]) {
      expect(config).not.toHaveProperty('referenceFiles')
      expect(config.rules).not.toHaveProperty('no-unknown-custom-properties')
      expect(await lintReferences(CSS, config, dir)).toEqual([])
    }
  })

  it("gives an override's referenceFiles Tailwind's theme without top-level reference files", async () => {
    const appDir = path.join(dir, 'override-only')
    await writeFiles(appDir, {
      'package.json': '{}',
      'src/admin/tokens.css': ':root {\n  --admin: red;\n}\n',
    })
    await linkTailwind(appDir)
    const config = await defineConfig({
      root: appDir,
      tailwindcss: true,
      overrides: [{ files: ['src/admin/**/*.css'], referenceFiles: ['src/admin/tokens.css'] }],
    })
    expect(config.referenceFiles).toBeUndefined()
    expect(config.rules!['no-unknown-custom-properties']).toBeUndefined()
    expect(config.overrides!.at(-1)!.referenceFiles).toEqual([
      expect.stringMatching(THEME),
      `${appDir}/src/admin/tokens.css`,
    ])
    expect(
      await lintReferences(
        'a {\n  color: var(--color-red-500);\n  background: var(--admin);\n  border-color: var(--nope);\n}\n',
        config,
        appDir,
        path.join(appDir, 'src/admin/a.css'),
      ),
    ).toEqual(['4:no-unknown-custom-properties'])
  })

  it("reports unknown animations, knowing the reference files' keyframes and Tailwind's", async () => {
    const appDir = path.join(dir, 'animations')
    await writeFiles(appDir, {
      'global.css': "@import 'tailwindcss';\n",
      'motion.css': '@keyframes fade {\n  to {\n    opacity: 0;\n  }\n}\n',
    })
    await linkTailwind(appDir)
    const code =
      'a {\n  animation: spin 1s linear infinite;\n  animation-name: fade;\n}\n\nb {\n  animation: nope 1s;\n}\n'
    const unknownAnimations = async (config: Config) => {
      const { results } = await stylelint.lint({ code, config, configBasedir: appDir })
      return results.flatMap((result) =>
        result.warnings
          .filter((warning) => warning.rule === 'no-unknown-animations')
          .map((warning) => warning.line),
      )
    }
    expect(
      await unknownAnimations(
        await defineConfig({
          root: appDir,
          tailwindcss: { entryPoint: 'global.css' },
          referenceFiles: 'motion.css',
        }),
      ),
    ).toEqual([7])
    // Without Tailwind's theme, `spin` is unknown too
    expect(
      await unknownAnimations(await defineConfig({ root: appDir, referenceFiles: 'motion.css' })),
    ).toEqual([2, 7])
    // Off without reference files, when a file's animations can come from any stylesheet
    expect(await unknownAnimations(await defineConfig({ root: appDir }))).toEqual([])
  })

  it('turns the reference files and their rules on with tailwindcss.entryPoint alone, as a path or URL', async () => {
    const appDir = path.join(dir, 'entry-only')
    await linkTailwind(appDir)
    const entryPoint = path.join(appDir, 'global.css')
    await fs.writeFile(entryPoint, "@import 'tailwindcss';\n")
    const url = pathToFileURL(entryPoint)
    for (const option of [
      entryPoint,
      path.relative(dir, entryPoint),
      url,
      url.href.replace(/^file:/, 'FILE:'),
      url.href.replace(/^file:\/\//, 'File:'),
    ]) {
      const config = await defineConfig({ root: dir, tailwindcss: { entryPoint: option } })
      expect(referenceGlobs(config.referenceFiles)).toEqual([
        entryPoint,
        expect.stringMatching(THEME),
      ])
      const code = 'a {\n  color: var(--nope);\n  background: var(--color-red-500);\n}\n'
      expect(await lintReferences(code, config, dir)).toEqual(['2:no-unknown-custom-properties'])
    }
  })

  it.each(['!(a)', '(a', '[a', '{a,b}', '*'])(
    'gives a glob that matches only the entry point in a %s folder, as Stylelint globs it',
    async (folder) => {
      const entryPoint = path.join(dir, 'glob-folders', folder, 'global.css')
      await writeFiles(path.dirname(entryPoint), { 'global.css': '' })
      const [glob] = referenceGlobs(
        (await defineConfig({ root: dir, tailwindcss: { entryPoint } })).referenceFiles,
      )
      expect(await globby([glob!], { absolute: true })).toEqual([entryPoint])
    },
  )

  it.each([
    // A URL parser reads it as `/p(x)/global.css`
    'file:p(x)/global.css',
    new URL('https://example.com/global.css'),
  ])('throws when tailwindcss.entryPoint is %j', async (entryPoint) => {
    await expect(defineConfig({ root: dir, tailwindcss: { entryPoint } })).rejects.toThrow(
      new TypeError(
        `@gpahal/stylelint-config: \`tailwindcss.entryPoint\`: expected an absolute path or one relative to \`root\`, or a \`file:\` URL or URL string with an absolute path, such as \`import.meta.resolve('./src/styles/global.css')\`, received \`${String(entryPoint)}\``,
      ),
    )
  })

  it("throws when tailwindcss.entryPoint isn't a file, naming the resolved path", async () => {
    for (const [entryPoint, resolved] of [
      ['src/missing.css', path.join(dir, 'src/missing.css')],
      [dir, dir],
    ] as const) {
      await expect(defineConfig({ root: dir, tailwindcss: { entryPoint } })).rejects.toThrow(
        new TypeError(
          `@gpahal/stylelint-config: \`tailwindcss.entryPoint\`: \`${resolved}\` isn't a file`,
        ),
      )
    }
  })

  describe("the entry point's imports", () => {
    let importsDir: string
    beforeAll(async () => {
      importsDir = path.join(dir, 'imports')
      await linkTailwind(importsDir)
    })

    /**
     * The reference files of the entry point `files[entry]`, after writing `files` to a new folder
     * of `importsDir`, with their paths relative to that folder, and Tailwind's theme as `theme`
     */
    async function referencesOf(
      name: string,
      files: Readonly<Record<string, string>>,
      entry = 'global.css',
    ): Promise<Array<string>> {
      const caseDir = path.join(importsDir, name)
      await writeFiles(caseDir, files)
      const config = await defineConfig({
        root: dir,
        tailwindcss: { entryPoint: path.join(caseDir, entry) },
      })
      return referenceGlobs(config.referenceFiles).map((file) =>
        THEME.test(file) ? 'theme' : path.relative(caseDir, file),
      )
    }

    /**
     * The reference rule reports on `code` with the entry point `global.css` of `files`
     */
    async function lintWithEntry(
      name: string,
      files: Readonly<Record<string, string>>,
      code: string,
    ): Promise<Array<string>> {
      const caseDir = path.join(importsDir, name)
      await writeFiles(caseDir, files)
      const config = await defineConfig({
        root: dir,
        tailwindcss: { entryPoint: path.join(caseDir, 'global.css') },
      })
      return lintReferences(code, config, dir)
    }

    it('follows relative @import and @reference targets, nested, in string or url() form', async () => {
      expect(
        await referencesOf('nested', {
          'global.css': [
            "@import 'tailwindcss';",
            "@import './tokens.css' layer(theme);",
            "@import url('./a.css');",
            '@import url( "../nested/b.css" ) supports(display: grid);',
            '@import url(c.css);',
            '@reference "./sub/d.css";',
            '/* @import "./commented.css"; */',
          ].join('\n'),
          'tokens.css': '@import "./sub/tokens-2.css";\n:root {\n  --color-brand: red;\n}\n',
          'sub/tokens-2.css': '@import "../e.css" screen;\n',
          'a.css': '',
          'b.css': '',
          'c.css': '',
          'sub/d.css': '',
          'e.css': '',
        }),
      ).toEqual([
        'global.css',
        'tokens.css',
        'sub/tokens-2.css',
        'e.css',
        'a.css',
        'b.css',
        'c.css',
        'sub/d.css',
        'theme',
      ])
    })

    it('reads only real @import and @reference rules, as a CSS tokenizer reads them', async () => {
      expect(
        await referencesOf('tokens', {
          'global.css': [
            // Import-like text in a string, and a string with `/*`, which isn't a comment
            'a::before { content: \'@import "./missing.css"\'; }',
            'b::before { content: "/*"; }',
            '@import"./a.css";',
            String.raw`@import './\62 .css';`,
            String.raw`@import url(./\63 .css);`,
            '@IMPORT "./d.css";',
            'c::before { content: "*/"; }',
            '/* @import "./commented.css"; */',
          ].join('\n'),
          'a.css': '',
          'b.css': '',
          'c.css': '',
          'd.css': '',
        }),
      ).toEqual(['global.css', 'a.css', 'b.css', 'c.css', 'd.css', 'theme'])
    })

    it('resolves an import as Tailwind does: the file, else with `.css`, else its `index.css`', async () => {
      expect(
        await referencesOf('extensions', {
          'global.css': [
            "@import './tokens';",
            "@import './components';",
            "@import 'utils';",
            "@import './both';",
          ].join('\n'),
          'tokens.css': '',
          'components/index.css': "@import './button';\n",
          'components/button.css': '',
          'utils.css': '',
          'both.css': '',
          'both/index.css': '',
        }),
      ).toEqual([
        'global.css',
        'tokens.css',
        path.join('components', 'index.css'),
        path.join('components', 'button.css'),
        'utils.css',
        'both.css',
        'theme',
      ])
    })

    it('makes what the imports and an imported package define known', async () => {
      expect(
        await lintWithEntry(
          'lint',
          {
            'global.css':
              "@import 'tailwindcss';\n@import './tokens.css';\n@import 'tw-animate-css';\n",
            'tokens.css': '@theme {\n  --color-brnd: red;\n}\n',
            'node_modules/tw-animate-css/package.json': JSON.stringify({
              exports: { '.': { style: './dist/tw-animate.css' } },
            }),
            'node_modules/tw-animate-css/dist/tw-animate.css':
              '@theme {\n  --animate-in: enter;\n}\n',
          },
          'a {\n  color: var(--color-brnd);\n  animation: var(--animate-in);\n  background: var(--nope);\n}\n',
        ),
      ).toEqual(['4:no-unknown-custom-properties'])
    })

    it("doesn't follow missing packages, Tailwind's own stylesheets or http(s) imports", async () => {
      expect(
        await referencesOf('packages', {
          'global.css': [
            "@import 'tailwindcss';",
            "@import 'tailwindcss/utilities.css';",
            "@import 'not-installed';",
            '@import "@scope/ui/theme.css";',
            "@import url('https://example.com/a.css');",
            '@import "HTTP://example.com/b.css";',
            "@import '//example.com/c.css';",
          ].join('\n'),
        }),
      ).toEqual(['global.css', 'theme'])
    })

    it.each([
      [
        'a namespace',
        'namespace',
        "@import 'tailwindcss';\n@import './tokens.css';\n",
        ['3:no-unknown-custom-properties'],
      ],
      [
        'a namespace, but not before the import of the theme,',
        'before-theme',
        "@import './tokens.css';\n@import 'tailwindcss';\n",
        [],
      ],
    ])(
      "leaves the default theme's variables of %s that the entry graph resets out",
      async (_case, name, entry, reported) => {
        expect(
          await lintWithEntry(
            `reset-${name}`,
            {
              'global.css': entry,
              'tokens.css': '@theme {\n  --color-*: initial;\n  --color-brand: red;\n}\n',
            },
            'a {\n  color: var(--color-brand);\n  background: var(--color-red-500);\n  margin: var(--spacing);\n}\n',
          ),
        ).toEqual(reported)
      },
    )

    it("leaves the default theme's variables of a namespace reset after a nested block out", async () => {
      expect(
        await lintWithEntry(
          'reset-after-block',
          {
            'global.css': "@import 'tailwindcss';\n@import './tokens.css';\n",
            'tokens.css':
              '@theme {\n  @keyframes wiggle {\n    0% {\n      rotate: 0;\n    }\n  }\n  --animate-*: initial;\n  --animate-wiggle: wiggle 1s;\n}\n',
          },
          'a {\n  animation: var(--animate-wiggle);\n  transition: var(--animate-spin);\n}\n',
        ),
      ).toEqual(['3:no-unknown-custom-properties'])
    })

    it.each([
      ['the tailwindcss import', 'import', "@import 'tailwindcss' prefix(tw);"],
      ['a @theme block', 'theme', "@import 'tailwindcss';\n@theme prefix(tw) {}"],
    ])(
      'prefixes the theme variables with the prefix() of %s, as Tailwind does',
      async (_case, name, prefixed) => {
        expect(
          await lintWithEntry(
            `prefix-${name}`,
            {
              'global.css': `${prefixed}\n@import './tokens.css';\n\n:root {\n  --plain: red;\n}\n`,
              'tokens.css': '@theme {\n  --color-brand: red;\n}\n',
            },
            'a {\n  color: var(--tw-color-red-500);\n  background: var(--color-red-500);\n  border-color: var(--tw-color-brand);\n  outline-color: var(--color-brand);\n  caret-color: var(--plain);\n  fill: var(--tw-plain);\n}\n',
          ),
        ).toEqual([
          '3:no-unknown-custom-properties',
          '5:no-unknown-custom-properties',
          '7:no-unknown-custom-properties',
        ])
      },
    )

    it('reads an entry point in time linear in its length', async () => {
      const caseDir = path.join(importsDir, 'linear')
      const workOf = async (count: number): Promise<number> => {
        const entryPoint = path.join(caseDir, `${count}.css`)
        await writeFiles(caseDir, { [`${count}.css`]: '@theme inline '.repeat(count) })
        return countWork(async () => defineConfig({ root: dir, tailwindcss: { entryPoint } }))
      }
      const small = await workOf(10_000)
      const large = await workOf(40_000)
      // 4 times the length takes 4 times the work in linear code, and 16 times in quadratic code
      expect(large).toBeLessThan(small * 8)
    })

    it("resolves a symlinked file's imports from its real path", async () => {
      const caseDir = path.join(importsDir, 'symlinked')
      await writeFiles(caseDir, {
        'src/global.css': "@import './link.css';\n",
        'shared/real.css': "@import './other.css';\n",
        'shared/other.css': '',
      })
      await fs.symlink('../shared/real.css', path.join(caseDir, 'src/link.css'))
      expect(await referencesOf('symlinked', {}, 'src/global.css')).toEqual([
        'src/global.css',
        'src/link.css',
        'shared/other.css',
        'theme',
      ])
    })

    it('reads each file once, through a cycle and repeated imports', async () => {
      expect(
        await referencesOf('cycle', {
          'global.css': "@import './a.css';\n@import './b.css';\n",
          'a.css': "@import './b.css';\n",
          'b.css': "@import './a.css';\n@import './global.css';\n",
        }),
      ).toEqual(['global.css', 'a.css', 'b.css', 'theme'])
      // Each file imports the next twice, so walking every import again would take 2^31 walks
      const files = Object.fromEntries(
        Array.from({ length: 32 }, (_, index) => [
          `${index}.css`,
          index === 31 ? '@theme {}\n' : `@import './${index + 1}.css';\n`.repeat(2),
        ]),
      )
      expect(await referencesOf('diamonds', files, '0.css')).toHaveLength(33)
    })

    it("throws on an import that doesn't exist, naming the importing file", async () => {
      const caseDir = path.join(importsDir, 'missing')
      await writeFiles(caseDir, {
        'global.css': "@import './tokens.css';\n",
        'tokens.css': "@import './gone.css';\n",
      })
      await expect(
        defineConfig({ root: dir, tailwindcss: { entryPoint: path.join(caseDir, 'global.css') } }),
      ).rejects.toThrow(
        new TypeError(
          `@gpahal/stylelint-config: \`tailwindcss.entryPoint\`: \`${path.join(caseDir, 'tokens.css')}\`: its import \`${path.join(caseDir, 'gone.css')}\` doesn't exist`,
        ),
      )
    })

    it("follows only imports that resolve to a `.css` file, so a package's CSS can't read a dotfile", async () => {
      expect(
        await referencesOf(
          'non-css',
          {
            'src/global.css': [
              "@import 'evil-css';",
              "@import './data.txt';",
              "@import './data';",
              "@import './tokens';",
            ].join('\n'),
            'src/data.txt': 'SECRET=1',
            'src/data': 'SECRET=1',
            'src/tokens.css': "@import './more.CSS';\n",
            'src/more.CSS': '',
            '.env': 'API_KEY=sk_live_secret',
            'node_modules/evil-css/package.json': JSON.stringify({ style: 'i.css' }),
            'node_modules/evil-css/i.css': "@import '../../.env';\n",
          },
          path.join('src', 'global.css'),
        ),
      ).toEqual([
        path.join('src', 'global.css'),
        path.join('node_modules', 'evil-css', 'i.css'),
        path.join('src', 'tokens.css'),
        path.join('src', 'more.CSS'),
        'theme',
      ])
    })

    it("doesn't follow a `.css` symlink to a file that isn't CSS", async () => {
      const caseDir = path.join(importsDir, 'css-link')
      await writeFiles(caseDir, {
        'global.css': "@import './env.css';\n@import './tokens.css';\n",
        '.env': 'API_KEY=sk_live_secret',
        'real.css': '',
      })
      await fs.symlink('.env', path.join(caseDir, 'env.css'))
      await fs.symlink('real.css', path.join(caseDir, 'tokens.css'))
      expect(await referencesOf('css-link', {})).toEqual(['global.css', 'tokens.css', 'theme'])
    })

    it("throws on an import that doesn't parse, naming it and its importer without its content", async () => {
      const caseDir = path.join(importsDir, 'parse-error')
      await writeFiles(caseDir, {
        'global.css': "@import './tokens.css';\n",
        'tokens.css': "@import './broken.css';\n",
        'broken.css': ':root {\n  --a: red;\n}\n\nAPI_KEY=sk_live_secret\n',
      })
      const broken = path.join(caseDir, 'broken.css')
      const error: unknown = await defineConfig({
        root: dir,
        tailwindcss: { entryPoint: path.join(caseDir, 'global.css') },
      }).catch((error: unknown) => error)
      expect(error).toEqual(
        new TypeError(
          `@gpahal/stylelint-config: \`tailwindcss.entryPoint\`: \`${path.join(caseDir, 'tokens.css')}\`: parsing its import \`${broken}\` failed at line 5, column 1: unknown word`,
        ),
      )
      const { cause } = error as Error
      expect(cause).toBeInstanceOf(postcss.CssSyntaxError)
      const syntaxError = cause as postcss.CssSyntaxError
      expect(syntaxError.showSourceCode()).toBe('')
      expect(JSON.stringify(syntaxError)).not.toContain('sk_live')
    })
  })

  // Each `<style>` block and `style` attribute is a root of its own, which the rules check alone.
  // The README's "Reference files" states this limitation
  it('reports a custom property set in another <style> block as unknown', async () => {
    const config = await defineConfig({ root: dir, referenceFiles: ['tokens.css'] })
    const { results } = await stylelint.lint({
      code: '<style>\n  :root {\n    --progress: 50%;\n  }\n</style>\n<style>\n  a {\n    width: var(--progress);\n  }\n</style>\n',
      codeFilename: path.join(dir, 'a.html'),
      config,
      configBasedir: dir,
    })
    expect(results.flatMap((result) => result.warnings.map((warning) => warning.rule))).toEqual([
      'no-unknown-custom-properties',
    ])
  })

  it.each([
    [{ referenceFiles: 'missing/*.css' }, '`referenceFiles`: `missing/*.css`'],
    // Stylelint's globby skips dotfiles, as `fs.promises.glob` does
    [{ referenceFiles: 'hidden/*.css' }, '`referenceFiles`: `hidden/*.css`'],
  ])('rejects a glob that matches no file, in %j', async (options, message) => {
    await writeFiles(dir, { 'hidden/.a.css': '' })
    await expect(defineConfig({ root: dir, ...options })).rejects.toThrow(
      new TypeError(
        `@gpahal/stylelint-config: ${message} matches no file. Create a file it matches, or remove the entry`,
      ),
    )
  })

  it.each([
    [
      { overrides: [{ files: ['*.css'], referenceFiles: 'missing.css' }] },
      '`overrides[0].referenceFiles`: `missing.css`',
    ],
  ])("rejects a path that isn't a glob and doesn't exist, in %j", async (options, message) => {
    await expect(defineConfig({ root: dir, ...options })).rejects.toThrow(
      new TypeError(
        `@gpahal/stylelint-config: ${message} doesn't exist. Create the file, or remove the entry`,
      ),
    )
  })

  // Stylelint fails only on an entry that matches no file
  it('rejects an entry none of whose paths exists, and takes one with a path that does', async () => {
    await expect(
      defineConfig({ root: dir, referenceFiles: [{ files: ['missing.css', 'gone.css'] }] }),
    ).rejects.toThrow(
      new TypeError(
        '@gpahal/stylelint-config: `referenceFiles[0].files`: none of `missing.css`, `gone.css` exists. Create one of the files, or remove the entry',
      ),
    )
    await expect(
      defineConfig({ root: dir, referenceFiles: [{ files: ['missing/*.css', 'tokens.css'] }] }),
    ).resolves.toBeDefined()
    await expect(
      defineConfig({ root: dir, referenceFiles: [{ files: ['tok*.css', '!tokens.css'] }] }),
    ).rejects.toThrow(
      new TypeError(
        '@gpahal/stylelint-config: `referenceFiles[0].files`: none of `tok*.css`, `!tokens.css` matches a file. Create a file one of them matches, or remove the entry',
      ),
    )
  })
})

describe('Tailwind theme namespace resets', () => {
  /**
   * The theme variables that Tailwind emits from `css`, a stylesheet without imports
   */
  async function emittedVariables(css: string): Promise<Array<string>> {
    const compiler = await compile(css, {
      base: import.meta.dirname,
      loadStylesheet: async () => {
        throw new Error('no imports')
      },
    })
    const emitted: Array<string> = []
    postcss.parse(compiler.build([])).walkDecls((declaration) => {
      emitted.push(declaration.prop)
    })
    return emitted
  }

  it("remove the variables that the installed Tailwind's resets remove", async () => {
    const theme = await fs.readFile(
      new URL(resolve('tailwindcss/theme.css', import.meta.url)),
      'utf8',
    )
    const names = new Set<string>()
    postcss.parse(theme).walkDecls(/^--/, ({ prop }) => {
      names.add(prop)
    })
    for (const [namespace, kept] of Object.entries(KEPT_NAMESPACES)) {
      for (const name of [namespace, ...kept]) {
        names.add(`${name}-x`)
      }
    }
    // Each namespace that a name's leading segments give, such as `--font` and `--font-weight`
    const namespaces = new Set(['--'])
    for (const name of names) {
      const segments = name.slice(2).split('-')
      for (let length = 1; length < segments.length; length += 1) {
        const namespace = `--${segments.slice(0, length).join('-')}`
        if (!namespace.endsWith('-')) {
          namespaces.add(namespace)
        }
      }
    }
    const declarations = Array.from(names, (name) => `  ${name}: 0;`).join('\n')
    for (const namespace of namespaces) {
      const reset = namespace === '--' ? '--*' : `${namespace}-*`
      const emitted = await emittedVariables(
        `@theme static {\n${declarations}\n}\n@theme {\n  ${reset}: initial;\n}\n`,
      )
      expect(emitted, reset).toEqual([...names].filter((name) => !isReset(name, [namespace])))
    }
  })
})
