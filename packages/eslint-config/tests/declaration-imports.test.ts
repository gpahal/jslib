import path from 'node:path'

import { build } from 'tsdown'
import type { UserConfig } from 'tsdown'

import { withPeerProject } from './peer-project'

/**
 * A computed specifier keeps the root config out of this package's stricter type check
 */
const rootConfigPath = path.resolve(import.meta.dirname, '../../../tsdown.config.ts')
const { default: rootConfig } = (await import(rootConfigPath)) as { default: UserConfig }

test("the root tsdown config rejects a declaration import of a package that isn't a dependency", async () => {
  await using project = await withPeerProject('fixture', {
    'src/index.ts': 'export type Value = import("fixture-peer").Value',
  })
  const cwd = project.dir
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
