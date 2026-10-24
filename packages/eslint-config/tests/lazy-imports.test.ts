import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { runNodeOk } from '@gpahal/internal/node/testing'

import { BUILD_DIR } from './helpers'

/**
 * Builds the config for each option set in `process.argv[2]` in turn, and prints the URLs of the
 * modules that load during each build, each once, since the full output would outgrow the child's
 * buffer. A module loads once per process, so a build's URLs leave
 * out the modules an earlier build loaded. A path that only resolves, as with `require.resolve()`,
 * doesn't count
 */
const SCRIPT = `
import { registerHooks } from 'node:module'

let urls = new Set()
registerHooks({
  load: (url, context, nextLoad) => {
    urls.add(url)
    return nextLoad(url, context)
  },
})
const [indexUrl, optionSets] = process.argv.slice(1)
const { defineConfig } = await import(indexUrl)
const output = []
for (const options of JSON.parse(optionSets)) {
  urls = new Set()
  await defineConfig({ root: process.cwd(), ...options })
  output.push([...urls])
}
console.log(JSON.stringify(output))
`

/**
 * The module URLs that load during each build of the build's config for the fixture `fixture`, one
 * for each of `optionSets`, in one process
 */
async function loadedUrls(
  fixture: string,
  optionSets: Array<Record<string, unknown>>,
): Promise<Array<Array<string>>> {
  const stdout = await runNodeOk(
    [
      '--input-type=module',
      '--eval',
      SCRIPT,
      pathToFileURL(path.join(BUILD_DIR, 'index.js')).href,
      JSON.stringify(optionSets),
    ],
    { cwd: path.join(import.meta.dirname, 'fixtures', fixture) },
  )
  return JSON.parse(stdout) as Array<Array<string>>
}

/**
 * The URLs of typescript-eslint's packages that load TypeScript
 */
const TYPESCRIPT_ESLINT_REGEX =
  /\/node_modules\/(?:typescript-eslint|@typescript-eslint\/(?:parser|eslint-plugin|typescript-estree))\//

/**
 * The modules each area loads, which a build with every area on must load
 */
const AREA_MODULES = {
  unicorn: ['/eslint-plugin-unicorn/'],
  sonarjs: ['/eslint-plugin-sonarjs/'],
  jsdoc: ['/eslint-plugin-jsdoc/'],
  imports: ['/eslint-plugin-import-x/'],
  pnpm: ['/eslint-plugin-pnpm/'],
  markdown: ['/@eslint/markdown/', '/mdast-util-from-markdown/'],
}

function loadedOf(urls: Array<string>, modules: Array<string>): Array<string> {
  return urls.filter((url) => modules.some((module) => url.includes(module)))
}

// Each process turns some areas off and checks that their plugins stay out while the areas left on,
// which would load them if they imported them, run
describe.concurrent('with areas off', () => {
  // eslint-plugin-unicorn's `relative-url-style` imports parse5, and markdown stays on, so this
  // also checks that markdown doesn't load the HTML parser. eslint-plugin-sonarjs and
  // eslint-plugin-regexp load TypeScript as they load, when it's installed. A build with every area
  // on comes after, in the same process, and loads the rest of the plugins
  it("doesn't import unicorn, sonarjs, jsdoc or the HTML parser, and loads TypeScript for a TypeScript project", async () => {
    const [urls = [], allOnUrls = []] = await loadedUrls('typescript', [
      { unicorn: false, sonarjs: false, jsdoc: false, regexp: false },
      {},
    ])
    expect(
      loadedOf(urls, [
        ...AREA_MODULES.unicorn,
        ...AREA_MODULES.sonarjs,
        ...AREA_MODULES.jsdoc,
        '/hast-util-from-html/',
        '/parse5/',
      ]),
    ).toEqual([])
    expect(urls.some((url) => url.includes('/node_modules/typescript/'))).toBe(true)
    // Every area's modules, so the checks of the modules that stay out can fail
    const everyBuild = [...urls, ...allOnUrls]
    for (const module of Object.values(AREA_MODULES).flat()) {
      expect(
        everyBuild.some((url) => url.includes(module)),
        module,
      ).toBe(true)
    }
    expect(everyBuild.some((url) => TYPESCRIPT_ESLINT_REGEX.test(url))).toBe(true)
  })

  // eslint-plugin-unicorn imports micromark as it loads, and eslint-plugin-sonarjs and
  // eslint-plugin-regexp load TypeScript, so this turns them off
  it("doesn't import imports, pnpm, markdown or micromark, nor typescript-eslint or TypeScript for a JavaScript-only project", async () => {
    const [urls = []] = await loadedUrls('cjs', [
      {
        imports: false,
        pnpm: false,
        markdown: false,
        unicorn: false,
        sonarjs: false,
        regexp: false,
      },
    ])
    expect(
      loadedOf(urls, [
        ...AREA_MODULES.imports,
        ...AREA_MODULES.pnpm,
        ...AREA_MODULES.markdown,
        '/micromark/',
      ]),
    ).toEqual([])
    expect(urls.filter((url) => TYPESCRIPT_ESLINT_REGEX.test(url))).toEqual([])
    expect(urls.filter((url) => url.includes('/node_modules/typescript/'))).toEqual([])
  })
})
