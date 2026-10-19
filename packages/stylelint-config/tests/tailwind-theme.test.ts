import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertBuildIsCurrent, runNode, withTmpProject } from '@gpahal/internal/node/testing'

const PACKAGE_DIR = path.join(import.meta.dirname, '..')

const STYLELINT_BIN = path.join(PACKAGE_DIR, 'node_modules/stylelint/bin/stylelint.mjs')

/**
 * Uses a custom property it defines nowhere, and one of Tailwind's theme variables
 */
const CSS = 'a {\n  color: var(--color-brnd);\n  background: var(--color-red-500);\n}\n'

/**
 * A config for `apps/web`, with the Tailwind entry stylesheet given by `entryPoint` when it's a
 * JavaScript expression, and Tailwind's theme looked up from `root` otherwise
 */
function configOf(entryPoint: string | undefined): string {
  const defineUrl = pathToFileURL(path.join(PACKAGE_DIR, 'build/index.js')).href
  const tailwindcss = entryPoint === undefined ? 'true' : `{ entryPoint: ${entryPoint} }`
  return `import { defineConfig } from ${JSON.stringify(defineUrl)}\n\nexport default await defineConfig({ root: import.meta.dirname, tailwindcss: ${tailwindcss}, referenceFiles: 'tokens.css' })\n`
}

/**
 * The custom properties `no-unknown-custom-properties` reports in `apps/web/a.css`, with Stylelint
 * run from `cwd`
 */
async function unknownProperties(cwd: string, file: string): Promise<Array<string>> {
  const { stdout, stderr } = await runNode([STYLELINT_BIN, file, '--formatter', 'json'], { cwd })
  // The JSON formatter writes to stderr when a rule reports an error
  const output = stderr || stdout
  let results: Array<{ warnings: Array<{ rule: string; text: string }> }>
  try {
    results = JSON.parse(output) as typeof results
  } catch {
    throw new Error(output)
  }
  const warnings = results.flatMap((result) => result.warnings)
  return warnings
    .filter((warning) => warning.rule === 'no-unknown-custom-properties')
    .map((warning) => /"(--[\w-]+)"/.exec(warning.text)?.[1] ?? warning.text)
}

// A monorepo whose root doesn't install tailwindcss, and whose `apps/web` does
describe('tailwindcss.entryPoint and root', () => {
  let project: Awaited<ReturnType<typeof withTmpProject>>
  let rootDir: string
  let webDir: string

  beforeAll(async () => {
    await assertBuildIsCurrent(path.join(PACKAGE_DIR, 'build'))
    project = await withTmpProject('stylelint-config-theme', {
      'package.json': '{"type":"module"}\n',
      'apps/web/package.json': '{"type":"module"}\n',
      'apps/web/tokens.css': ':root {\n  --color-brand: red;\n}\n',
      'apps/web/a.css': CSS,
      'apps/web/global.css': "@import 'tailwindcss';\n",
    })
    rootDir = project.dir
    webDir = path.join(rootDir, 'apps/web')
    await fs.mkdir(path.join(webDir, 'node_modules'))
    await fs.symlink(
      await fs.realpath(path.join(PACKAGE_DIR, 'node_modules/tailwindcss')),
      path.join(webDir, 'node_modules/tailwindcss'),
    )
  })

  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  // reference-files.test.ts checks entry points in process; these check the CLI's working directory
  it.each([
    {
      name: 'resolves a relative entry point against root, wherever Stylelint runs',
      config: configOf("'global.css'"),
    },
    {
      name: 'looks the theme up from root when the entry point is omitted',
      config: configOf(undefined),
    },
  ])('$name', { timeout: 60_000 }, async ({ config }) => {
    await fs.writeFile(path.join(webDir, 'stylelint.config.mjs'), config)
    expect(await unknownProperties(rootDir, 'apps/web/a.css')).toEqual(['--color-brnd'])
    expect(await unknownProperties(webDir, 'a.css')).toEqual(['--color-brnd'])
  })
})

// `runNode` always empties `NODE_PATH`, so this test sets it on a child process of its own
describe('NODE_PATH', () => {
  it("doesn't resolve tailwindcss/theme.css through it", { timeout: 60_000 }, async () => {
    await assertBuildIsCurrent(path.join(PACKAGE_DIR, 'build'))
    await using project = await withTmpProject('stylelint-config-node-path', {
      'app/package.json': '{}',
      'app/global.css': "@import 'tailwindcss';\n",
      'app/tokens/a.css': '',
    })
    const hoisted = path.join(project.dir, 'hoisted/node_modules')
    await fs.mkdir(hoisted, { recursive: true })
    const tailwindDir = await fs.realpath(path.join(PACKAGE_DIR, 'node_modules/tailwindcss'))
    await fs.symlink(tailwindDir, path.join(hoisted, 'tailwindcss'))
    const appDir = path.join(project.dir, 'app')
    const defineUrl = pathToFileURL(path.join(PACKAGE_DIR, 'build/index.js')).href
    const script = `
      import { createRequire } from 'node:module'
      import { defineConfig } from ${JSON.stringify(defineUrl)}
      const appDir = ${JSON.stringify(appDir)}
      const required = createRequire(appDir + '/package.json').resolve('tailwindcss/theme.css')
      const errorOf = async (options) => {
        try {
          await defineConfig(options)
          return null
        } catch (caught) {
          return caught.message
        }
      }
      console.log(JSON.stringify([
        required,
        await errorOf({ root: appDir, tailwindcss: true, referenceFiles: 'tokens/*.css' }),
        await errorOf({ root: appDir, tailwindcss: { entryPoint: appDir + '/global.css' } }),
      ]))
    `
    const stdout = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: hoisted },
    })
    // Node's own resolver finds the hoisted copy through `NODE_PATH`, and the package doesn't
    expect(JSON.parse(stdout)).toEqual([
      path.join(tailwindDir, 'theme.css'),
      `@gpahal/stylelint-config: \`tailwindcss\`: \`tailwindcss/theme.css\` doesn't resolve from \`root\`, \`${appDir}\`. Install Tailwind CSS v4 there`,
      `@gpahal/stylelint-config: \`tailwindcss.entryPoint\`: \`tailwindcss/theme.css\` doesn't resolve from its folder, \`${appDir}\`. Install Tailwind CSS v4 there`,
    ])
  })
})
