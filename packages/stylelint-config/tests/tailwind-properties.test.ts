import fs from 'node:fs/promises'
import path from 'node:path'

import stylelint from 'stylelint'
import { __unstable__loadDesignSystem, compile } from 'tailwindcss'

import { withTmpProject, writeFiles } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'
import { propertyNamesOf, TAILWIND_PROPERTY_CANDIDATES } from '@/internal/tailwindcss'

const TAILWIND_DIR = await fs.realpath(
  path.join(import.meta.dirname, '../node_modules/tailwindcss'),
)

const options = {
  base: TAILWIND_DIR,
  loadStylesheet: async (id: string, base: string) => {
    const file =
      id === 'tailwindcss' ? path.join(TAILWIND_DIR, 'index.css') : path.resolve(base, id)
    return { path: file, base: path.dirname(file), content: await fs.readFile(file, 'utf8') }
  },
}

const CSS = "@import 'tailwindcss';"

test("the candidates give every `--tw-*` property of Tailwind's classes and variants", async () => {
  const designSystem = await __unstable__loadDesignSystem(CSS, options)
  const candidates = [
    ...designSystem.getClassList().map(([name]) => name),
    ...designSystem.getVariants().map((variant) => `${variant.name}:flex`),
  ]
  const all = propertyNamesOf((await compile(CSS, options)).build(candidates))
  const given = propertyNamesOf(
    (await compile(CSS, options)).build([...TAILWIND_PROPERTY_CANDIDATES]),
  )
  expect(all.length).toBeGreaterThan(100)
  expect(new Set(given)).toEqual(new Set(all))
})

describe("Tailwind's `--tw-*` properties", () => {
  let project: Awaited<ReturnType<typeof withTmpProject>>
  beforeAll(async () => {
    project = await withTmpProject('stylelint-config-tw-properties', {})
    await fs.mkdir(path.join(project.dir, 'node_modules'))
    await fs.symlink(TAILWIND_DIR, path.join(project.dir, 'node_modules/tailwindcss'))
  })
  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  const code = [
    '.card {',
    '  box-shadow: var(--tw-ring-offset-shadow), var(--tw-shadow);',
    '  translate: var(--tw-translate-x) 0;',
    '  color: var(--tw-nope);',
    '}',
    '',
  ].join('\n')

  it.each([
    ['without a prefix', "@import 'tailwindcss';\n"],
    ['with a theme prefix', "@import 'tailwindcss' prefix(tw);\n"],
  ])('are known with an entry point, %s', async (name, entry) => {
    const caseDir = path.join(project.dir, name.replaceAll(' ', '-'))
    await writeFiles(caseDir, { 'global.css': entry })
    const config = await defineConfig({
      root: project.dir,
      tailwindcss: { entryPoint: path.join(caseDir, 'global.css') },
    })
    const { results } = await stylelint.lint({ code, config, configBasedir: project.dir })
    expect(
      results.flatMap((result) =>
        result.warnings
          .filter((warning) => warning.rule === 'no-unknown-custom-properties')
          .map((warning) => warning.text),
      ),
    ).toEqual(['Unknown custom property "--tw-nope" (no-unknown-custom-properties)'])
  })

  it('throws when the Tailwind next to the entry point has no compile()', async () => {
    const caseDir = await fs.realpath(project.dir).then((real) => path.join(real, 'old'))
    await writeFiles(caseDir, {
      'global.css': "@import 'tailwindcss';\n",
      'node_modules/tailwindcss/package.json': JSON.stringify({ name: 'tailwindcss' }),
      'node_modules/tailwindcss/index.js': 'module.exports = {}\n',
      'node_modules/tailwindcss/theme.css': '',
    })
    await expect(
      defineConfig({
        root: project.dir,
        tailwindcss: { entryPoint: path.join(caseDir, 'global.css') },
      }),
    ).rejects.toThrow(
      new TypeError(
        `@gpahal/stylelint-config: \`tailwindcss.entryPoint\`: \`${path.join(caseDir, 'node_modules/tailwindcss/index.js')}\` has no \`compile()\`. Install Tailwind CSS v4.3 or later`,
      ),
    )
  })
})
