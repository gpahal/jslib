import { withTmpProject } from '@gpahal/internal/node/testing'

/**
 * A temporary project for tsdown builds, named `name`, with `files` and `fixture-peer`, a dev
 * dependency of only types for the builds to leave unbundled. Its tsconfig emits isolated
 * declarations
 */
export async function withPeerProject(
  name: string,
  files: Readonly<Record<string, string>>,
): Promise<AsyncDisposable & { dir: string }> {
  return withTmpProject(`tsdown-${name}`, {
    'node_modules/fixture-peer/package.json': JSON.stringify({
      name: 'fixture-peer',
      types: 'index.d.ts',
    }),
    'node_modules/fixture-peer/index.d.ts': 'export type Value = string',
    'package.json': JSON.stringify({
      name,
      type: 'module',
      devDependencies: { 'fixture-peer': '*' },
    }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: { declaration: true, isolatedDeclarations: true, skipLibCheck: true },
    }),
    ...files,
  })
}
