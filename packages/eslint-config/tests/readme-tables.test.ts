import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { AREAS } from '@/internal/areas'
import { MARKDOWN_PLUGIN } from '@/internal/markdown/plugin'
import { GPAHAL_PLUGIN } from '@/internal/plugin'
import type { EslintConfigOptions } from '@/internal/types'

import { collator } from './helpers'

const REPO_DIR = path.join(import.meta.dirname, '..', '..', '..')

const README = await fs.readFile(path.join(import.meta.dirname, '..', 'README.md'), 'utf8')

const ROOT_README = await fs.readFile(path.join(REPO_DIR, 'README.md'), 'utf8')

/**
 * The rows of the first table with the header line `header` in the section `section` of `readme`,
 * as lists of cells, without the header and separator rows
 */
function tableRows(section: string, header: string, readme = README): Array<Array<string>> {
  const lines = readme.slice(readme.indexOf(`\n${section}\n`)).split('\n')
  const start = lines.indexOf(header)
  if (start === -1) {
    throw new Error(`the README has no table with the header ${header} in ${section}`)
  }
  const body = lines.slice(start + 2)
  const end = body.findIndex((line) => !line.startsWith('|'))
  return body.slice(0, end === -1 ? undefined : end).map((line) =>
    line
      .slice(1, -1)
      .split(' | ')
      .map((cell) => cell.trim().replaceAll(String.raw`\|`, '|')),
  )
}

/**
 * The text in backticks in `cell`
 */
function codeSpans(cell: string): Array<string> {
  return cell
    .matchAll(/`([^`]+)`/gu)
    .map((match) => match[1] ?? '')
    .toArray()
}

function sorted(values: Iterable<string>): Array<string> {
  return [...values].toSorted((a, b) => collator.compare(a, b))
}

test('the peer table lists the plugins each preset needs', () => {
  // `astro` checks that eslint-plugin-jsx-a11y-x is installed where ESLint runs, which
  // eslint-plugin-astro loads it from, rather than as a peer of this package
  const extra: Record<string, Array<string>> = { astro: ['eslint-plugin-jsx-a11y-x'] }
  const listed: Record<string, Array<string>> = {}
  for (const [optionCell, installCell] of tableRows('## Install', '| Option | Install |')) {
    const [option = ''] = codeSpans(optionCell ?? '')
    const spans = codeSpans(installCell ?? '')
    // "The `react` plugins and …"
    const packages = spans.flatMap((span) =>
      installCell?.includes(`The \`${span}\` plugins`) === true
        ? (listed[span] ?? [])
        : /eslint|^tailwindcss$/u.test(span)
          ? span
          : [],
    )
    listed[option] = sorted(packages)
  }
  const expected = Object.fromEntries(
    Object.entries(AREAS).flatMap(([name, area]) => {
      if (name !== 'node' && area.peers === undefined) {
        return []
      }
      const options = { root: '/', [name]: true } as EslintConfigOptions
      const peers = typeof area.peers === 'function' ? area.peers(options) : (area.peers ?? [])
      return [[name, sorted(new Set([...peers, ...(extra[name] ?? [])]))]]
    }),
  )
  expect(listed).toEqual(expected)
})

test('the own rules table lists every rule of `@gpahal`', () => {
  const listed = tableRows('### Own rules', '| Rule | Reports |').flatMap(([rule = '']) =>
    codeSpans(rule),
  )
  expect(sorted(listed)).toEqual(
    sorted(Object.keys(GPAHAL_PLUGIN.rules).map((rule) => `@gpahal/${rule}`)),
  )
})

test('the Markdown rules table lists every rule of `@gpahal/markdown`, in order', () => {
  const listed = tableRows('### Markdown rules', '| Rule | Reports |').flatMap(([rule = '']) =>
    codeSpans(rule),
  )
  expect(listed).toEqual(
    sorted(Object.keys(MARKDOWN_PLUGIN.rules ?? {})).map((rule) => `@gpahal/markdown/${rule}`),
  )
})

/**
 * "None", "`name` `range`, …", or `readmeLink` to the package README's list when there are many
 */
function peerCell(peers: Array<[string, string]>, readmeLink: string): string {
  if (peers.length === 0) {
    return 'None'
  }
  return peers.length > 3
    ? readmeLink
    : peers.map(([name, range]) => `\`${name}\` \`${range}\``).join(', ')
}

test('the root compatibility table matches the published manifests', async () => {
  type Manifest = {
    name: string
    private?: boolean
    engines?: { node?: string }
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }
  const entries = await fs.readdir(path.join(REPO_DIR, 'packages'), { withFileTypes: true })
  // Only folders with a manifest, so a stray file such as `.DS_Store` doesn't count
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dir) => existsSync(path.join(REPO_DIR, 'packages', dir, 'package.json')))
  const manifests = await Promise.all(
    dirs.map(async (dir) => ({
      dir,
      manifest: JSON.parse(
        await fs.readFile(path.join(REPO_DIR, 'packages', dir, 'package.json'), 'utf8'),
      ) as Manifest,
    })),
  )
  // Packages that also run in browsers, where `engines.node` doesn't apply
  const BROWSER_SAFE = new Set(['@gpahal/std'])
  const rows = tableRows(
    '## Supported setups',
    '| Package | Node | Required peers | Optional peers |',
    ROOT_README,
  )
  const published = new Map(
    manifests
      .filter(({ manifest }) => manifest.private !== true)
      .map(({ dir, manifest }) => [manifest.name, { dir, manifest }]),
  )
  const names = rows.map(([cell = '']) => codeSpans(cell)[0] ?? '')
  expect(sorted(names)).toEqual(sorted(published.keys()))
  const expected = names.map((name) => {
    const { dir, manifest } = published.get(name) ?? { dir: '', manifest: { name } }
    const peers = Object.entries(manifest.peerDependencies ?? {})
    const isOptional = ([peer]: [string, string]): boolean =>
      manifest.peerDependenciesMeta?.[peer]?.optional === true
    return [
      `\`${name}\``,
      manifest.engines?.node === undefined
        ? 'Any'
        : `\`${manifest.engines.node}\`${BROWSER_SAFE.has(name) ? ' in Node; any modern browser' : ''}`,
      peerCell(
        peers.filter((peer) => !isOptional(peer)),
        '',
      ),
      peerCell(
        peers.filter((peer) => isOptional(peer)),
        `${peers.some(([peer]) => peer === 'typescript' && isOptional([peer, ''])) ? '`typescript` and the' : 'The'} plugins of each preset, listed in [Install](packages/${dir}/README.md#install)`,
      ),
    ]
  })
  expect(rows).toEqual(expected)
})
