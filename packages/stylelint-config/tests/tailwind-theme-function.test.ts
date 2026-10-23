import path from 'node:path'

import stylelint, { type Config } from 'stylelint'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'
import { LEGACY_NAMESPACES } from '@/internal/tailwind-theme-function'

import { linkTailwind, tailwindProblemOf } from './helpers'

const ENTRY =
  "@import 'tailwindcss';\n\n@theme {\n  --color-brand: red;\n}\n\n:root {\n  --brand: red;\n}\n"

const PREFIXED_ENTRY = "@import 'tailwindcss' prefix(tw);\n\n@theme {\n  --color-brand: red;\n}\n"

const project = await withTmpProject('stylelint-config-theme-function', {
  'src/global.css': ENTRY,
  'prefixed/global.css': PREFIXED_ENTRY,
  'plugin/global.css': `${ENTRY}\n@plugin './plugin.js';\n`,
})
await linkTailwind(project.dir)

afterAll(async () => {
  await project[Symbol.asyncDispose]()
})

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
 * The messages of `@gpahal/tailwind-theme-function` on `code`, linted as `src/a.css` with the entry
 * point of `folder`
 */
async function reportsOf(code: string, folder = 'src'): Promise<Array<string>> {
  const { results } = await stylelint.lint({
    code,
    config: await configOf(folder),
    codeFilename: path.join(project.dir, 'src/a.css'),
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
    // Tailwind's JavaScript default theme has the keys of every mapped namespace but these
    [
      colorOf('theme(borderRadius.nope)'),
      'Unexpected unknown theme key "borderRadius.nope" in "theme()", whose variable is "--radius-nope"',
    ],
    [
      `@theme {\n  --color-*: initial;\n}\n\n${colorOf('theme(colors.red.500)')}`,
      'Unexpected unknown theme key "colors.red.500" in "theme()", whose variable is "--color-red-500"',
    ],
    [
      `@theme {\n  --container-*: initial;\n}\n\n${colorOf('theme(containers.sm)')}`,
      'Unexpected unknown theme key "containers.sm" in "theme()", whose variable is "--container-sm"',
    ],
    // An object, which has no value
    [
      colorOf('theme(fontSize.sm.1)'),
      'Unexpected unknown theme key "fontSize.sm.1" in "theme()", whose variable is "--text-sm-1"',
    ],
  ])('reports what fails Tailwind, in %j', async (code, message) => {
    expect(await tailwindProblemOf(`${ENTRY}\n${code}`)).toMatch(/^Could not resolve value/)
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
    // Paths that Tailwind's JavaScript default theme resolves, whether or not the CSS theme has them
    colorOf(
      'theme(borderRadius.full) theme(lineHeight.none) theme(lineHeight.3) theme(lineHeight.10) theme(aspectRatio.square)',
    ),
    colorOf(
      'theme(boxShadow.none) theme(transitionTimingFunction.linear) theme(animation.none) theme(fontSize.sm.0)',
    ),
    `@theme {\n  --radius-*: initial;\n}\n\n${colorOf('theme(borderRadius.lg)')}`,
  ])('takes what Tailwind compiles, in %j', async (code) => {
    expect(await tailwindProblemOf(`${ENTRY}\n${code}`)).toBeUndefined()
    expect(await reportsOf(code)).toEqual([])
  })

  it('reads theme names without the theme prefix, as Tailwind does', async () => {
    expect(
      await tailwindProblemOf(`${PREFIXED_ENTRY}\n${colorOf('theme(--color-red-500)')}`),
    ).toBeUndefined()
    expect(
      await tailwindProblemOf(`${PREFIXED_ENTRY}\n${colorOf('theme(--tw-color-red-500)')}`),
    ).toBeDefined()
    expect(
      await reportsOf(
        colorOf('theme(--color-red-500), theme(--color-brand), theme(--tw-color-red-500)'),
        'prefixed',
      ),
    ).toEqual(['Unexpected unknown theme variable "--tw-color-red-500" in "theme()"'])
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
    expect(await tailwindProblemOf(`${ENTRY}\n${colorOf(`theme(${keyPath})`)}`)).toBeUndefined()
    expect(await tailwindProblemOf(`${ENTRY}\n${colorOf(`theme(${nope})`)}`)).toBeDefined()
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
})
