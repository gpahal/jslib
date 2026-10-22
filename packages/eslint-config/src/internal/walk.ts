import fs from 'node:fs'
import path from 'node:path'

import { createGlobMatcher, withoutLeadingDotSlash } from '@/internal/globs'

/**
 * As an ESLint global ignores config holds them
 */
export type IgnoreLayer = {
  basePath: string
  ignores: ReadonlyArray<string>
}

type GlobMatcher = (relativePath: string) => boolean

/**
 * Each glob is compiled once per walk
 */
type GlobMatchers = Map<string, GlobMatcher>

function getMatcher(glob: string, matchers: GlobMatchers): GlobMatcher {
  let matcher = matchers.get(glob)
  if (matcher === undefined) {
    // `/`-separated paths, dotfiles and a leading `./`, as ESLint matches them
    matcher = createGlobMatcher(withoutLeadingDotSlash(glob))
    matchers.set(glob, matcher)
  }
  return matcher
}

/**
 * A glob ending in `/` matches folders only
 */
function matchesGlob(
  relativePath: string,
  isFolder: boolean,
  glob: string,
  matchers: GlobMatchers,
): boolean {
  return glob.endsWith('/')
    ? isFolder && getMatcher(glob.slice(0, -1), matchers)(relativePath)
    : getMatcher(glob, matchers)(relativePath)
}

type OrderedLayer = IgnoreLayer & {
  group: number
  index: number
}

/**
 * Indexed by base path, so a path is checked only against the layers above it, not every layer,
 * which is quadratic in a monorepo. Ordered by group, then insertion, so a walk can add
 * `.gitignore` layers between the ones before and after them
 */
export class IgnoreLayers {
  readonly #byBasePath = new Map<string, Array<OrderedLayer>>()
  /**
   * Cleared when a layer is added
   */
  readonly #aboveByFolder = new Map<string, Array<OrderedLayer>>()
  #count = 0

  constructor(layers: ReadonlyArray<IgnoreLayer> = []) {
    for (const layer of layers) {
      this.add(layer)
    }
  }

  add({ basePath, ignores }: IgnoreLayer, group = 0): void {
    if (ignores.length === 0) {
      return
    }
    this.#aboveByFolder.clear()
    const key = path.resolve(basePath)
    let layers = this.#byBasePath.get(key)
    if (layers === undefined) {
      layers = []
      this.#byBasePath.set(key, layers)
    }
    layers.push({ basePath: key, ignores, group, index: this.#count++ })
  }

  above(absolutePath: string): ReadonlyArray<OrderedLayer> {
    const parent = path.dirname(absolutePath)
    const cached = this.#aboveByFolder.get(parent)
    if (cached !== undefined) {
      return cached
    }
    const layers: Array<OrderedLayer> = []
    for (
      let folder = parent, child = absolutePath;
      folder !== child;
      child = folder, folder = path.dirname(folder)
    ) {
      const folderLayers = this.#byBasePath.get(folder)
      if (folderLayers !== undefined) {
        layers.push(...folderLayers)
      }
    }
    const sorted = layers.toSorted((a, b) =>
      a.group === b.group ? a.index - b.index : a.group - b.group,
    )
    this.#aboveByFolder.set(parent, sorted)
    return sorted
  }
}

/**
 * As ESLint applies global ignores: globs skip paths outside their `basePath`, a match ignores, and
 * a later `!glob` match un-ignores. Folders above aren't checked, since a walk doesn't enter an
 * ignored folder
 */
function isIgnoredPath(
  absolutePath: string,
  isFolder: boolean,
  layers: IgnoreLayers,
  matchers: GlobMatchers,
): boolean {
  let isIgnored = false
  for (const { basePath, ignores } of layers.above(absolutePath)) {
    const relativePath = path.relative(basePath, absolutePath).split(path.sep).join('/')
    for (const glob of ignores) {
      if (glob === '' || glob === '!') {
        continue
      }
      const isNegated = glob.startsWith('!')
      // Only a `!glob` can change an ignored path, and only a plain one a path that isn't
      if (
        isNegated === isIgnored &&
        matchesGlob(relativePath, isFolder, glob.slice(isNegated ? 1 : 0), matchers)
      ) {
        isIgnored = !isNegated
      }
    }
  }
  return isIgnored
}

export function createIgnoreCheck(
  layers: IgnoreLayers,
): (absolutePath: string, isFolder: boolean) => boolean {
  const matchers: GlobMatchers = new Map()
  return (absolutePath, isFolder) => isIgnoredPath(absolutePath, isFolder, layers, matchers)
}

/**
 * Breadth first. Skips `.git`, `skippedNames`, ignored and unreadable folders, and dot folders
 * other than `enteredDotFolders` unless `entersDotFolders`, and doesn't follow symbolic links.
 * Layers that `visit` adds apply to the folders reached after
 */
export function walkFolders({
  root,
  skippedNames,
  entersDotFolders = false,
  enteredDotFolders = new Set(),
  layers,
  visit,
}: {
  root: string
  skippedNames: ReadonlySet<string>
  entersDotFolders?: boolean | undefined
  enteredDotFolders?: ReadonlySet<string> | undefined
  layers: IgnoreLayers
  visit: (
    folder: string,
    entries: ReadonlyArray<fs.Dirent>,
    isIgnored: (absolutePath: string, isFolder: boolean) => boolean,
  ) => void
}): void {
  const matchers: GlobMatchers = new Map()
  const isIgnored = (absolutePath: string, isFolder: boolean) =>
    isIgnoredPath(absolutePath, isFolder, layers, matchers)
  const queue = [root]
  let index = 0
  for (let folder = queue[index]; folder !== undefined; folder = queue[++index]) {
    let entries: Array<fs.Dirent>
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true })
    } catch {
      continue
    }
    visit(folder, entries, isIgnored)
    for (const entry of entries) {
      const entryPath = path.join(folder, entry.name)
      if (
        entry.isDirectory() &&
        (entersDotFolders
          ? entry.name !== '.git'
          : !entry.name.startsWith('.') || enteredDotFolders.has(entry.name)) &&
        !skippedNames.has(entry.name) &&
        !isIgnoredPath(entryPath, true, layers, matchers)
      ) {
        queue.push(entryPath)
      }
    }
  }
}
