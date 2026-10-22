import fs from 'node:fs/promises'
import path from 'node:path'

import stylelint, { type Config } from 'stylelint'
import { compile } from 'tailwindcss'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'
import { LEGACY_NAMESPACES } from '@/internal/tailwind-theme-function'

import { topLevelRules } from './helpers'

const TAILWIND_DIR = await fs.realpath(
  path.join(import.meta.dirname, '../node_modules/tailwindcss'),
)

const ENTRY =
  "@import 'tailwindcss';\n\n@theme {\n  --color-brand: red;\n}\n\n:root {\n  --brand: red;\n}\n"

const PREFIXED_ENTRY = "@import 'tailwindcss' prefix(tw);\n\n@theme {\n  --color-brand: red;\n}\n"

/**
 * An entry whose `a.css` resets the colors before `b.css` defines one
 */
const IMPORTS_ENTRY = "@import 'tailwindcss';\n@import './a.css';\n@import './b.css';\n"
const IMPORTED_RESET =
  '@theme {\n  --color-*: initial;\n}\n\n.a {\n  color: theme(--color-brand);\n}\n'

const project = await withTmpProject('stylelint-config-theme-function', {
  'src/global.css': ENTRY,
  'prefixed/global.css': PREFIXED_ENTRY,
  'plugin/global.css': `${ENTRY}\n@plugin './plugin.js';\n`,
  'imports/global.css': IMPORTS_ENTRY,
  'imports/a.css': IMPORTED_RESET,
  'imports/b.css': '@theme {\n  --color-brand: red;\n}\n',
})
await fs.mkdir(path.join(project.dir, 'node_modules'))
await fs.symlink(TAILWIND_DIR, path.join(project.dir, 'node_modules/tailwindcss'))

afterAll(async () => {
  await project[Symbol.asyncDispose]()
})

/**
 * Tailwind's error for `css`, whose relative imports resolve from `base`, or `undefined` when it
 * compiles
 */
