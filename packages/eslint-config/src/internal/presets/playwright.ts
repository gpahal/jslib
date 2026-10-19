import type { FileSpecs } from '@/internal/globs'
import { named, withSetup } from '@/internal/naming'
import { importPeers, interopDefault } from '@/internal/peers'
import type { TypedConfig } from '@/internal/types'
import { getPluginConfig } from '@/internal/utils'

export const PLAYWRIGHT_PEERS: Array<string> = ['eslint-plugin-playwright']

/**
 * eslint-plugin-playwright's recommended config for `files`, `playwright.files`, with its globals
 * and `no-empty-pattern` off, since a test that takes no fixture destructures `{}`
 */
export async function playwright({ files }: { files: FileSpecs }): Promise<Array<TypedConfig>> {
  const eslintPluginPlaywright = await importPeers('playwright', PLAYWRIGHT_PEERS, async () =>
    interopDefault(import('eslint-plugin-playwright')),
  )
  return withSetup('playwright', [
    ...named('playwright', { files }, [
      {
        ...getPluginConfig(eslintPluginPlaywright, 'flat/recommended'),
        name: 'recommended',
      },
    ]),
  ])
}
