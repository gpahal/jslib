import fs from 'node:fs/promises'
import path from 'node:path'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'

const root = path.join(import.meta.dirname, 'fixtures', 'rules')

const PREFIX = '@gpahal/eslint-config: `tailwindcss.entryPoint`:'

// `@gpahal/internal/node/paths`' `resolveFileOption` checks it, as in prettier-config and
// stylelint-config
describe('tailwindcss.entryPoint', () => {
  it('names the resolved path when nothing or a folder is there, before loading the plugin', () => {
    for (const entryPoint of ['../tailwindcss/src/missing.css', '../tailwindcss/src']) {
      expect(() => defineConfig({ root, tailwindcss: { entryPoint } })).toThrow(
        new TypeError(`${PREFIX} \`${path.resolve(root, entryPoint)}\` isn't a file`),
      )
    }
  })

  it('gives the whole value of a URL other than `file:`', () => {
    expect(() =>
      defineConfig({ root, tailwindcss: { entryPoint: new URL('https://example.com/a.css') } }),
    ).toThrow(
      new TypeError(
        `${PREFIX} expected an absolute path or one relative to \`root\`, or a \`file:\` URL or URL string with an absolute path, such as \`import.meta.resolve('./src/styles/global.css')\`, received \`https://example.com/a.css\``,
      ),
    )
  })

  it('keeps the filesystem error as the cause when the path cannot be read', async () => {
    await using project = await withTmpProject('eslint-config-entry-point', {
      'package.json': '{}',
    })
    const loop = path.join(project.dir, 'loop')
    await fs.symlink('loop', loop)
    expect(() => defineConfig({ root: project.dir, tailwindcss: { entryPoint: 'loop' } })).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(`${PREFIX} reading \`${loop}\` failed: `) as unknown,
        cause: expect.objectContaining({ code: 'ELOOP' }) as unknown,
      }),
    )
  })
})
