import fs from 'node:fs'
import path from 'node:path'

import type { ESLint, Rule } from 'eslint'

import { describeValue } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import { isInEditorEnv } from '@/internal/editor'
import { isInside } from '@/internal/globs'
import { PACKAGE_META } from '@/internal/package-meta'
import { fail, getDocsUrl } from '@/internal/utils'

type RootSpellingCheck = (filePath: string) => void

/**
 * Made again by each `defineConfig`, so a reloaded config sees changed links
 */
const checks = new Map<string, RootSpellingCheck>()

/**
 * In the file system's case on Windows
 */
function isSamePath(a: string, b: string): boolean {
  return path.relative(a, b) === ''
}

/**
 * Outside an editor, ESLint runs from the real path, so the link comes from a command-line path.
 * Linting through `root` comes first, since `root` set to the link would break `eslint .`
 */
export function describeRootSpellingFix({
  root,
  dir,
  isRealDir,
  isInEditor,
}: {
  root: string
  dir: string
  isRealDir: boolean
  isInEditor: boolean
}): string {
  if (!isRealDir && !isInEditor) {
    return `Lint it through \`${root}\`, as in \`eslint src\` run there. For an editor opened at \`${dir}\`, pass \`${dir}\`, the path ESLint uses, as \`root\``
  }
  const fix = isRealDir
    ? `Pass \`import.meta.dirname\`, or the real path, \`${dir}\`, as \`root\``
    : `Pass \`${dir}\`, the path ESLint uses, as \`root\``
  return isInEditor ? `${fix}, or open \`${root}\` in your editor instead of \`${dir}\`` : fix
}

/**
 * Caches folders' real paths. `realpathSync.native` gives each name its case on disk, so a path
 * that differs from root only in case is another spelling too
 */
export function createRootSpellingCheck(root: string): RootSpellingCheck {
  const realRoot = fs.realpathSync.native(root)
  const realpaths = new Map<string, string | undefined>()
  const realpathOf = (dir: string): string | undefined => {
    if (!realpaths.has(dir)) {
      let realpath: string | undefined
      try {
        realpath = fs.realpathSync.native(dir)
      } catch {
        realpath = undefined
      }
      realpaths.set(dir, realpath)
    }
    return realpaths.get(dir)
  }
  const linklessPathOf = (dir: string) => path.join(realRoot, path.relative(root, dir))
  const failInside = (filePath: string, dir: string, realDir: string): never =>
    fail(
      ['`root`'],
      `ESLint reaches \`${filePath}\` through \`${dir}\`, another path to \`${realDir}\` inside \`${root}\`, and matches configs by path text, so none of the presets' configs apply. Lint it as \`${path.join(root, path.relative(realRoot, realDir), path.relative(dir, filePath))}\` instead`,
    )
  const check = (filePath: string): void => {
    if (!path.isAbsolute(filePath)) {
      return
    }
    const dir = path.dirname(filePath)
    if (isInside(dir, root)) {
      const realDir = realpathOf(dir)
      // A link inside root to a folder outside it lints as its target does
      if (
        realDir === undefined ||
        isSamePath(realDir, linklessPathOf(dir)) ||
        !isInside(realDir, realRoot)
      ) {
        return
      }
      // Names the outermost folder that a link moves
      let link = dir
      let realLink = realDir
      for (
        let parent = path.dirname(link);
        !isSamePath(parent, root);
        parent = path.dirname(parent)
      ) {
        const realParent = realpathOf(parent)
        if (realParent === undefined || isSamePath(realParent, linklessPathOf(parent))) {
          break
        }
        link = parent
        realLink = realParent
      }
      failInside(filePath, link, realLink)
    }
    // The outermost folder outside root whose real path is root or inside it
    let found: { dir: string; realDir: string } | undefined
    for (let parent = dir; !isInside(parent, root); parent = path.dirname(parent)) {
      const realParent = realpathOf(parent)
      const isRootPath = realParent !== undefined && isInside(realParent, realRoot)
      if (isRootPath) {
        found = { dir: parent, realDir: realParent }
      }
      if ((!isRootPath && found !== undefined) || path.dirname(parent) === parent) {
        break
      }
    }
    if (found === undefined) {
      return
    }
    if (!isSamePath(found.realDir, realRoot)) {
      failInside(filePath, found.dir, found.realDir)
    }
    fail(
      ['`root`'],
      `ESLint reaches \`${filePath}\` through \`${found.dir}\`, another path to \`${root}\`, and matches configs by path text, so none of the presets' configs apply. ${describeRootSpellingFix(
        {
          root,
          dir: found.dir,
          isRealDir: isSamePath(found.dir, found.realDir),
          isInEditor: isInEditorEnv(),
        },
      )}`,
    )
  }
  checks.set(root, check)
  return check
}

