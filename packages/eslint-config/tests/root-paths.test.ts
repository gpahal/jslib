import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { ESLint } from 'eslint'
import type { Linter } from 'eslint'

import { withTmpProject, writeFiles } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'
import { describeRootSpellingFix } from '@/internal/root-spelling'

import { BUILD_DIR, eslintWith } from './helpers'

const CONFIG_URL = JSON.stringify(pathToFileURL(path.join(BUILD_DIR, 'index.js')).href)

async function symlink(target: string, link: string): Promise<void> {
  await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

test.each([
  ['discovery from the config folder', '.', '.', false],
  ['discovery from the project folder', '.', 'project[+]', false],
  ['explicit config from the parent folder', 'project[+]', '.', true],
  ['explicit config in the parent from the project folder', '.', 'project[+]', true],
] as const)('anchors actual matching to root with %s', async (_name, configDir, cwd, explicit) => {
  await using project = await withTmpProject('eslint-root')
  const root = path.join(project.dir, 'project[+]')
  const configFile = path.join(project.dir, configDir, 'eslint.config.mjs')
  const source = 'console.log(process.argv)\n'
  const options = {
    root,
    typeAware: false,
    browser: { files: ['src/**'] },
    ignores: ['src/ignored.js'],
  }
  const files = ['src/example.js', 'src/ignored.js', 'src/git-only.js']
  await writeFiles(project.dir, {
    ...Object.fromEntries(
      ['.', 'project[+]'].flatMap((dir) => files.map((file) => [path.join(dir, file), source])),
    ),
    'project[+]/.gitignore': 'src/git-only.js\n',
    [path.relative(project.dir, configFile)]: `
      import { defineConfig } from ${CONFIG_URL}
      export default defineConfig(${JSON.stringify(options)})
    `,
  })
  const eslint = new ESLint({
    cwd: path.join(project.dir, cwd),
    ...(explicit && { overrideConfigFile: configFile }),
  })
  const [result] = await eslint.lintFiles([path.join(root, 'src/example.js')])
  expect(result?.messages.some(({ ruleId }) => ruleId === '@gpahal/no-node-globals')).toBe(true)
  expect(result?.fatalErrorCount).toBe(0)
  for (const file of ['src/ignored.js', 'src/git-only.js']) {
    expect(await eslint.isPathIgnored(path.join(root, file)), file).toBe(true)
  }
  // Explicit configs from the project cwd cannot reach outside that cwd: ESLint itself rejects
  // those files before applying any config
  const outsideFiles = !explicit || cwd === '.' ? files : []
  for (const file of outsideFiles) {
    const outer = path.join(project.dir, file)
    expect(await eslint.isPathIgnored(outer), file).toBe(false)
    const config = (await eslint.calculateConfigForFile(outer)) as Linter.Config | undefined
    expect(config?.rules?.['@gpahal/no-node-globals']).toBeUndefined()
  }
})

test('fails loudly for a linted path in any language that reaches root through a symbolic link', async () => {
  const files = ['src/example.js', 'README.md']
  await using project = await withTmpProject(
    'eslint-root',
    Object.fromEntries(files.map((file) => [`real/${file}`, ''])),
  )
  const real = path.join(project.dir, 'real')
  const link = path.join(project.dir, 'link')
  await symlink(real, link)
  const configs = await defineConfig({ root: real, typeAware: false })
  const eslint = eslintWith(project.dir, configs, { overrideConfigFile: true })
  for (const file of files) {
    await expect(eslint.lintFiles([path.join('link', file)]), file).rejects.toThrow(
      `@gpahal/eslint-config: \`root\`: ESLint reaches \`${path.join(link, file)}\` through \`${link}\`, another path to \`${real}\``,
    )
  }
})

test('fails loudly for a linted path that reaches a folder inside root through a symbolic link inside root', async () => {
  await using project = await withTmpProject('eslint-root', {
    'eslint.config.mjs': 'export default []\n',
    'src/app.js': 'export const args = process.argv\n',
    'docs/readme.md': '# Docs\n',
  })
  await symlink(path.join(project.dir, 'src'), path.join(project.dir, 'alias'))
  await symlink(path.join(project.dir, 'docs'), path.join(project.dir, 'src/docs'))
  const configs = await defineConfig({
    root: project.dir,
    typeAware: false,
    browser: { files: ['src/**'] },
  })
  const eslint = eslintWith(project.dir, configs)
  // The canonical path first, so that a browser rule that's off can't pass the test
  const [result] = await eslint.lintFiles([path.join(project.dir, 'src/app.js')])
  expect(result?.messages.map(({ ruleId }) => ruleId)).toContain('@gpahal/no-node-globals')
  const alias = path.join(project.dir, 'alias')
  await expect(eslint.lintFiles([path.join(alias, 'app.js')])).rejects.toThrow(
    `@gpahal/eslint-config: \`root\`: ESLint reaches \`${path.join(alias, 'app.js')}\` through \`${alias}\`, another path to \`${path.join(project.dir, 'src')}\` inside \`${project.dir}\`, and matches configs by path text, so none of the presets' configs apply. Lint it as \`${path.join(project.dir, 'src/app.js')}\` instead`,
  )
  // Through a link in a deeper folder, in a language other than JavaScript
  const nested = path.join(project.dir, 'src/docs')
  await expect(eslint.lintFiles([path.join(nested, 'readme.md')])).rejects.toThrow(
    `through \`${nested}\`, another path to \`${path.join(project.dir, 'docs')}\` inside`,
  )
})

// The second as on macOS, where `/tmp` links to `/private/tmp`, and ESLint's command line runs from
// the real path, which `process.cwd()` gives
test.each([
  [
    "ESLint's cwd reaches root through a symbolic link",
    'import.meta.dirname',
    'link',
    'Lint it through `<real>`, as in `eslint src` run there. For an editor opened at `<link>`, pass `<link>`, the path ESLint uses, as `root`',
  ],
  [
    '`root` names a link',
    '<link>',
    'real',
    'Pass `import.meta.dirname`, or the real path, `<real>`, as `root`',
  ],
] as const)('fails loudly when %s', async (_name, root, cwd, advice) => {
  await using project = await withTmpProject('eslint-root')
  const real = path.join(project.dir, 'real')
  const link = path.join(project.dir, 'link')
  const fill = (text: string) =>
    text.replaceAll('<real>', () => real).replaceAll('<link>', () => link)
  await writeFiles(real, {
    'src/example.js': 'console.log(process.argv)\n',
    'eslint.config.mjs': `
      import { defineConfig } from ${CONFIG_URL}
      export default defineConfig({ root: ${fill(root === '<link>' ? JSON.stringify(root) : root)}, typeAware: false })
    `,
  })
  await symlink(real, link)
  const [from, to] = cwd === 'link' ? [link, real] : [real, link]
  vi.stubEnv('CI', '1')
  try {
    await expect(
      new ESLint({ cwd: path.join(project.dir, cwd) }).lintFiles(['src/example.js']),
    ).rejects.toThrow(
      `through \`${from}\`, another path to \`${to}\`, and matches configs by path text, so none of the presets' configs apply. ${fill(advice)}`,
    )
  } finally {
    vi.unstubAllEnvs()
  }
})

test.each([
  [true, false, 'Pass `import.meta.dirname`, or the real path, `/real`, as `root`'],
  [
    true,
    true,
    'Pass `import.meta.dirname`, or the real path, `/real`, as `root`, or open `/link` in your editor instead of `/real`',
  ],
  [
    false,
    false,
    'Lint it through `/link`, as in `eslint src` run there. For an editor opened at `/real`, pass `/real`, the path ESLint uses, as `root`',
  ],
  [
    false,
    true,
    'Pass `/real`, the path ESLint uses, as `root`, or open `/link` in your editor instead of `/real`',
  ],
])('advises a real path of %s, in an editor: %s', (isRealDir, isInEditor, expected) => {
  expect(describeRootSpellingFix({ root: '/link', dir: '/real', isRealDir, isInEditor })).toBe(
    expected,
  )
})

test('leaves the files outside root to the configs after it', async () => {
  await using project = await withTmpProject('eslint-root', {
    'web/src/a.ts': 'export const a = 1\n',
    'scripts/a.js': 'var x = y\n',
    'scripts/b.ts': 'var x = y\n',
  })
  const configs = await defineConfig({ root: path.join(project.dir, 'web'), typeAware: false })
  const eslint = eslintWith(project.dir, [
    ...configs,
    {
      files: ['scripts/**/*.js', 'scripts/**/*.ts'],
      rules: { 'no-undef': 'error', 'no-var': 'error' },
    },
  ])
  for (const file of ['scripts/a.js', 'scripts/b.ts']) {
    const [result] = await eslint.lintFiles([file])
    expect(
      result?.messages.map(({ ruleId }) => ruleId),
      file,
    ).toEqual(['no-var', 'no-undef'])
  }
})

test('puts only globs in the `files` and `ignores` of every config', async () => {
  await using project = await withTmpProject('eslint-root', { 'src/a.js': '' })
  const configs: Array<Linter.Config> = await defineConfig({ root: project.dir, typeAware: false })
  // @eslint/config-inspector calls minimatch on each, which throws on a function
  const nonStrings = configs.flatMap((config) =>
    [...(config.files ?? []), ...(config.ignores ?? [])]
      .flat()
      .filter((glob: unknown) => typeof glob !== 'string'),
  )
  expect(nonStrings).toEqual([])
})
