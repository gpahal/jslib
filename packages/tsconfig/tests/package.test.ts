import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { publint } from 'publint'
import ts from 'typescript'

import { PACKAGE_DIR, PRESETS } from './helpers'

const PACKAGE_JSON = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
  files: Array<string>
  exports: Record<string, string>
}

// The package has no `typecheck-release` script, where the other packages run publint
test('publint finds no problems in the packed package', async () => {
  const { messages } = await publint({ pkgDir: PACKAGE_DIR, pack: 'pnpm', strict: true })
  expect(messages.filter(({ type }) => type !== 'suggestion')).toEqual([])
})

test('every preset is published and exported by its name, with base as the root', () => {
  expect(new Set(PACKAGE_JSON.files)).toEqual(new Set(PRESETS))
  expect(PACKAGE_JSON.exports).toEqual({
    '.': './base.json',
    ...Object.fromEntries(
      PACKAGE_JSON.files.map((file) => [`./${path.basename(file, '.json')}`, `./${file}`]),
    ),
    './*.json': './*.json',
    './package.json': './package.json',
  })
})

// In process, `tsc` resolves a package's `extends` through its `exports` as it does from the CLI
test.each(['@gpahal/tsconfig/base', '@gpahal/tsconfig/base.json', '@gpahal/tsconfig'])(
  'an installed project extends base as %s',
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
    const parsed = ts.getParsedCommandLineOfConfigFile(
      path.join(dir.path, 'tsconfig.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        },
      },
    )!
    expect(parsed.errors).toEqual([])
    expect(parsed.options).toMatchObject({
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      noUncheckedIndexedAccess: true,
    })
  },
)