/**
 * Throws when ESLint reaches `filePath` through a symbolic link, a junction or another case.
 * ESLint matches configs by path text, so no preset config would apply and the file would pass
 * silently
 */
export function checkRootSpelling(root: string, filePath: string): void {
  ;(checks.get(root) ?? createRootSpellingCheck(root))(filePath)
}

function realpathOrUndefined(filePath: string): string | undefined {
  try {
    return fs.realpathSync.native(filePath)
  } catch {
    return undefined
  }
}

/**
 * A link to a folder that holds root gives root under it; one to a folder inside root, itself
 */
function linkSpellingsIn(dir: string, realRoot: string): Array<string> {
  let entries: Array<fs.Dirent>
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const link = path.join(dir, entry.name)
    const target = entry.isSymbolicLink() ? realpathOrUndefined(link) : undefined
    if (target === undefined) {
      return []
    }
    if (isInside(realRoot, target)) {
      return path.join(link, path.relative(target, realRoot))
    }
    return isInside(target, realRoot) ? link : []
  })
}

/**
 * Its real path, and each link above it or its real path to a folder that holds root or is inside
 * it. Finding every link would read the whole file system, so links elsewhere are missed
 */
export function findRootSpellings(root: string): {
  folders: Array<string>
  isCaseInsensitive: boolean
} {
  const realRoot = realpathOrUndefined(root)
  if (realRoot === undefined) {
    return { folders: [], isCaseInsensitive: false }
  }
  const folders = new Set<string>([realRoot])
  const starts = new Set([root, realRoot])
  for (const start of starts) {
    for (let dir = path.dirname(start); ; dir = path.dirname(dir)) {
      for (const folder of linkSpellingsIn(dir, realRoot)) {
        folders.add(folder)
      }
      if (path.dirname(dir) === dir) {
        break
      }
    }
  }
  folders.delete(root)
  const swapped = root.replaceAll(/\p{L}/gu, (char) =>
    char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase(),
  )
  return {
    folders: [...folders],
    isCaseInsensitive: swapped !== root && realpathOrUndefined(swapped) === realRoot,
  }
}

function rootOf(options: unknown, subject: string): string {
  const root = isRecord(options) ? options['root'] : undefined
  if (typeof root !== 'string') {
    fail(
      ['`@gpahal/guards/root-spelling`', subject],
      `expected an object with a \`root\` path, received ${describeValue(options)}`,
    )
  }
  return root
}

/**
 * Without `meta.languages`, so ESLint runs it in every language
 */
const ROOT_SPELLING_RULE: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow linting a file through another path to root',
      url: getDocsUrl('typed-config-files'),
    },
    schema: [
      {
        type: 'object',
        properties: { root: { type: 'string' } },
        required: ['root'],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    checkRootSpelling(rootOf(context.options[0], 'options'), context.physicalFilename)
    return {}
  },
}

/**
 * Its parse checks the file, since ESLint runs no rule on a file only its defaults match. A file
 * with no other spelling, as in a folder a link has since replaced, gets an empty tree
 */
const OUTSIDE_LANGUAGE: NonNullable<ESLint.Plugin['languages']>[string] = {
  fileType: 'text',
  lineStart: 1,
  columnStart: 1,
  nodeTypeKey: 'type',
  visitorKeys: { Root: [] },
  validateLanguageOptions: (languageOptions) => {
    rootOf(languageOptions, '`languageOptions`')
  },
  parse: (file, { languageOptions }) => {
    checkRootSpelling(rootOf(languageOptions, '`languageOptions`'), file.physicalPath)
    return { ok: true, ast: { type: 'Root' } }
  },
  createSourceCode: (file, { ast }) => ({
    ast,
    text: typeof file.body === 'string' ? file.body : '',
    getLoc: () => ({ start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }),
    getRange: () => [0, 0],
    traverse: () => [],
  }),
}

/**
 * Registered as `@gpahal/guards` by configs the composer can't reach
 */
export const GUARDS_PLUGIN: ESLint.Plugin = {
  meta: { name: `${PACKAGE_META.name}/guards`, version: PACKAGE_META.version },
  // Two names, so one `defineConfig` result's outside config doesn't replace another's options
  rules: { 'root-spelling': ROOT_SPELLING_RULE, 'root-spelling-outside': ROOT_SPELLING_RULE },
  languages: { 'root-spelling': OUTSIDE_LANGUAGE },
}
