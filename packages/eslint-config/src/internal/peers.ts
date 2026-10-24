import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readJsonFile as readJsonFileOrThrow } from '@gpahal/internal/node/json'
import { detectPackageManager, formatInstallCommand } from '@gpahal/internal/node/package-manager'
import { formatPeerSpecifier, isResolvable, missingPeersError } from '@gpahal/internal/node/resolve'
import { describeNewerThanRange, isInRange, isNewerThanRange } from '@gpahal/internal/node/versions'
import { formatMessageList, formatNames, getErrorCode } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import { findPackageJson, findUp, readJsonFile } from '@/internal/fs'
import { formatErrorMessage, PREFIX, warnOfSetupOnce } from '@/internal/utils'

export async function interopDefault<T>(module: Promise<{ default: T }>): Promise<T> {
  return (await module).default
}

type OutdatedPeer = {
  name: string
  range: string
  version: string
}

/**
 * With the folder whose package manager the install command uses
 */
type PeerProblem = {
  option: string
  missing: Array<string>
  outdated: Array<OutdatedPeer>
  dir: string
}

/**
 * So `defineConfig` can report every area's at once
 */
const PEER_PROBLEMS = new WeakMap<object, PeerProblem>()

function withPeerProblem(error: Error, problem: PeerProblem): Error {
  PEER_PROBLEMS.set(error, problem)
  return error
}

/**
 * A missing peer's error names the option and the packages to install
 */
export async function importPeers<T>(
  option: string,
  packages: Array<string>,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load()
  } catch (error) {
    if (getErrorCode(error) !== 'ERR_MODULE_NOT_FOUND') {
      throw error
    }
    const missing = packages.filter((name) => !isResolvable((id) => import.meta.resolve(id), name))
    if (missing.length === 0) {
      throw error
    }
    // The project that installs this package installs its peers, so its package manager is the one
    // at or above this package's folder
    throw withPeerProblem(
      missingPeersError(missing, {
        prefix: PREFIX,
        option,
        cause: error,
        ranges: PEER_RANGES,
        dir: MODULE_DIR,
      }),
      { option, missing, outdated: [], dir: MODULE_DIR },
    )
  }
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

type PackageJson = {
  version?: unknown
  peerDependencies?: unknown
}

function readPackageJson(file: string, subjects: ReadonlyArray<string> = []): PackageJson {
  let json: unknown
  try {
    json = readJsonFileOrThrow(file)
  } catch (error) {
    throw new Error(
      formatErrorMessage([...subjects, formatNames([file])], "can't read the file as JSON"),
      {
        cause: error,
      },
    )
  }
  return isRecord(json) ? json : {}
}