async function tailwindErrorOf(css: string, base = TAILWIND_DIR): Promise<string | undefined> {
  try {
    await compile(css, {
      base,
      loadStylesheet: async (id: string, from: string) => {
        if (id !== 'tailwindcss' && !id.startsWith('./')) throw new Error(`Can't resolve '${id}'`)
        const file =
          id === 'tailwindcss' ? path.join(TAILWIND_DIR, 'index.css') : path.resolve(from, id)
        return { path: file, base: path.dirname(file), content: await fs.readFile(file, 'utf8') }
      },
    })
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const configs = new Map<string, Config>()

/**
 * The config with the entry point `<folder>/global.css`
 */
async function configOf(folder: string): Promise<Config> {
  let config = configs.get(folder)
  if (config === undefined) {
    config = await defineConfig({
      root: project.dir,
      tailwindcss: { entryPoint: `${folder}/global.css` },
    })
    configs.set(folder, config)
  }
  return config
}

/**
 * The messages of `@gpahal/tailwind-theme-function` on `code`, linted as `src/<file>` with the
 * entry point of `folder`
 */
async function reportsOf(code: string, folder = 'src', file = 'a.css'): Promise<Array<string>> {
  const { results } = await stylelint.lint({
    code,
    config: await configOf(folder),
    codeFilename: path.join(project.dir, 'src', file),
  })
  return results.flatMap((result) =>
    result.warnings
      .filter((warning) => warning.rule === '@gpahal/tailwind-theme-function')
      .map((warning) => warning.text.replace(/ \(@gpahal\/tailwind-theme-function\)$/, '')),
  )
}

/**
 * `.a { color: <value> }`
 */
function colorOf(value: string): string {
  return `.a {\n  color: ${value};\n}\n`
}

describe('@gpahal/tailwind-theme-function', () => {
  it.each([
    [
      colorOf('theme(--color-nope)'),
      'Unexpected unknown theme variable "--color-nope" in "theme()"',
    ],
    [
      colorOf('--theme(--color-nope)'),
      'Unexpected unknown theme variable "--color-nope" in "--theme()"',
    ],
    // `--brand` isn't in an `@theme` block
    [colorOf('theme(--brand)'), 'Unexpected unknown theme variable "--brand" in "theme()"'],
    [
      colorOf('theme(colors.nope.500)'),
      'Unexpected unknown theme key "colors.nope.500" in "theme()", whose variable is "--color-nope-500"',
    ],
    [
      '@media (width >= theme(--breakpoint-nope)) {\n  .a {\n    color: red;\n  }\n}\n',
      'Unexpected unknown theme variable "--breakpoint-nope" in "theme()"',
    ],
    // Resets after the reference files' definitions
    [
      `@theme {\n  --color-brand: initial;\n}\n\n${colorOf('theme(--color-brand)')}`,
      'Unexpected unknown theme variable "--color-brand" in "theme()"',
    ],
    [
      `@theme {\n  --color-*: initial;\n}\n\n${colorOf('theme(--color-red-500)')}`,
      'Unexpected unknown theme variable "--color-red-500" in "theme()"',
    ],
  ])('reports what fails Tailwind, in %j', async (code, message) => {
    expect(await tailwindErrorOf(`${ENTRY}\n${code}`)).toMatch(/^Could not resolve value/)
    expect(await reportsOf(code)).toEqual([message])
  })

  it.each([
    colorOf('--theme(--color-red-500 inline)'),
    colorOf('theme(--nope, red)'),
    colorOf("theme('colors.red.500')"),
    // A path with brackets isn't checked
    colorOf('theme(colors.red[500])'),
    '@theme {\n  --color-own: red;\n}\n\n.a {\n  color: theme(--color-own);\n}\n',
    // Tailwind evaluates functions only in these preludes, and its own at-rules'
    '@media (width >= theme(--breakpoint-md)) {\n  .a {\n    color: red;\n  }\n}\n',
    `@theme {\n  --color-*: initial;\n  --color-brand: blue;\n}\n\n${colorOf('theme(--color-brand)')}`,
    `@theme {\n  --color-*: initial;\n}\n\n${colorOf('theme(--color-red-500, red)')}`,
    // `--font-*` keeps `--font-weight-*`
    '@theme {\n  --font-*: initial;\n}\n\n.a {\n  font-weight: theme(--font-weight-bold);\n}\n',
  ])('takes what Tailwind compiles, in %j', async (code) => {
    expect(await tailwindErrorOf(`${ENTRY}\n${code}`)).toBeUndefined()
    expect(await reportsOf(code)).toEqual([])
  })

  it('reads theme names without the theme prefix, as Tailwind does', async () => {
    expect(
      await tailwindErrorOf(`${PREFIXED_ENTRY}\n${colorOf('theme(--color-red-500)')}`),
    ).toBeUndefined()
    expect(
      await tailwindErrorOf(`${PREFIXED_ENTRY}\n${colorOf('theme(--tw-color-red-500)')}`),
    ).toBeDefined()
    expect(
      await reportsOf(
        colorOf('theme(--color-red-500), theme(--color-brand), theme(--tw-color-red-500)'),
        'prefixed',
      ),
    ).toEqual(['Unexpected unknown theme variable "--tw-color-red-500" in "theme()"'])
  })

  // Its place among the reference files isn't known, so its resets remove only its own names
  it('keeps the names of a reference file after the linted reference file resets them', async () => {
    expect(await tailwindErrorOf(IMPORTS_ENTRY, path.join(project.dir, 'imports'))).toBeUndefined()
    expect(await reportsOf(IMPORTED_RESET, 'imports', '../imports/a.css')).toEqual([])
  })

  // Tailwind turns the keys of a JavaScript theme into theme variables, as `colors.brand` into
  // `--color-brand`
  it('skips key paths and variables when a `@plugin` or `@config` can add keys', async () => {
    expect(
      await reportsOf(colorOf('theme(colors.nope.500), theme(--color-nope)'), 'plugin'),
    ).toEqual([])
  })

  // A copy of Tailwind's own table, so this fails when Tailwind maps a key elsewhere
  it.each([
    ['animation.spin'],
    ['colors.red.500'],
    ['screens.md'],
    ['transitionTimingFunction.in-out'],
  ])("maps %s to Tailwind's variable", async (keyPath) => {
    const [key = ''] = keyPath.split('.', 1)
    expect(Object.hasOwn(LEGACY_NAMESPACES, key)).toBe(true)
    const nope = `${key}.zzz`
    expect(await tailwindErrorOf(`${ENTRY}\n${colorOf(`theme(${keyPath})`)}`)).toBeUndefined()
    expect(await tailwindErrorOf(`${ENTRY}\n${colorOf(`theme(${nope})`)}`)).toBeDefined()
    expect(await reportsOf(colorOf(`theme(${keyPath})`))).toEqual([])
    expect(await reportsOf(colorOf(`theme(${nope})`))).toHaveLength(1)
  })

  it("is on in an override with its own reference files, for the override's files", async () => {
    const config = await defineConfig({
      root: project.dir,
      tailwindcss: true,
      overrides: [{ files: ['src/**/*.css'], referenceFiles: 'src/global.css' }],
    })
    const lint = async (file: string) => {
      const { results } = await stylelint.lint({
        code: colorOf('theme(--color-nope), theme(--color-brand)'),
        config,
        codeFilename: path.join(project.dir, file),
      })
      return results.flatMap((result) =>
        result.warnings
          .filter((warning) => warning.rule === '@gpahal/tailwind-theme-function')
          .map((warning) => warning.line),
      )
    }
    expect(await lint('src/a.css')).toEqual([2])
    expect(await lint('other/a.css')).toEqual([])
  })

  it('is off in Markdown and without reference files', async () => {
    expect(
      await reportsOf(
        '# A\n\n```css\n.a {\n  color: theme(--color-nope);\n}\n```\n',
        'src',
        'a.md',
      ),
    ).toEqual([])
    expect(topLevelRules(await configOf('src'))).toHaveProperty(
      '@gpahal/tailwind-theme-function',
      true,
    )
    const config = await defineConfig({ root: project.dir, tailwindcss: true })
    expect(topLevelRules(config)).not.toHaveProperty('@gpahal/tailwind-theme-function')
  })
})
