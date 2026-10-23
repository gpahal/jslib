import path from 'node:path'

import { resolvePathOption } from '@gpahal/internal/node/paths'

import { ASTRO_FILES } from '@/internal/files'
import { intersectFiles, type FileSpecs } from '@/internal/globs'
import { named, withSetup } from '@/internal/naming'
import { assertInstalledIn, importPeers, interopDefault } from '@/internal/peers'
import type { TypedConfig } from '@/internal/types'
import { PREFIX } from '@/internal/utils'

const CLASS_ORDER_RULE = 'better-tailwindcss/enforce-consistent-class-order'

export const TAILWINDCSS_PEERS: Array<string> = ['eslint-plugin-better-tailwindcss', 'tailwindcss']

function resolveSetting(root: string, value: unknown): string | undefined {
  return typeof value === 'string' ? path.resolve(root, value) : undefined
}

/**
 * `entryPoint` and `cwd` resolve against `root`, not ESLint's working directory
 */
export async function tailwindcss(
  { files, astro, root }: { files: FileSpecs; astro: boolean; root: string },
  entryPoint: string | URL,
  pluginSettings: Record<string, unknown>,
): Promise<Array<TypedConfig>> {
  const [eslintPluginBetterTailwindcss, { getDefaultSelectors }, { SelectorKind }] =
    await importPeers('tailwindcss', TAILWINDCSS_PEERS, async () =>
      Promise.all([
        interopDefault(import('eslint-plugin-better-tailwindcss')),
        import('eslint-plugin-better-tailwindcss/api/defaults'),
        import('eslint-plugin-better-tailwindcss/api/types'),
      ]),
    )
  // The plugin disables its rules when Tailwind CSS isn't in `cwd`
  const cwd = resolveSetting(root, pluginSettings['cwd']) ?? root
  assertInstalledIn({
    option: 'tailwindcss',
    packages: ['tailwindcss'],
    dir: cwd,
    reason: "eslint-plugin-better-tailwindcss's `cwd` setting points",
  })
  const settings = {
    ...pluginSettings,
    cwd,
    entryPoint: resolvePathOption(entryPoint, root, {
      prefix: PREFIX,
      name: 'tailwindcss.entryPoint',
    }),
  }
  const defaultSelectors = getDefaultSelectors()
  // prettier-plugin-tailwindcss sorts class attributes and `tailwindFunctions` calls, not variables
  const variableSelectors = defaultSelectors.filter(({ kind }) => kind === SelectorKind.Variable)
  return withSetup('tailwindcss', [
    ...named('tailwindcss', { files }, [
      { ...eslintPluginBetterTailwindcss.configs.recommended, name: 'recommended' },
    ]),
    {
      name: 'gpahal/tailwindcss/rules',
      files,
      settings: { 'better-tailwindcss': settings },
      rules: {
        // Prettier owns line breaks
        'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
        [CLASS_ORDER_RULE]: ['error', { selectors: variableSelectors }],
      },
    },
    // prettier-plugin-tailwindcss can't sort `.astro` files. `fixes.ts` keeps the fix for a native
    // element's `class` there. The selectors repeat, since a severity alone keeps earlier options
    ...(astro
      ? [
          {
            name: 'gpahal/tailwindcss/astro',
            files: intersectFiles(files, ASTRO_FILES),
            rules: { [CLASS_ORDER_RULE]: ['error', { selectors: defaultSelectors }] },
          } satisfies TypedConfig,
        ]
      : []),
  ])
}