const PEER_RANGES: Readonly<Record<string, string>> = (() => {
  const file = findUp('package.json', MODULE_DIR)
  const { peerDependencies } = file === undefined ? {} : readPackageJson(file)
  return isRecord(peerDependencies)
    ? Object.fromEntries(
        Object.entries(peerDependencies).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {}
})()

export function formatPeersInstallCommand(peers: ReadonlyArray<string>, dir: string): string {
  return formatInstallCommand(
    peers.map((name) => formatPeerSpecifier(name, PEER_RANGES[name])),
    dir,
  )
}

const warnedNewerPeers = new Set<string>()

/**
 * As in "a ^2, but 1.0.0 is installed, and b ^3, but 2.0.0 is installed"
 */
function describeOutdated(outdated: ReadonlyArray<OutdatedPeer>): string {
  const described = outdated.map(
    ({ name, range, version }) => `${name} ${range}, but ${version} is installed`,
  )
  const last = described.pop() ?? ''
  return described.length === 0 ? last : `${described.join(', ')}, and ${last}`
}

/**
 * Fail above their range too: typescript-eslint supports only the TypeScript minor in the range
 */
const STRICT_PEERS: ReadonlySet<string> = new Set(['typescript'])

/**
 * Peers older than the range, in a gap of it, or, for {@link STRICT_PEERS}, newer. Another peer
 * newer than the range warns once per `name@version`, since a later release often still works. A
 * peer that isn't installed is left out
 */
function findOutdatedPeers(
  subjects: ReadonlyArray<string>,
  peers: ReadonlyArray<string>,
  dir: string,
): Array<OutdatedPeer> {
  const outdated: Array<OutdatedPeer> = []
  for (const name of peers) {
    const range = PEER_RANGES[name]
    const file = typeof range === 'string' ? findPackageJson(name, dir) : undefined
    if (typeof range !== 'string' || file === undefined) {
      continue
    }
    const { version } = readPackageJson(file, subjects)
    if (typeof version !== 'string' || isInRange(version, range)) {
      continue
    }
    if (!STRICT_PEERS.has(name) && isNewerThanRange(version, range)) {
      warnOfSetupOnce(
        warnedNewerPeers,
        `${name}@${version}`,
        formatErrorMessage(
          subjects,
          describeNewerThanRange({ name, version, range, effect: 'its rules may break', dir }),
        ),
        'GPAHAL_PEER_NEWER_THAN_RANGE',
      )
      continue
    }
    outdated.push({ name, range, version })
  }
  return outdated
}

/**
 * A peer that isn't installed is left to `importPeers`
 */
export function checkPeerVersions(
  option: string,
  peers: ReadonlyArray<string>,
  dir: string = MODULE_DIR,
): void {
  const outdated = findOutdatedPeers([formatNames([option])], peers, dir)
  if (outdated.length === 0) {
    return
  }
  const specifiers = outdated.map(({ name, range }) => formatPeerSpecifier(name, range))
  throw withPeerProblem(
    new Error(
      formatErrorMessage(
        [formatNames([option])],
        `needs ${describeOutdated(outdated)}. Run \`${formatInstallCommand(specifiers, dir)}\``,
      ),
    ),
    { option, missing: [], outdated, dir },
  )
}

const CORE_PEERS: ReadonlyArray<string> = ['eslint', 'typescript']

function typescriptHint(outdated: ReadonlyArray<OutdatedPeer>): string {
  const typescript = outdated.find(({ name }) => name === 'typescript')
  return typescript !== undefined && isNewerThanRange(typescript.version, typescript.range)
    ? ". TypeScript 7 and every TypeScript after 6.0 aren't supported right now"
    : ''
}

/**
 * Outside a JavaScript-only project
 */
export function checkTypescriptInstalled(isNeeded: boolean, dir: string = MODULE_DIR): void {
  if (!isNeeded || isInstalledIn('typescript', dir)) {
    return
  }
  throw missingPeersError(['typescript'], {
    prefix: PREFIX,
    option: 'typescript',
    ranges: PEER_RANGES,
    dir,
  })
}

/**
 * So a wrong version fails with the install command rather than a rule error. ESLint before 10.11
 * lacks `includeIgnoreFile`, TypeScript 5 rejects the presets' compiler options, and
 * typescript-eslint supports no TypeScript after 6.0
 */
export function checkCorePeerVersions(dir: string = MODULE_DIR): void {
  const subjects = ['peer dependencies']
  const outdated = findOutdatedPeers(subjects, CORE_PEERS, dir)
  if (outdated.length === 0) {
    return
  }
  const specifiers = outdated.map(({ name, range }) => formatPeerSpecifier(name, range))
  const hint = typescriptHint(outdated)
  throw new Error(
    formatErrorMessage(
      subjects,
      `needs ${describeOutdated(outdated)}. Run \`${formatInstallCommand(specifiers, dir)}\`${hint}`,
    ),
  )
}

/**
 * One error with one install command for every peer error, or `undefined` for fewer than two, where
 * the one error says it all. A peer two options need is named once, under the first
 */
export function combinePeerErrors(errors: ReadonlyArray<unknown>): Error | undefined {
  const problemErrors = errors.filter(
    (error): error is object =>
      typeof error === 'object' && error !== null && PEER_PROBLEMS.has(error),
  )
  if (problemErrors.length < 2) {
    return undefined
  }
  const byOption = new Map<string, PeerProblem>()
  const seen = new Set<string>()
  for (const error of problemErrors) {
    const { option, missing, outdated, dir } = PEER_PROBLEMS.get(error) ?? {
      option: '',
      missing: [],
      outdated: [],
      dir: MODULE_DIR,
    }
    const problem = byOption.get(option) ?? { option, missing: [], outdated: [], dir }
    byOption.set(option, problem)
    for (const name of missing) {
      if (seen.has(name)) {
        continue
      }

      seen.add(name)
      problem.missing.push(name)
    }
    for (const peer of outdated) {
      if (seen.has(peer.name)) {
        continue
      }

      seen.add(peer.name)
      problem.outdated.push(peer)
    }
  }
  const problems = byOption.values().toArray()
  const items = problems
    .filter(({ missing, outdated }) => missing.length > 0 || outdated.length > 0)
    .map(({ option, missing, outdated }) => ({
      subjects: [formatNames([option])],
      description: [
        ...(missing.length === 0
          ? []
          : [
              `needs ${formatNames(missing, { conjunction: 'and' })}, which ${missing.length === 1 ? "isn't" : "aren't"} installed`,
            ]),
        ...(outdated.length === 0 ? [] : [`needs ${describeOutdated(outdated)}`]),
      ].join(', and '),
    }))
  const specifiers = Array.from(seen, (name) => formatPeerSpecifier(name, PEER_RANGES[name]))
  const install = `Install ${seen.size === 1 ? 'it as a dev dependency' : 'them as dev dependencies'}, as in \`${formatInstallCommand(specifiers, problems[0]?.dir ?? MODULE_DIR)}\``
  const message =
    items.length === 1
      ? `${formatMessageList(PREFIX, [], items)}. ${install}`
      : `${formatMessageList(PREFIX, ['options'], items)}\n${install}`
  return new Error(message, {
    cause: new AggregateError(problemErrors, 'the errors of each option'),
  })
}

/**
 * Resolved from the package's real folder, as Node does: in pnpm's layout, the folder `name`
 * resolves to is a symlink, and the `node_modules` above the link isn't the package's own
 */
function findTypescriptOf(name: string, dir: string): string | undefined {
  try {
    const manifest = findPackageJson(name, dir)
    const typescript =
      manifest === undefined
        ? undefined
        : findPackageJson('typescript', path.dirname(fs.realpathSync(manifest)))
    return typescript === undefined ? undefined : fs.realpathSync(path.dirname(typescript))
  } catch {
    return undefined
  }
}

const warnedTypescriptCopies = new Set<string>()

/**
 * sonarjs depends on `typescript` itself, so a lockfile can keep another copy for it, whose type
 * flags differ from typescript-eslint's program, and its type-aware rules misreport, as
 * `sonarjs/in-operator-type-error` does on a union of object types
 */
export function warnOfSonarjsTypescriptCopy(dir: string = MODULE_DIR): void {
  const sonarjs = findTypescriptOf('eslint-plugin-sonarjs', dir)
  const parser = findTypescriptOf('@typescript-eslint/parser', dir)
  const key = `${sonarjs ?? ''}\0${parser ?? ''}`
  if (
    sonarjs === undefined ||
    parser === undefined ||
    sonarjs === parser ||
    warnedTypescriptCopies.has(key)
  ) {
    return
  }
  const packageManager = detectPackageManager(dir)
  const alias = packageManager === 'pnpm' ? getAliasSpecifier(parser) : undefined
  // pnpm installs sonarjs's own `typescript` beside an alias such as `npm:@typescript/typescript6`,
  // which `dedupe` can't merge, as their names differ
  const fix =
    alias === undefined
      ? `Run \`${packageManager} dedupe\` to install one copy`
      : `Add \`'eslint-plugin-sonarjs>typescript': '${alias}'\` to \`overrides\` in \`pnpm-workspace.yaml\`, then run \`pnpm install\``
  warnOfSetupOnce(
    warnedTypescriptCopies,
    key,
    formatErrorMessage(
      ['`sonarjs`'],
      `eslint-plugin-sonarjs loads TypeScript from ${formatNames([sonarjs])}, but typescript-eslint loads it from ${formatNames([parser])}, so sonarjs's type-aware rules can misreport. ${fix}`,
    ),
    'GPAHAL_SONARJS_TYPESCRIPT_COPY',
  )
}

/**
 * As `npm:@typescript/typescript6@^6.0.3`, or `undefined` for `typescript` itself
 */
function getAliasSpecifier(typescript: string): string | undefined {
  const manifest = readJsonFile(path.join(typescript, 'package.json'))
  const name = isRecord(manifest) ? manifest['name'] : undefined
  const version = isRecord(manifest) ? manifest['version'] : undefined
  return typeof name === 'string' && name !== 'typescript' && typeof version === 'string'
    ? `npm:${name}@^${version}`
    : undefined
}

export function isInstalledIn(name: string, dir: string): boolean {
  return findPackageJson(name, dir) !== undefined
}

/**
 * A plugin of `option` loads it from `dir`, so it would otherwise silently do nothing
 */
export function assertInstalledIn({
  option,
  packages,
  dir,
  reason,
}: {
  option: string
  packages: ReadonlyArray<string>
  dir: string
  reason: string
}): void {
  if (packages.some((name) => isInstalledIn(name, dir))) {
    return
  }
  const [first = ''] = packages
  throw new Error(
    formatErrorMessage(
      [formatNames([option])],
      `needs ${formatNames(packages, { conjunction: 'or' })} installed where ${reason}, ${formatNames([dir])}. Install it as a dev dependency there, as in \`${formatInstallCommand([first], dir)}\``,
    ),
  )
}
