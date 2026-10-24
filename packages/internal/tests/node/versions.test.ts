import { withTmpProject } from '@/node/testing'
import {
  describeNewerThanRange,
  formatInstallHint,
  isAtLeast,
  isInRange,
  isInsidersVersion,
  isNewerThanRange,
} from '@/node/versions'

test.each([
  ['4.7.0', true],
  ['5.0.0', true],
  // A prerelease of the minimum
  ['4.7.0-beta.1', true],
  ['4.6.9', false],
  ['0.0.0-insiders.5b27f94', false],
  ['not a version', false],
  [undefined, false],
])('isAtLeast(%j, 4.7) is %s', (version, expected) => {
  expect(isAtLeast(version, '4.7')).toBe(expected)
})

test.each([
  // A prerelease, such as a Next.js canary, counts when inside the range
  ['16.4.0-canary.1', '^16.3', true, false],
  ['16.3.0', '^16.3', true, false],
  ['17.0.0', '^16.3', false, true],
  ['16.2.0', '^16.3', false, false],
  ['0.9.0', '>=0.8.0 <0.9.0', false, true],
  // An insiders build is older than any release to semver
  ['0.0.0-insiders.5b27f94', '>=0.8.0 <0.9.0', false, false],
  ['not a version', '^16.3', false, false],
])('%s against %s: in range %s, newer %s', (version, range, inRange, newer) => {
  expect(isInRange(version, range)).toBe(inRange)
  expect(isNewerThanRange(version, range)).toBe(newer)
})

test('tells an insiders build by its 0.0.0 prerelease', () => {
  expect(isInsidersVersion('0.0.0-insiders.5b27f94')).toBe(true)
  for (const version of ['0.0.0', '0.8.1', undefined]) {
    expect(isInsidersVersion(version)).toBe(false)
  }
})

test('quotes the range of an install hint for the shell', async () => {
  await using project = await withTmpProject('internal-versions', { 'pnpm-lock.yaml': '' })
  expect(formatInstallHint('a', '^1.2', project.dir)).toBe('pnpm add -D "a@^1.2"')
  expect(formatInstallHint('@scope/a', undefined, project.dir)).toBe('pnpm add -D @scope/a')
  expect(
    describeNewerThanRange({
      name: 'a',
      version: '2.0.0',
      range: '>=1.2.0 <2.0.0',
      effect: 'its rules may break',
      dir: project.dir,
    }),
  ).toBe(
    'a 2.0.0 is newer than the tested range >=1.2.0 <2.0.0, so its rules may break. If they do, install a version in the range, as in `pnpm add -D "a@>=1.2.0 <2.0.0"`',
  )
})
