import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { build, type InlineConfig } from 'tsdown'

/**
 * A project with `source` as `index.ts` and an unbundled peer, built with an empty
 * `deps.onlyImport`
 */
async function withCanaryProject(
  source: string,
): Promise<{ config: InlineConfig; cwd: string } & AsyncDisposable> {
  const directory = await fs.mkdtempDisposable(path.join(os.tmpdir(), 'tsdown-canary-'))
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
    JSON.stringify({ name: 'canary', type: 'module', devDependencies: { 'fixture-peer': '*' } }),
  )
  await fs.writeFile(
    path.join(cwd, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { declaration: true, isolatedDeclarations: true, skipLibCheck: true },
    }),
  )
  await fs.writeFile(path.join(cwd, 'index.ts'), source)
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
    [Symbol.asyncDispose]: async () => directory[Symbol.asyncDispose](),
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
  await using project = await withCanaryProject('export { type Value } from "fixture-peer"')
  await expect(build(project.config)).rejects.toThrow('deps.onlyImport')
})
