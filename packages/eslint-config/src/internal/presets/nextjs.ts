import fs from 'node:fs'
import path from 'node:path'

import { CODE_EXTNS } from '@/internal/files'
import { folderGlob, intersectFiles, intersectFileSpecs, type FileSpecs } from '@/internal/globs'
import { withSetup } from '@/internal/naming'
import {
  NEXTJS_CLIENT_ENTRY_NAMES,
  NEXTJS_SERVER_ENTRY_NAMES,
} from '@/internal/nextjs-server-component'
import { importPeers, interopDefault } from '@/internal/peers'
import type { TypedConfig } from '@/internal/types'

/**
 * On top of the `react` ones
 */
export const NEXTJS_PEERS: Array<string> = ['@next/eslint-plugin-next']

function findPagesDir(rootDir: string): string | undefined {
  return [path.join(rootDir, 'pages'), path.join(rootDir, 'src', 'pages')].find((dir) =>
    fs.existsSync(dir),
  )
}

function appEntryGlob(root: string, rootDir: string): string {
  const prefix = folderGlob(root, rootDir).slice(0, -'**'.length)
  const names = [...NEXTJS_SERVER_ENTRY_NAMES, ...NEXTJS_CLIENT_ENTRY_NAMES].join(',')
  return `${prefix}{app,src/app}/**/{${names}}.{${CODE_EXTNS.join(',')}}`
}

/**
 * Each app gets its own `no-html-link-for-pages` config, since the rule reads every
 * `settings.next.rootDir`. Without a `pages` folder it's off, since it would print "Pages directory
 * cannot be found" on every run
 */
export async function nextjs({
  root,
  files,
  rootDirs,
  serverFiles,
}: {
  root: string
  files: FileSpecs
  rootDirs: Array<string>
  serverFiles: FileSpecs
}): Promise<Array<TypedConfig>> {
  const eslintPluginNext = await importPeers('nextjs', NEXTJS_PEERS, async () =>
    interopDefault(import('@next/eslint-plugin-next')),
  )
  const entryFiles = intersectFiles(
    files,
    rootDirs.map((rootDir) => appEntryGlob(root, rootDir)),
  )
  return withSetup('nextjs', [
    {
      name: 'gpahal/nextjs/rules',
      files,
      plugins: {
        '@next/next': eslintPluginNext,
      },
      settings: { next: { rootDir: rootDirs } },
      // `core-web-vitals` includes every `recommended` rule
      rules: {
        ...eslintPluginNext.configs['core-web-vitals'].rules,
        '@next/next/no-html-link-for-pages': 'off',
      },
    },
    {
      name: 'gpahal/nextjs/server-components',
      files: entryFiles,
      rules: {
        '@gpahal/nextjs-server-component': 'error',
      },
    },
    ...(serverFiles.length > 0
      ? [
          {
            name: 'gpahal/nextjs/server-files',
            files: intersectFileSpecs(entryFiles, serverFiles),
            rules: {
              '@gpahal/nextjs-server-component': ['error', { ignoresBrowserGlobals: true }],
            },
          } satisfies TypedConfig,
        ]
      : []),
    ...rootDirs.flatMap((rootDir): Array<TypedConfig> => {
      const pagesDir = findPagesDir(rootDir)
      return pagesDir === undefined
        ? []
        : [
            {
              name: 'gpahal/nextjs/pages-links',
              files: intersectFiles(files, [folderGlob(root, rootDir)]),
              settings: { next: { rootDir } },
              rules: { '@next/next/no-html-link-for-pages': ['error', [pagesDir]] },
            },
          ]
    }),
  ])
}
