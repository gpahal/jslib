import path from 'node:path'

import { escapeGlob, folderGlob, joinSiblingGlob, rebaseGlob } from '@/internal/globs'
import type { GitIgnores } from '@/internal/project-scan'
import { findRootSpellings, GUARDS_PLUGIN } from '@/internal/root-spelling'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * Not `build`, `out`, `target` or `tmp`, which can name source folders, such as
 * `src/commands/build`. Vite and Vitest write `*.timestamp-*` bundles next to a config they load
 */
export const IGNORES: Array<string> = [
  '**/_gen',
  '**/_generated',
  '**/*.gen',
  '**/*.generated',
  '**/*.gen.*',
  '**/*.generated.*',
  '**/*.min.*',
  '**/dist',
  '**/out-tsc',
  '**/.output',
  '**/.turbo',
  '**/.next',
  '**/.vercel',
  '**/.astro',
  '**/.nitro',
  '**/.tanstack',
  '**/.tmp',
  '**/.cache',
  '**/coverage',
  '**/storybook-static',
  '**/.svelte-kit',
  '**/.nuxt',
  '**/.docusaurus',
  '**/.wrangler',
  '**/.vitepress/cache',
  '**/vite.config.*.timestamp-*',
  '**/vitest.config.*.timestamp-*',
  '**/.yarn/releases',
  '**/.yarn/plugins',
  '**/node_modules',
  '**/.history',
  '**/.idea',
  '**/.idea_modules',
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/bun.lock',
  '**/bun.lockb',
]

/**
 * The git ignore globs are rebased onto `root`, the finalizer's `basePath`, so deeper ignore files
 * can un-ignore what earlier ones ignored
 */
export function ignores({
  gitignores,
  ignores: globs,
  root,
}: {
  gitignores: Array<GitIgnores>
  ignores: Array<string>
  root: string
}): Array<TypedConfig> {
  return [
    ...gitignores.map(({ name, basePath, folders, ignores: gitignoreGlobs }) => ({
      name,
      ignores: gitignoreGlobs.flatMap((glob) =>
        rebaseGlob(folders === undefined ? glob : joinSiblingGlob(folders, glob), basePath, root),
      ),
    })),
    {
      name: 'gpahal/ignores/defaults',
      ignores: globs,
    },
  ]
}

/**
 * Each name matched in any case
 */
function anyCaseGlob(top: string, dir: string): string {
  return escapeGlob(path.relative(top, dir).split(path.sep).join('/')).replaceAll(
    /\p{L}/gu,
    (char) =>
      char.toLowerCase() === char.toUpperCase()
        ? char
        : `[${char.toLowerCase()}${char.toUpperCase()}]`,
  )
}

/**
 * Throws for a file reached through another spelling of `root`, such as a symbolic link, a junction
 * or another case. No config holds a function in `files`, which @eslint/config-inspector rejects:
 *
 * - `gpahal/root-spelling/links` gives the other spellings' files a checking language, matching
 *   nothing else, since a language would replace other configs' language
 * - `gpahal/root-spelling/outside` checks files outside root that another config lints
 * - `gpahal/root-spelling` checks every file a config of root's applies to
 */
export function rootSpellingConfigs(
  root: string,
  configs: ReadonlyArray<TypedConfig>,
): Array<TypedConfig> {
  const top = path.parse(root).root
  const names = [
    ...new Set(
      configs.flatMap((config) =>
        (config.files ?? []).filter(
          (glob): glob is string =>
            typeof glob === 'string' && /^\*\*\/[^/]+$/.test(glob) && glob !== '**/*',
        ),
      ),
    ),
  ]
  const baseIgnores = Array.from(new Set(configs.map(({ basePath }) => basePath ?? root)), (dir) =>
    folderGlob(top, dir),
  )
  const { folders, isCaseInsensitive } = findRootSpellings(root)
  const spellingGlobs = [
    ...folders.map((dir) => folderGlob(top, dir).replace(/\*\*$/, '')),
    ...(isCaseInsensitive ? [`${anyCaseGlob(top, root)}/`] : []),
  ]
  const files = spellingGlobs.flatMap((prefix) => names.map((name) => `${prefix}${name}`))
  return [
    ...(files.length === 0
      ? []
      : [
          {
            name: 'gpahal/root-spelling/links',
            basePath: top,
            files,
            ignores: baseIgnores,
            plugins: { '@gpahal/guards': GUARDS_PLUGIN },
            language: '@gpahal/guards/root-spelling',
            languageOptions: { root },
          },
        ]),
    {
      name: 'gpahal/root-spelling/outside',
      basePath: top,
      ignores: baseIgnores,
      plugins: { '@gpahal/guards': GUARDS_PLUGIN },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The composer's rule types leave out the guard's rule, which it can't reach
      rules: { '@gpahal/guards/root-spelling-outside': ['error', { root }] } as TypedRules,
    },
    {
      name: 'gpahal/root-spelling',
      basePath: root,
      plugins: { '@gpahal/guards': GUARDS_PLUGIN },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The composer's rule types leave out the guard's rule, which it can't reach
      rules: { '@gpahal/guards/root-spelling': ['error', { root }] } as TypedRules,
    },
  ]
}
