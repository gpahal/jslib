import { withSetup } from '@/internal/naming'
import { importPeers, interopDefault } from '@/internal/peers'
import type { TypedConfig, TypedRules } from '@/internal/types'
import { getPluginConfig } from '@/internal/utils'

export const TURBO_PEERS: Array<string> = ['eslint-plugin-turbo']

/**
 * Off in Markdown code blocks, which show examples, not code that Turbo runs
 */
export const TURBO_CODE_BLOCK_RULES: TypedRules = {
  'turbo/no-undeclared-env-vars': 'off',
}

/**
 * For `files`, the code files, including `.astro` files with the `astro` preset
 */
export async function turbo({ files }: { files: Array<string> }): Promise<Array<TypedConfig>> {
  const eslintPluginTurbo = await importPeers('turbo', TURBO_PEERS, async () =>
    interopDefault(import('eslint-plugin-turbo')),
  )
  const recommended = getPluginConfig(eslintPluginTurbo, 'flat/recommended')
  return withSetup('turbo', [
    {
      name: 'gpahal/turbo/rules',
      files,
      plugins: {
        turbo: eslintPluginTurbo,
      },
      ...(recommended.settings && { settings: recommended.settings }),
      ...(recommended.rules && { rules: recommended.rules }),
    },
  ])
}
