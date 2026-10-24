import fs from 'node:fs/promises'
import path from 'node:path'

import { build } from 'tsdown'
import type { InlineConfig } from 'tsdown'

import { withPeerProject } from './peer-project'

/**
 * A project with `source` as `index.ts` and an unbundled peer, built with an empty
 * `deps.onlyImport`
 */
async function withCanaryProject(
  source: string,
): Promise<{ config: InlineConfig; cwd: string } & AsyncDisposable> {
  const project = await withPeerProject('canary', { 'index.ts': source })
  const cwd = project.dir
  return {
    cwd,
    config: {
      cwd,
      config: false,
      entry: ['index.ts'],
      outDir: 'build',
      fixedExtension: false,
      dts: { generator: 'tsc' },
      deps: { neverBundle: ['fixture-peer'], onlyImport: [] },
      logLevel: 'silent',
    },
    [Symbol.asyncDispose]: async () => project[Symbol.asyncDispose](),
  }
}

test.each([
  [
    'import type',
    'export type Value = import("fixture-peer").Value',
    /import\(["']fixture-peer["']\)/,
  ],
  [
    'types reference',
    '/// <reference types="fixture-peer" preserve="true" />\nexport type Value = string',
    /reference types=["']fixture-peer["']/,
  ],
])(
  'onlyImport still misses %s; remove checkDeclarationImports in tsdown.config.ts when both canaries fail',
  async (_name, source, reference) => {
    await using project = await withCanaryProject(source)
    await expect(build(project.config)).resolves.toBeDefined()
    expect(await fs.readFile(path.join(project.cwd, 'build/index.d.ts'), 'utf8')).toMatch(reference)
  },
)

test('onlyImport rejects an ordinary declaration import, so the canaries above test it', async () => {
  await using project = await withCanaryProject('export type { Value } from "fixture-peer"')
  await expect(build(project.config)).rejects.toThrow('deps.onlyImport')
})
