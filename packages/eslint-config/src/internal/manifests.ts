/**
 * The `package.json` manifests at `root` and of its workspace packages, for framework detection.
 * Contract: `root` is an absolute folder, and every file is untrusted, so a broken manifest or
 * workspace file is skipped, not thrown on
 */

import fs from 'node:fs'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'

import { isRecord } from '@gpahal/std/objects'
import { trimEnd } from '@gpahal/std/strings'

import { IGNORES } from '@/internal/configs/ignores'
import { readJsonFile } from '@/internal/fs'
import { findGitRoot } from '@/internal/git'
import { createGlobMatcher, splitGlobs } from '@/internal/globs'

/**
 * With its `/`-separated path relative to `root`
 */
export type ProjectManifest = {
  file: string
  manifest: Record<string, unknown>
  isWorkspacePackage: boolean
}

/**
 * So a workspace glob such as `**` in a large tree stays quick
 */
const MAX_WORKSPACE_MANIFESTS = 200

const MAX_WORKSPACE_FOLDERS = 5000

/**
 * For a glob with `**`
 */
const MAX_WORKSPACE_DEPTH = 6

const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set(
  IGNORES.flatMap((glob) => /^\*\*\/([^*/]+)$/.exec(glob)?.[1] ?? []),
)

/**
 * None when it doesn't parse or `packages` isn't a list
 */
function parsePnpmWorkspaceGlobs(text: string): Array<string> {
  let workspace: unknown
  try {
    // `error` throws on a parse error and skips the default level's warnings
    workspace = parseYaml(text, { logLevel: 'error' })
  } catch {
    return []
  }
  const globs = isRecord(workspace) ? workspace['packages'] : undefined
  return Array.isArray(globs) ? globs.filter((glob) => typeof glob === 'string') : []
}

/**
 * As pnpm reads them
 */
function normalizeWorkspaceGlobs(globs: ReadonlyArray<string>): Array<string> {
  return globs.map((glob) => trimEnd(glob.replace(/^(?:\.\/)+/, ''), '/'))
}

function readTextFile(file: string): string | undefined {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true
      ? fs.readFileSync(file, 'utf8')
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The nearest `pnpm-workspace.yaml`, up to the git root, is at `root` or its `packages` match it or
 * a folder between them. A stray file above the repository, or a workspace an npm project sits in
 * without being a package of, doesn't count
 */
export function isInPnpmWorkspace(root: string): boolean {
  const gitRoot = findGitRoot(root)
  for (let dir = root; ; dir = path.dirname(dir)) {
    const text = readTextFile(path.join(dir, 'pnpm-workspace.yaml'))
    if (text !== undefined) {
      const relative = path.relative(dir, root).split(path.sep).join('/')
      if (relative === '') {
        return true
      }
      const { positive, negated } = splitGlobs(
        normalizeWorkspaceGlobs(parsePnpmWorkspaceGlobs(text)),
      )
      const isMatch = createGlobMatcher(positive)
      const isExcluded = createGlobMatcher(negated)
      const segments = relative.split('/')
      return segments.some((_, index) => {
        const folder = segments.slice(0, index + 1).join('/')
        return isMatch(folder) && !isExcluded(folder)
      })
    }
    if (dir === gitRoot || path.dirname(dir) === dir) {
      return false
    }
  }
}

/**
 * `pnpm-workspace.yaml`'s `packages`, or else `package.json`'s `workspaces`
 */
function getWorkspaceGlobs(
  root: string,
  manifest: Record<string, unknown> | undefined,
): Array<string> {
  const text = readTextFile(path.join(root, 'pnpm-workspace.yaml'))
  if (text !== undefined) {
    return parsePnpmWorkspaceGlobs(text)
  }
  const workspaces = manifest?.['workspaces']
  const globs = isRecord(workspaces) ? workspaces['packages'] : workspaces
  return Array.isArray(globs) ? globs.filter((glob) => typeof glob === 'string') : []
}

/**
 * Breadth first, skipping dot folders, symbolic links and `SKIPPED_FOLDER_NAMES`, within the limits
 */
function findWorkspaceFolders(root: string, globs: ReadonlyArray<string>): Array<string> {
  const { positive, negated } = splitGlobs(normalizeWorkspaceGlobs(globs))
  if (positive.length === 0) {
    return []
  }
  const isMatch = createGlobMatcher(positive)
  const isExcluded = createGlobMatcher(negated)
  const maxDepth = Math.min(
    MAX_WORKSPACE_DEPTH,
    Math.max(
      ...positive.map((glob) =>
        glob.includes('**') ? MAX_WORKSPACE_DEPTH : glob.split('/').length,
      ),
    ),
  )
  const found: Array<string> = []
  const queue: Array<string> = ['']
  let visited = 0
  for (let index = 0; index < queue.length && visited < MAX_WORKSPACE_FOLDERS; index++) {
    const folder = queue[index] ?? ''
    visited++
    let entries: Array<fs.Dirent>
    try {
      entries = fs.readdirSync(path.join(root, folder), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith('.') ||
        SKIPPED_FOLDER_NAMES.has(entry.name)
      ) {
        continue
      }
      const relative = folder === '' ? entry.name : `${folder}/${entry.name}`
      if (isMatch(relative) && !isExcluded(relative)) {
        found.push(relative)
      }
      if (relative.split('/').length < maxDepth) {
        queue.push(relative)
      }
    }
  }
  return found
}

export function readProjectManifests(root: string): Array<ProjectManifest> {
  const rootManifest = readJsonFile(path.join(root, 'package.json'))
  const manifests: Array<ProjectManifest> = isRecord(rootManifest)
    ? [{ file: 'package.json', manifest: rootManifest, isWorkspacePackage: false }]
    : []
  const folders = findWorkspaceFolders(
    root,
    getWorkspaceGlobs(root, isRecord(rootManifest) ? rootManifest : undefined),
  )
  for (const folder of folders.slice(0, MAX_WORKSPACE_MANIFESTS)) {
    const manifest = readJsonFile(path.join(root, folder, 'package.json'))
    if (isRecord(manifest)) {
      manifests.push({ file: `${folder}/package.json`, manifest, isWorkspacePackage: true })
    }
  }
  return manifests
}

export function getListedPackages(manifest: Record<string, unknown>): Set<string> {
  return new Set(
    [manifest['dependencies'], manifest['devDependencies']].flatMap((dependencies) =>
      isRecord(dependencies) ? Object.keys(dependencies) : [],
    ),
  )
}

/**
 * A public workspace package's dev dependencies are for its tests and build, and its optional peers
 * for its users, so only `dependencies` and required peers count
 */
function getSuggestingPackages({ manifest, isWorkspacePackage }: ProjectManifest): Set<string> {
  if (!isWorkspacePackage || manifest['private'] === true) {
    return getListedPackages(manifest)
  }
  const { dependencies, peerDependencies, peerDependenciesMeta } = manifest
  const isOptional = (name: string) => {
    const meta = isRecord(peerDependenciesMeta) ? peerDependenciesMeta[name] : undefined
    return isRecord(meta) && meta['optional'] === true
  }
  return new Set([
    ...(isRecord(dependencies) ? Object.keys(dependencies) : []),
    ...(isRecord(peerDependencies) ? Object.keys(peerDependencies) : []).filter(
      (name) => !isOptional(name),
    ),
  ])
}

export function findListingManifest(
  manifests: ReadonlyArray<ProjectManifest>,
  packageName: string,
): ProjectManifest | undefined {
  return manifests.find((manifest) => getSuggestingPackages(manifest).has(packageName))
}
