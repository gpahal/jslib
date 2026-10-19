import fs from 'node:fs'
import path from 'node:path'

import { formatNames } from '@gpahal/std/errors'
import { trimEnd } from '@gpahal/std/strings'

import { findUp } from '@/internal/fs'
import { escapeGlob } from '@/internal/globs'
import { formatErrorMessage } from '@/internal/utils'

const CONFIG_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  n: '\n',
  t: '\t',
  b: '\b',
}

/**
 * As git reads it: `;` or `#` outside double quotes starts a comment, quotes are dropped, `\"`,
 * `\\`, `\n`, `\t` and `\b` are escapes, and outer whitespace outside quotes is dropped
 */
function parseConfigValue(raw: string): string {
  let value = ''
  let space = ''
  let isQuoted = false
  for (let index = 0; index < raw.length; index++) {
    const char = raw.charAt(index)
    if (!isQuoted && (char === ';' || char === '#')) {
      break
    }
    if (!isQuoted && /\s/.test(char)) {
      space += value === '' ? '' : char
      continue
    }
    value += space
    space = ''
    if (char === '"') {
      isQuoted = !isQuoted
    } else if (char === '\\') {
      index++
      const escaped = raw.charAt(index)
      value += CONFIG_ESCAPES[escaped] ?? escaped
    } else {
      value += char
    }
  }
  return value
}

function readTextFile(file: string, subject: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(formatErrorMessage([subject], "can't read the file"), { cause: error })
  }
}

/**
 * A path through a file, or one that can't be read, has none
 */
function hasDotGit(folder: string): boolean {
  try {
    return fs.lstatSync(path.join(folder, '.git'), { throwIfNoEntry: false }) !== undefined
  } catch {
    return false
  }
}

/**
 * Other repositories lint their files. A folder counts only with a `.git` in it, as
 * `git submodule status` has it, so an entry alone can't turn linting off for any folder
 */
export function readGitModules(gitRoot: string): Array<string> {
  const file = path.join(gitRoot, '.gitmodules')
  return fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() !== true
    ? []
    : readTextFile(file, '`.gitmodules`')
        .split(/\r?\n/)
        .flatMap((line) => {
          const raw = /^\s*path\s*=(.*)$/i.exec(line)?.[1]
          return raw === undefined ? [] : parseConfigValue(raw)
        })
        .filter((folder) => folder !== '' && hasDotGit(path.join(gitRoot, folder)))
        .map((folder) => `${trimEnd(escapeGlob(folder), '/')}/`)
}

/**
 * A `.git` file, as in a worktree, counts
 */
export function findGitRoot(dir: string): string | undefined {
  const gitPath = findUp('.git', dir)
  return gitPath === undefined ? undefined : path.dirname(gitPath)
}

/**
 * Its `.git` folder, or for a worktree, whose `.git` file has a `gitdir: <path>` line, the common
 * folder its git folder's `commondir` names
 */
export function findGitCommonDir(gitRoot: string): string | undefined {
  const dotGit = path.join(gitRoot, '.git')
  const stats = fs.statSync(dotGit, { throwIfNoEntry: false })
  if (stats?.isDirectory() === true) {
    return dotGit
  }
  if (stats?.isFile() !== true) {
    return undefined
  }
  const gitDirLine = /^gitdir:(.*)$/m.exec(readTextFile(dotGit, '`.git`'))?.[1]?.trim()
  if (gitDirLine === undefined || gitDirLine === '') {
    return undefined
  }
  const gitDir = path.resolve(gitRoot, gitDirLine)
  const commonDirFile = path.join(gitDir, 'commondir')
  return fs.existsSync(commonDirFile)
    ? path.resolve(gitDir, readTextFile(commonDirFile, formatNames([commonDirFile])).trim())
    : gitDir
}

/**
 * Git sets `core.ignorecase` when it makes a repository on a case-insensitive file system. Read as
 * git-config reads it: any case, a key without `=` is true, and the last setting wins
 */
export function readIgnoreCase(gitCommonDir: string): boolean {
  const file = path.join(gitCommonDir, 'config')
  if (fs.statSync(file, { throwIfNoEntry: false })?.isFile() !== true) {
    return false
  }
  let isCore = false
  let ignoreCase = false
  const lines = readTextFile(file, formatNames([file])).split(/\r?\n/)
  for (const line of lines) {
    const section = /^\s*\[([^\]]*)\]/.exec(line)?.[1]
    if (section !== undefined) {
      // `[core "x"]` and `[core.x]` are subsections, whose keys aren't `core.<key>`
      isCore = section.trim().toLowerCase() === 'core'
      continue
    }
    const match = /^\s*ignorecase\s*(?:=(.*))?$/i.exec(line)
    if (!isCore || match === null) {
      continue
    }
    const raw = match[1]
    ignoreCase =
      raw === undefined || ['true', 'yes', 'on', '1'].includes(parseConfigValue(raw).toLowerCase())
  }
  return ignoreCase
}

/**
 * Lowest precedence first, or only `dir`'s own outside a repository
 */
export function findGitignoresAbove(dir: string, gitRoot: string | undefined): Array<string> {
  const files: Array<string> = []
  for (let current = dir; ; current = path.dirname(current)) {
    const file = path.join(current, '.gitignore')
    if (fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() === true) {
      files.unshift(file)
    }
    if (gitRoot === undefined || current === gitRoot || path.dirname(current) === current) {
      break
    }
  }
  return files
}
