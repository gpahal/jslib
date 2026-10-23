/**
 * Peer versions checked against the minimum or the range a package needs, with npm's range syntax.
 * Contract: ranges and minimums valid in that syntax. A version is unchecked, as read from a
 * manifest
 */

// semver's modules one by one, which load in about half the time of its index, which loads all of
// them
// eslint-disable-next-line e18e/ban-dependencies -- semver implements npm's range syntax, which the `peerDependencies` ranges are written in
import satisfies from 'semver/functions/satisfies.js'
// eslint-disable-next-line e18e/ban-dependencies -- As above, for npm's range syntax
import valid from 'semver/functions/valid.js'
// eslint-disable-next-line e18e/ban-dependencies -- As above, for npm's range syntax
import gtr from 'semver/ranges/gtr.js'

import { formatInstallCommand } from '@/node/package-manager'
import { formatPeerSpecifier } from '@/node/resolve'

/**
 * Whether `version` is an insiders build, such as Tailwind CSS's `0.0.0-insiders.5b27f94`, which
 * is newer than any release, so a minimum or range can't place it
 */
export function isInsidersVersion(version: unknown): boolean {
  return typeof version === 'string' && version.startsWith('0.0.0-')
}

/**
 * Whether `version` is at least `minimum`, a `major.minor` such as `'4.7'`. A prerelease of the
 * minimum, such as `4.7.0-beta.1`, counts, and a version that isn't a string or valid doesn't
 */
export function isAtLeast(version: unknown, minimum: string): boolean {
  return (
    typeof version === 'string' &&
    satisfies(version, `>=${minimum}.0-0`, { includePrerelease: true })
  )
}

/**
 * Whether `version` is in `range`. A prerelease, such as a Next.js canary, counts when inside it
 */
export function isInRange(version: string, range: string): boolean {
  return satisfies(version, range, { includePrerelease: true })
}

/**
 * Whether `version` is valid and newer than every version in `range`
 */
export function isNewerThanRange(version: string, range: string): boolean {
  return valid(version) !== null && gtr(version, range, { includePrerelease: true })
}

/**
 * The command that installs `name` at `range` as a dev dependency of the project at or above
 * `dir`, as in `pnpm add -D "a@^1.2"`, with the specifier shell-quoted
 */
export function formatInstallHint(name: string, range: string | undefined, dir: string): string {
  return formatInstallCommand([formatPeerSpecifier(name, range)], dir)
}

/**
 * The description of a peer newer than its tested range, which a package warns of rather than
 * failing, since a later release often still works: "<name> <version> is newer than the tested
 * range <range>, so <effect>. If they do, install a version in the range, as in `<command>`"
 */
export function describeNewerThanRange({
  name,
  version,
  range,
  effect,
  dir,
}: {
  name: string
  version: string
  range: string
  /**
   * What may go wrong, in the plural so "If they do" follows, as in `its rules may break`
   */
  effect: string
  /**
   * The folder whose package manager the install command uses
   */
  dir: string
}): string {
  return `${name} ${version} is newer than the tested range ${range}, so ${effect}. If they do, install a version in the range, as in \`${formatInstallHint(name, range, dir)}\``
}
