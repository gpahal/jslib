import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertBuildIsCurrent, withTmpProject } from '@gpahal/internal/node/testing'

import { linkTailwind, TAILWIND_DIR } from './helpers'

const PACKAGE_DIR = path.join(import.meta.dirname, '..')

// `runNode` always empties `NODE_PATH`, so this test sets it on a child process of its own
describe('NODE_PATH', () => {
  it("doesn't resolve tailwindcss/theme.css through it", async () => {
    await assertBuildIsCurrent(path.join(PACKAGE_DIR, 'build'))
    await using project = await withTmpProject('stylelint-config-node-path', {
      'app/package.json': '{}',
      'app/global.css': "@import 'tailwindcss';\n",
      'app/tokens/a.css': '',
    })
    await linkTailwind(path.join(project.dir, 'hoisted'))
    const hoisted = path.join(project.dir, 'hoisted/node_modules')
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
      path.join(TAILWIND_DIR, 'theme.css'),
      `@gpahal/stylelint-config: \`tailwindcss\`: \`tailwindcss/theme.css\` doesn't resolve from \`root\`, \`${appDir}\`. Install Tailwind CSS v4 there`,
      `@gpahal/stylelint-config: \`tailwindcss.entryPoint\`: \`tailwindcss/theme.css\` doesn't resolve from its folder, \`${appDir}\`. Install Tailwind CSS v4 there`,
    ])
  })
})
