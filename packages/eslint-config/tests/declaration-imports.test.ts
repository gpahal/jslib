import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { build, type UserConfig } from 'tsdown'

/**
 * A computed specifier keeps the root config out of this package's stricter type check
 */
const rootConfigPath = path.resolve(import.meta.dirname, '../../../tsdown.config.ts')
const { default: rootConfig } = (await import(rootConfigPath)) as { default: UserConfig }

test("the root tsdown config rejects a declaration import of a package that isn't a dependency", async () => {
  await using directory = await fs.mkdtempDisposable(path.join(os.tmpdir(), 'tsdown-imports-'))
  const cwd = directory.path
  await fs.mkdir(path.join(cwd, 'node_modules/fixture-peer'), { recursive: true })
  await fs.writeFile(
    path.join(cwd, 'node_modules/fixture-peer/package.json'),
    JSON.stringify({ name: 'fixture-peer', types: 'index.d.ts' }),
  )
  await fs.writeFile(
    path.join(cwd, 'node_modules/fixture-peer/index.d.ts'),
    'export type Value = string',
  )
  await fs.writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({ name: 'fixture', type: 'module', devDependencies: { 'fixture-peer': '*' } }),
  )
  await fs.writeFile(
    path.join(cwd, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { declaration: true, isolatedDeclarations: true, skipLibCheck: true },
    }),
  )
  await fs.mkdir(path.join(cwd, 'src'))
  await fs.writeFile(
    path.join(cwd, 'src/index.ts'),
    'export type Value = import("fixture-peer").Value',
  )
  const { onSuccess } = rootConfig
  if (typeof onSuccess !== 'function') {
    throw new TypeError('expected the root config to check declarations in `onSuccess`')
  }
  // tsdown doesn't await `onSuccess`, whose rejection would otherwise go unhandled
  let check: unknown
  await build({
    ...rootConfig,
    cwd,
    config: false,
    dts: { generator: 'tsc' },
    deps: { ...rootConfig.deps, neverBundle: ['fixture-peer'] },
    exports: false,
    logLevel: 'silent',
    onSuccess: (config, signal) => {
      check = Promise.resolve(onSuccess(config, signal))
    },
  })
  await expect(check).rejects.toThrow(
    /^fixture: `build\/index\.d\.ts`: imports 'fixture-peer', which isn't a dependency/,
  )
})
