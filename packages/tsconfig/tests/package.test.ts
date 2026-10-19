import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { publint } from 'publint'

const PACKAGE_DIR = path.join(import.meta.dirname, '..')

const PACKAGE_JSON = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
  files: Array<string>
  exports: Record<string, string>
}

const require = createRequire(import.meta.url)

const TSC_BIN = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc')

const execFileAsync = promisify(execFile)

// The package has no `typecheck-release` script, where the other packages run publint
test('publint finds no problems in the packed package', async () => {
  const { messages } = await publint({ pkgDir: PACKAGE_DIR, pack: 'pnpm', strict: true })
  expect(messages.filter(({ type }) => type !== 'suggestion')).toEqual([])
})

test('every preset is published and exported by its name, with base as the root', () => {
  const presets = readdirSync(PACKAGE_DIR).filter(
    (name) => name.endsWith('.json') && name !== 'package.json' && name !== 'tsconfig.json',
  )
  expect(new Set(PACKAGE_JSON.files)).toEqual(new Set(presets))
  expect(PACKAGE_JSON.exports).toEqual({
    '.': './base.json',
    ...Object.fromEntries(
      PACKAGE_JSON.files.map((file) => [`./${path.basename(file, '.json')}`, `./${file}`]),
    ),
    './*.json': './*.json',
    './package.json': './package.json',
  })
})

test.each(['@gpahal/tsconfig/base', '@gpahal/tsconfig/base.json', '@gpahal/tsconfig'])(
  'an installed project extends base as %s',
  { timeout: 30_000 },
  async (preset) => {
    await using dir = await fs.mkdtempDisposable(path.join(os.tmpdir(), 'tsconfig-project-'))
    const scopeDir = path.join(dir.path, 'node_modules/@gpahal')
    await fs.mkdir(scopeDir, { recursive: true })
    await fs.symlink(PACKAGE_DIR, path.join(scopeDir, 'tsconfig'), 'dir')
    await fs.writeFile(path.join(dir.path, 'a.ts'), 'export const a = 1\n')
    await fs.writeFile(
      path.join(dir.path, 'tsconfig.json'),
      JSON.stringify({ extends: preset, files: ['a.ts'] }),
    )
    const { stdout } = await execFileAsync(process.execPath, [
      TSC_BIN,
      '--showConfig',
      '-p',
      dir.path,
    ])
    const config = JSON.parse(stdout) as { compilerOptions: Record<string, unknown> }
    expect(config.compilerOptions).toMatchObject({
      moduleResolution: 'bundler',
      noEmit: true,
      noUncheckedIndexedAccess: true,
    })
  },
)
