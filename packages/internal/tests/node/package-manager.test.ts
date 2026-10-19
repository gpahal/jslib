import path from 'node:path'

import { detectPackageManager, formatInstallCommand } from '@/node/package-manager'
import { withTmpProject } from '@/node/testing'

afterEach(() => {
  vi.unstubAllEnvs()
})

test.each([
  [{ 'pnpm-workspace.yaml': '' }, 'pnpm'],
  [{ 'npm-shrinkwrap.json': '' }, 'npm'],
  // pnpm wins when a folder has both lockfiles
  [{ 'package-lock.json': '', 'pnpm-lock.yaml': '' }, 'pnpm'],
  // A lockfile wins over the `packageManager` field
  [{ 'package.json': '{ "packageManager": "npm@11.6.0" }', 'pnpm-lock.yaml': '' }, 'pnpm'],
  [{ 'package.json': '\u{FEFF}{ "packageManager": "npm@11.6.0" }' }, 'npm'],
] as const)('detects %j as %s, before the user agent', async (files, expected) => {
  vi.stubEnv('npm_config_user_agent', expected === 'npm' ? 'pnpm/10.0.0' : 'npm/11.0.0')
  await using project = await withTmpProject('internal-package-manager', files)
  expect(detectPackageManager(project.dir)).toBe(expected)
})

test('walks up from a nested folder, the nearest lockfile deciding, and skips yarn and bun', async () => {
  vi.stubEnv('npm_config_user_agent', undefined)
  await using project = await withTmpProject('internal-package-manager', {
    'package-lock.json': '',
    'a/b/index.js': '',
    'pnpm/pnpm-lock.yaml': '',
    'pnpm/d/index.js': '',
    'yarn/yarn.lock': '',
    'bun/package.json': '{ "packageManager": "bun@1.3.0" }',
  })
  expect(detectPackageManager(path.join(project.dir, 'a/b'))).toBe('npm')
  expect(detectPackageManager(path.join(project.dir, 'pnpm/d'))).toBe('pnpm')
  expect(detectPackageManager(path.join(project.dir, 'yarn'))).toBe('npm')
  expect(detectPackageManager(path.join(project.dir, 'bun'))).toBe('npm')
})

test('falls back to the user agent without a lockfile, and to pnpm for any other', async () => {
  await using project = await withTmpProject('internal-package-manager', { 'package.json': '{' })
  vi.stubEnv('npm_config_user_agent', 'npm/11.6.0 node/v24.21.0 darwin arm64 workspaces/false')
  expect(detectPackageManager(project.dir)).toBe('npm')
  vi.stubEnv('npm_config_user_agent', 'yarn/4.0.0 npm/? node/v24.21.0 darwin arm64')
  expect(detectPackageManager(project.dir)).toBe('pnpm')
})

test('formats an install command for the detected package manager', async () => {
  await using npm = await withTmpProject('internal-package-manager', { 'package-lock.json': '' })
  await using pnpm = await withTmpProject('internal-package-manager', { 'pnpm-lock.yaml': '' })
  expect(formatInstallCommand(['a', 'b@^2'], npm.dir)).toBe('npm install -D a b@^2')
  expect(formatInstallCommand(['a', 'b@^2'], pnpm.dir)).toBe('pnpm add -D a b@^2')
})
