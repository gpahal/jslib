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

test.concurrent.each([
  ['unicorn', '/eslint-plugin-unicorn/'],
  ['sonarjs', '/eslint-plugin-sonarjs/'],
  ['jsdoc', '/eslint-plugin-jsdoc/'],
  ['imports', '/eslint-plugin-import-x/'],
  ['pnpm', '/eslint-plugin-pnpm/'],
  ['markdown', '/@eslint/markdown/'],
  ['markdown', '/mdast-util-from-markdown/'],
])("imports the plugin of %s only when it's on: %s", async (area, plugin) => {
  expect(enabledUrls.some((url) => url.includes(plugin))).toBe(true)
  const off = await resolvedUrls({ [area]: false })
  expect(off.filter((url) => url.includes(plugin))).toEqual([])
})

// eslint-plugin-unicorn's `relative-url-style` imports micromark and parse5 as the plugin loads, so
// this turns it off
test('imports micromark and the HTML parser only when needed', async () => {
  const urls = await resolvedUrls({ unicorn: false })
  expect(
    urls.filter((url) => url.includes('/hast-util-from-html/') || url.includes('/parse5/')),
  ).toEqual([])
  const off = await resolvedUrls({ markdown: false, unicorn: false })
  expect(off.filter((url) => url.includes('/micromark/'))).toEqual([])
})

/**
 * The URLs of typescript-eslint's packages that load TypeScript
 */
const TYPESCRIPT_ESLINT_REGEX =
  /\/node_modules\/(?:typescript-eslint|@typescript-eslint\/(?:parser|eslint-plugin|typescript-estree))\//

test('loads typescript-eslint only outside a JavaScript-only project', async () => {
  expect(enabledUrls.some((url) => TYPESCRIPT_ESLINT_REGEX.test(url))).toBe(true)
  const urls = await resolvedUrls({}, 'cjs')
  expect(urls.filter((url) => TYPESCRIPT_ESLINT_REGEX.test(url))).toEqual([])
})

// eslint-plugin-sonarjs and eslint-plugin-regexp load TypeScript as they load, when it's installed
test("doesn't load TypeScript for a JavaScript-only project without sonarjs and regexp", async () => {
  const urls = await resolvedUrls({ sonarjs: false, regexp: false }, 'cjs')
  expect(urls.filter((url) => url.includes('/node_modules/typescript/'))).toEqual([])
  expect(
    (await resolvedUrls({ sonarjs: false, regexp: false })).some((url) =>
      url.includes('/node_modules/typescript/'),
    ),
  ).toBe(true)
})
