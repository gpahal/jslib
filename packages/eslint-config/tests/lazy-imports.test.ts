import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertBuildIsCurrent, runNodeOk } from '@gpahal/internal/node/testing'

import { BUILD_DIR } from './helpers'

const enabledUrls: Array<string> = []

beforeAll(async () => {
  await assertBuildIsCurrent(BUILD_DIR)
  enabledUrls.push(...(await resolvedUrls({})))
})

/**
 * Records every module URL that loads while the build's config builds with the options in
 * `process.argv[2]`, and prints them, each once, since the output would outgrow the child's buffer.
 * A path that only resolves, as with `require.resolve()`, doesn't count
 */
const SCRIPT = `
import { registerHooks } from 'node:module'

const urls = new Set()
registerHooks({
  load: (url, context, nextLoad) => {
    urls.add(url)
    return nextLoad(url, context)
  },
})
const [indexUrl, options] = process.argv.slice(1)
const { defineConfig } = await import(indexUrl)
await defineConfig({ root: process.cwd(), ...JSON.parse(options) })
console.log(JSON.stringify([...urls]))
`

/**
 * The module URLs that load while the build's config builds with `options` for the fixture
 * `fixture`, each once
 */
async function resolvedUrls(
  options: Record<string, unknown>,
  fixture = 'typescript',
): Promise<Array<string>> {
  const stdout = await runNodeOk(
    [
      '--input-type=module',
      '--eval',
      SCRIPT,
      pathToFileURL(path.join(BUILD_DIR, 'index.js')).href,
      JSON.stringify(options),
    ],
    { cwd: path.join(import.meta.dirname, 'fixtures', fixture) },
  )
  return JSON.parse(stdout) as Array<string>
}

/**
 * The URLs of typescript-eslint's packages that load TypeScript
 */
const TYPESCRIPT_ESLINT_REGEX =
  /\/node_modules\/(?:typescript-eslint|@typescript-eslint\/(?:parser|eslint-plugin|typescript-estree))\//

/**
 * The modules each area loads, which `enabledUrls` must have
 */
const AREA_MODULES = {
  unicorn: ['/eslint-plugin-unicorn/'],
  sonarjs: ['/eslint-plugin-sonarjs/'],
  jsdoc: ['/eslint-plugin-jsdoc/'],
  imports: ['/eslint-plugin-import-x/'],
  pnpm: ['/eslint-plugin-pnpm/'],
  markdown: ['/@eslint/markdown/', '/mdast-util-from-markdown/'],
}

test('loads the plugin of every area that is on', () => {
  for (const module of Object.values(AREA_MODULES).flat()) {
    expect(
      enabledUrls.some((url) => url.includes(module)),
      module,
    ).toBe(true)
  }
  expect(enabledUrls.some((url) => TYPESCRIPT_ESLINT_REGEX.test(url))).toBe(true)
})

// Each process turns half of the areas off, so each area's plugin is checked to stay out while
// the other half is on, which would load it if they imported it
describe.concurrent('with areas off', () => {
  // eslint-plugin-unicorn's `relative-url-style` imports parse5, and markdown stays on, so this
  // also checks that markdown doesn't load the HTML parser. eslint-plugin-sonarjs and
  // eslint-plugin-regexp load TypeScript as they load, when it's installed
  it("doesn't import unicorn, sonarjs, jsdoc or the HTML parser, and loads TypeScript for a TypeScript project", async () => {
    const urls = await resolvedUrls({
      unicorn: false,
      sonarjs: false,
      jsdoc: false,
      regexp: false,
    })
    for (const module of [
      ...AREA_MODULES.unicorn,
      ...AREA_MODULES.sonarjs,
      ...AREA_MODULES.jsdoc,
      '/hast-util-from-html/',
      '/parse5/',
    ]) {
      expect(urls.filter((url) => url.includes(module))).toEqual([])
    }
    expect(urls.some((url) => url.includes('/node_modules/typescript/'))).toBe(true)
  })

  // eslint-plugin-unicorn imports micromark as it loads, so this turns it off
  it("doesn't import imports, pnpm, markdown or micromark", async () => {
    const urls = await resolvedUrls({
      imports: false,
      pnpm: false,
      markdown: false,
      unicorn: false,
    })
    for (const module of [
      ...AREA_MODULES.imports,
      ...AREA_MODULES.pnpm,
      ...AREA_MODULES.markdown,
      '/micromark/',
    ]) {
      expect(urls.filter((url) => url.includes(module))).toEqual([])
    }
  })

  it("doesn't load typescript-eslint or TypeScript for a JavaScript-only project without sonarjs and regexp", async () => {
    const urls = await resolvedUrls({ sonarjs: false, regexp: false }, 'cjs')
    expect(urls.filter((url) => TYPESCRIPT_ESLINT_REGEX.test(url))).toEqual([])
    expect(urls.filter((url) => url.includes('/node_modules/typescript/'))).toEqual([])
  })
})
