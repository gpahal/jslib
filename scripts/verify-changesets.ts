/**
 * Fails when the branch changes what a published package ships, or the source of a private package
 * that a published package's shipped modules import and its build bundles, such as
 * `@gpahal/internal`, without a changeset that names that published package. It also fails when
 * `changeset status` does, which it does when a published package changed and the branch has no
 * changeset at all. `changeset status` alone passes once any changeset exists, even an empty one or
 * one for another package, and skips private packages.
 *
 * Usage: `pnpm verify-changesets [--since <ref>]`, where `<ref>` defaults to
 * `origin/main`. It compares the working tree with where the branch left `<ref>`, so uncommitted
 * changes count. `changeset status` reads only tracked changesets, so it fails on untracked ones
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

type WorkspacePackage = {
  dir: string
  name: string
  isPrivate: boolean
  files: Array<string> | undefined
}

const collator = new Intl.Collator('en')

function git(...args: Array<string>): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function lines(output: string): Array<string> {
  return output.split('\n').filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPackage(dir: string): WorkspacePackage | undefined {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(manifest) || typeof manifest.name !== 'string') {
    return undefined
  }
  return {
    dir,
    name: manifest.name,
    isPrivate: manifest.private === true,
    files: Array.isArray(manifest.files)
      ? manifest.files.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  }
}

function matchesEntry(file: string, entry: string): boolean {
  return file === entry || file.startsWith(`${entry}/`) || path.posix.matchesGlob(file, entry)
}

/**
 * Whether npm packs `file`, relative to the package. npm packs `package.json`, the README and the
 * license whatever `files` lists, and everything when `files` is missing
 */
function isShipped(pkg: WorkspacePackage, file: string): boolean {
  if (
    file === 'package.json' ||
    /^(?:readme|license|licence)(?:\..*)?$/iu.test(file) ||
    pkg.files === undefined
  ) {
    return true
  }
  return (
    pkg.files.some((entry) => !entry.startsWith('!') && matchesEntry(file, entry)) &&
    pkg.files.every((entry) => !entry.startsWith('!') || !matchesEntry(file, entry.slice(1)))
  )
}

/**
 * Whether a shipped module of `pkg` imports `name` or one of its subpaths. A dependency that only
 * tests or configs import, such as tsconfig's on `@gpahal/internal`, ships nothing
 */
function bundles(pkg: WorkspacePackage, name: string): boolean {
  return lines(git('ls-files', '--', pkg.dir))
    .map((file) => file.slice(pkg.dir.length + 1))
    .filter((file) => /\.[cm]?[jt]sx?$/u.test(file) && isShipped(pkg, file))
    .some((file) => {
      const source = readFileSync(path.join(pkg.dir, file), 'utf8')
      return [`'${name}'`, `'${name}/`, `"${name}"`, `"${name}/`].some((specifier) =>
        source.includes(specifier),
      )
    })
}

/**
 * The packages that the changesets of a `changeset status --output` file bump
 */
function readNamedPackages(statusFile: string): Set<string> {
  const plan: unknown = JSON.parse(readFileSync(statusFile, 'utf8'))
  const named = new Set<string>()
  if (!isRecord(plan) || !Array.isArray(plan.changesets)) {
    return named
  }
  for (const changeset of plan.changesets) {
    if (!isRecord(changeset) || !Array.isArray(changeset.releases)) {
      continue
    }
    for (const release of changeset.releases) {
      if (isRecord(release) && typeof release.name === 'string' && release.type !== 'none') {
        named.add(release.name)
      }
    }
  }
  return named
}

/**
 * Runs `changeset status`, and returns the packages its changesets bump, or `undefined` on failure
 */
function readChangesetStatus(base: string): Set<string> | undefined {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'verify-changesets-'))
  try {
    const outputFile = path.join(outputDir, 'status.json')
    const status = spawnSync(
      'pnpm',
      ['exec', 'changeset', 'status', '--since', base, '--output', outputFile],
      { encoding: 'utf8' },
    )
    if (status.status !== 0) {
      console.error(`${status.stdout}${status.stderr}`.trim())
      return undefined
    }
    return readNamedPackages(outputFile)
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
}

function main(): number {
  const { values } = parseArgs({ options: { since: { type: 'string', default: 'origin/main' } } })
  process.chdir(git('rev-parse', '--show-toplevel'))
  const base = git('merge-base', values.since, 'HEAD')
  const untracked = lines(git('ls-files', '--others', '--exclude-standard'))
  const changedFiles = [...lines(git('diff', '--name-only', '--no-relative', base)), ...untracked]

  const untrackedChangesets = untracked.filter((file) => /^\.changeset\/[^/]+\.md$/u.test(file))
  if (untrackedChangesets.length > 0) {
    console.error(
      `Untracked changesets: ${untrackedChangesets.join(', ')}. Stage them with \`git add\` first`,
    )
    return 1
  }

  const packages = readdirSync('packages', { withFileTypes: true }).flatMap((entry) => {
    const pkg = entry.isDirectory()
      ? readPackage(path.posix.join('packages', entry.name))
      : undefined
    return pkg === undefined ? [] : [pkg]
  })
  const changedFilesOf = (pkg: WorkspacePackage): Array<string> =>
    changedFiles
      .filter((file) => file.startsWith(`${pkg.dir}/`))
      .map((file) => file.slice(pkg.dir.length + 1))

  // Each published package that a changeset must name, with the changed files that make it so
  const required = new Map<string, Array<string>>()
  const addRequired = (name: string, files: Array<string>): void => {
    required.set(name, [...(required.get(name) ?? []), ...files])
  }
  const publishedPackages = packages.filter((pkg) => !pkg.isPrivate)
  for (const pkg of publishedPackages) {
    const shipped = changedFilesOf(pkg).filter((file) => isShipped(pkg, file))
    if (shipped.length > 0) {
      addRequired(
        pkg.name,
        shipped.map((file) => `${pkg.dir}/${file}`),
      )
    }
  }
  for (const pkg of packages) {
    const bundled = pkg.isPrivate
      ? changedFilesOf(pkg).filter((file) => file.startsWith('src/'))
      : []
    if (bundled.length === 0) {
      continue
    }
    for (const dependent of publishedPackages) {
      if (bundles(dependent, pkg.name)) {
        addRequired(
          dependent.name,
          bundled.map((file) => `${pkg.dir}/${file}`),
        )
      }
    }
  }

  const named = readChangesetStatus(base)
  if (named === undefined) {
    return 1
  }
  const missing = [...required]
    .filter(([name]) => !named.has(name))
    .toSorted(([a], [b]) => collator.compare(a, b))
  if (missing.length > 0) {
    console.error('No changeset names these packages, whose shipped or bundled files changed:')
    for (const [name, files] of missing) {
      const more = files.length > 3 ? `, and ${files.length - 3} more` : ''
      console.error(`- ${name}: ${files.slice(0, 3).join(', ')}${more}`)
    }
    console.error('Add a changeset that names each of them, as AGENTS.md describes')
    return 1
  }

  console.log(
    required.size > 0
      ? `Changesets name every package whose shipped or bundled files changed: ${required.keys().toArray().toSorted(collator.compare).join(', ')}`
      : 'No shipped or bundled files of a published package changed',
  )
  return 0
}

process.exitCode = main()
