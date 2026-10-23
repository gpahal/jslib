import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertBuildIsCurrent, runNodeOk } from '@gpahal/internal/node/testing'

import { BUILD_DIR, CORE_AREAS_OFF_SOURCE, withProject } from './helpers'

// The child process can't load the TypeScript sources, so it uses the build
beforeAll(async () => assertBuildIsCurrent(BUILD_DIR))

const FILES = {
  'index.js':
    "import path from 'node:path'\n\nexport const dir = path.dirname(import.meta.filename)\n",
  'index.mjs': 'export const dir = __dirname\n',
  'index.cjs': "const path = require('node:path')\n\nmodule.exports = path.join(__dirname, 'a')\n",
}

/**
 * eslint-plugin-n reads the working directory's `package.json` when it's first imported, so this
 * runs in a fresh process
 */
const SCRIPT = `
const [indexUrl, eslintUrl] = process.argv.slice(1)
const { defineConfig } = await import(indexUrl)
const { ESLint } = await import(eslintUrl)
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: await defineConfig({ root: process.cwd(), node: true, ${CORE_AREAS_OFF_SOURCE} }),
})
const results = await eslint.lintFiles(['.'])
const messages = results.flatMap((result) =>
  result.messages.map((message) => \`\${result.filePath.split('/').at(-1)}: \${message.ruleId}\`),
)
console.log(JSON.stringify(messages))
`

// Without `"type": "module"`, which eslint-plugin-n would read to treat `.js` files as CommonJS
test('node preset picks the module type from the file extension, without "type": "module"', async () => {
  await using project = await withProject({
    ...FILES,
    'package.json': JSON.stringify({
      name: 'node-project',
      private: true,
      engines: { node: '>=24' },
    }),
  })
  const stdout = await runNodeOk(
    [
      '--input-type=module',
      '--eval',
      SCRIPT,
      pathToFileURL(path.join(BUILD_DIR, 'index.js')).href,
      pathToFileURL(createRequire(import.meta.url).resolve('eslint')).href,
    ],
    { cwd: project.dir },
  )
  expect(JSON.parse(stdout)).toEqual(['index.mjs: no-undef'])
})
