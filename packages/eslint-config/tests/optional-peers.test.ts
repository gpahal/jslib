import fs from 'node:fs/promises'
import path from 'node:path'

import { assertBuildIsCurrent, runNodeOk } from '@gpahal/internal/node/testing'

import {
  checkCorePeerVersions,
  checkPeerVersions,
  checkTypescriptInstalled,
  combinePeerErrors,
  importPeers,
  warnOfSonarjsTypescriptCopy,
} from '@/internal/peers'

import { BUILD_DIR, captureWarnings, CORE_AREAS_OFF, FIXTURES_DIR, withProject } from './helpers'

beforeAll(async () => assertBuildIsCurrent(BUILD_DIR))

const PACKAGE_DIR = path.join(import.meta.dirname, '..')

const JSX = 'export function A() {\n  return <div />\n}\n'
const JS = 'export const a = 1\n'
const REACT_PEERS = [
  '@eslint-react/eslint-plugin',
  'eslint-plugin-react-hooks',
  'eslint-plugin-jsx-a11y-x',
  'eslint-plugin-react-refresh',
]

/**
 * Each preset, a file it lints, and the optional peer dependencies the README says it needs
 */
const PRESETS: Array<{ options: object; file: string; code: string; peers: Array<string> }> = [
  { options: {}, file: 'index.js', code: JS, peers: [] },
  {
    options: { react: true },
    file: 'index.jsx',
    code: JSX,
    peers: REACT_PEERS,
  },
  {
    options: { nextjs: true },
    file: 'index.jsx',
    code: JSX,
    peers: [...REACT_PEERS, '@next/eslint-plugin-next'],
  },
  {
    options: { astro: true },
    file: 'page.astro',
    code: '---\nconst a = 1\n---\n\n<p>{a}</p>\n',
    peers: ['eslint-plugin-astro', 'eslint-plugin-jsx-a11y-x'],
  },
  {
    options: { tailwindcss: { entryPoint: 'styles.css' } },
    file: 'index.js',
    code: "export const className = 'flex'\n",
    peers: ['eslint-plugin-better-tailwindcss', 'tailwindcss'],
  },
  {
    options: { html: true },
    file: 'index.html',
    code: '<!doctype html>\n<html lang="en">\n  <head>\n    <meta name="viewport" content="width=device-width" />\n    <title>T</title>\n  </head>\n  <body></body>\n</html>\n',
    peers: ['@html-eslint/parser', '@html-eslint/eslint-plugin'],
  },
  { options: { turbo: true }, file: 'index.js', code: JS, peers: ['eslint-plugin-turbo'] },
  { options: { antislop: true }, file: 'index.js', code: JS, peers: ['eslint-plugin-slop'] },
  {
    options: { vitest: true },
    file: 'index.test.js',
    code: "test('a', () => {\n  expect(1).toBe(1)\n})\n",
    peers: ['@vitest/eslint-plugin'],
  },
  {
    options: { playwright: true },
    file: 'e2e/fixtures.js',
    code: JS,
    peers: ['eslint-plugin-playwright'],
  },
  {
    options: { storybook: true },
    file: 'button.stories.js',
    code: "export default { title: 'Button' }\n\nexport const Primary = {}\n",
    peers: ['eslint-plugin-storybook'],
  },
]

type Preset = (typeof PRESETS)[number]

function preset(option: string): Preset {
  return PRESETS.find((candidate) => Object.hasOwn(candidate.options, option))!
}

const BASE = PRESETS[0]!

type PackageJson = {
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
}

/**
 * Lints each case's file with its options and prints its messages or the error that building its
 * config threw. Run from a project whose `node_modules` holds a copy of the package and links to
 * only the peers given, so an optional peer that bundling pulled into the entry point, or that a
 * preset needs without the README saying so, fails to load
 */
const SCRIPT = `
const { defineConfig } = await import('@gpahal/eslint-config')
const { ESLint } = await import('eslint')
const results = []
for (const { options, file } of JSON.parse(process.env.CASES)) {
  try {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      overrideConfig: await defineConfig({ root: process.cwd(), ...options }),
    })
    const [result] = await eslint.lintFiles([file])
    results.push({ messages: result.messages.map((message) => message.ruleId ?? message.message) })
  } catch (error) {
    results.push({ error: error.message })
  }
}
console.log(JSON.stringify(results))
`

const packageJson = JSON.parse(
  await fs.readFile(path.join(PACKAGE_DIR, 'package.json'), 'utf8'),
) as PackageJson
const optionalPeers = Object.keys(packageJson.peerDependencies).filter(
  (name) => packageJson.peerDependenciesMeta[name]?.optional === true,
)
/**
 * `typescript` is optional for a JavaScript-only project alone, so the projects here have it unless
 * a test leaves it out
 */
const required = [
  ...Object.keys(packageJson.dependencies),
  ...Object.keys(packageJson.peerDependencies).filter(
    (name) => !optionalPeers.includes(name) || name === 'typescript',
  ),
]

test('every optional peer dependency but typescript belongs to a preset', () => {
  expect(new Set(optionalPeers.filter((name) => name !== 'typescript'))).toEqual(
    new Set(PRESETS.flatMap(({ peers }) => peers)),
  )
})

type CaseResult = { messages?: Array<string>; error?: string }

/**
 * Runs `script` on `presets`, with `defaults` under their options, from a project whose
 * `node_modules` holds the package, what it requires but `omitted`, and `peers`. The default
 * `defaults` turn off the type information and the areas that load no optional peer, since loading
 * them makes up most of the time a fresh process takes to build a config. The JavaScript-only
 * project's test passes `{}` to keep them on, to check that none of them needs an optional peer
 */
async function lintInProject<T = CaseResult>(
  presets: Array<Preset>,
  peers: Array<string>,
  {
    script = SCRIPT,
    files = {},
    omitted = [],
    defaults = { typeAware: false, ...CORE_AREAS_OFF },
  }: {
    script?: string
    files?: Record<string, string>
    omitted?: Array<string>
    defaults?: object
  } = {},
): Promise<Array<T>> {
  await using project = await withProject({
    'package.json': '{ "name": "project", "private": true, "type": "module" }\n',
    'styles.css': "@import 'tailwindcss';\n",
    ...Object.fromEntries(presets.map(({ file, code }) => [file, code])),
    ...files,
  })
  const nodeModulesDir = path.join(project.dir, 'node_modules')
  const copyDir = path.join(nodeModulesDir, '@gpahal/eslint-config')
  await fs.mkdir(copyDir, { recursive: true })
  await Promise.all([
    fs.copyFile(path.join(PACKAGE_DIR, 'package.json'), path.join(copyDir, 'package.json')),
    fs.cp(path.join(PACKAGE_DIR, 'build'), path.join(copyDir, 'build'), { recursive: true }),
    ...[...required.filter((name) => !omitted.includes(name)), ...peers].map(async (name) => {
      const link = path.join(nodeModulesDir, name)
      await fs.mkdir(path.dirname(link), { recursive: true })
      await fs.symlink(await fs.realpath(path.join(PACKAGE_DIR, 'node_modules', name)), link, 'dir')
    }),
  ])
  const stdout = await runNodeOk(['--input-type=module', '--eval', script], {
    cwd: project.dir,
    env: {
      CASES: JSON.stringify(
        presets.map(({ options, file }) => ({ options: { ...defaults, ...options }, file })),
      ),
    },
  })
  return JSON.parse(stdout) as Array<T>
}

test('the config of a JavaScript-only project loads without typescript', async () => {
  expect(await lintInProject([BASE], [], { omitted: ['typescript'], defaults: {} })).toEqual([
    { messages: [] },
  ])
})

test('checkTypescriptInstalled throws only when typescript is needed and missing', async () => {
  await using project = await withProject()
  expect(() => checkTypescriptInstalled(false, project.dir)).not.toThrow()
  expect(() => checkTypescriptInstalled(true, project.dir)).toThrow(
    "@gpahal/eslint-config: `typescript`: needs `typescript`, which isn't installed",
  )
})

// Each preset with its peers needs a project of its own
test.concurrent.each(
  PRESETS.filter(({ peers }) => peers.length > 0).map(
    (p) => [JSON.stringify(p.options), p] as const,
  ),
)('the config %s loads with only its documented peer dependencies', async (_name, p) => {
  expect(await lintInProject([p], p.peers)).toEqual([{ messages: [] }])
})

describe('without any optional peer dependency', () => {
  // One project and one process for every preset
  let results: Array<CaseResult> = []
  beforeAll(async () => {
    results = await lintInProject(PRESETS, [])
  })

  it.each(
    PRESETS.flatMap((p, index) =>
      p.peers.length > 0 ? [[JSON.stringify(p.options), p, index] as const] : [],
    ),
  )('the config %s names the option and the packages to install', (_name, p, index) => {
    const [option = ''] = Object.keys(p.options)
    const error = results[index]?.error ?? ''
    expect(error).toMatch(
      new RegExp(
        `^@gpahal/eslint-config: \`${option}\`: needs \`.+, which (?:isn't|aren't) installed\\. Install (?:it as a dev dependency|them as dev dependencies), as in \`pnpm add -D [^\`]+\`$`,
      ),
    )
    expect(error).toContain(`\`${p.peers[0]!}\``)
    const otherPeers = optionalPeers.filter((name) => !p.peers.includes(name))
    for (const peer of otherPeers) {
      expect(error).not.toContain(`\`${peer}\``)
    }
  })
})

test('astro without jsx-a11y where ESLint runs loads, warns once and leaves out the `astro/jsx-a11y/*` rules', async () => {
  // Builds a config that silences the warning, which leaves it to the next config, then two more
  // to check the warning is emitted once
  const script = `
const { defineConfig } = await import('@gpahal/eslint-config')
const { ESLint } = await import('eslint')
const warnings = []
process.emitWarning = (warning, options) => warnings.push([String(warning), options?.code])
const [{ options, file }] = JSON.parse(process.env.CASES)
let result
for (const warningOptions of [{ GPAHAL_ASTRO_JSX_A11Y_MISSING: false }, {}, {}]) {
  const config = await defineConfig({ root: process.cwd(), ...options, warnings: warningOptions })
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: true, overrideConfig: config })
  const [lintResult] = await eslint.lintFiles([file])
  result = {
    a11yRules: config.flatMap((entry) => Object.keys(entry.rules ?? {})).filter((rule) => rule.startsWith('astro/jsx-a11y/')).length,
    messages: lintResult.messages.map((message) => message.ruleId ?? message.message),
  }
}
console.log(JSON.stringify([{ result, warnings }]))
`
  const [output] = await lintInProject<{ result: unknown; warnings: unknown }>(
    [preset('astro')],
    ['eslint-plugin-astro'],
    {
      script,
    },
  )
  expect(output).toEqual({
    result: { a11yRules: 0, messages: [] },
    warnings: [
      [
        expect.stringMatching(
          /^@gpahal\/eslint-config: `astro`: `eslint-plugin-jsx-a11y-x` or `eslint-plugin-jsx-a11y` isn't installed where ESLint runs, `\/.+`, so the `astro\/jsx-a11y\/\*` rules are off\. Install it as a dev dependency there, as in `pnpm add -D eslint-plugin-jsx-a11y-x`$/,
        ),
        'GPAHAL_ASTRO_JSX_A11Y_MISSING',
      ],
    ],
  })
})

test('an invalid config of yours, or a composer argument that throws, leaves no rejection for a missing peer, which awaiting still gives', async () => {
  // A composer made after them loads the same modules in the same order, so once it settles, any
  // of their presets' imports have failed too. The immediate runs after Node's check for unhandled
  // rejections
  const script = `
const { defineConfig } = await import('@gpahal/eslint-config')
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason.message))
let configError
try {
  defineConfig({ root: process.cwd(), react: true, configs: [null] })
} catch (caught) {
  configError = caught.message
}
const composer = defineConfig({ root: process.cwd(), react: true })
let argumentError
try {
  composer.overrideRules(null)
} catch (caught) {
  argumentError = caught.message
}
await defineConfig({ root: process.cwd(), react: true }).then(() => undefined, () => undefined)
await new Promise((resolve) => setImmediate(resolve))
const awaited = await composer.then(() => undefined, (caught) => caught.message)
console.log(JSON.stringify([{ configError, argumentError, rejections, awaited }]))
`
  const [result] = await lintInProject([preset('react')], [], { script })
  expect(result).toEqual({
    configError:
      '@gpahal/eslint-config: `configs[0]`: expected a config object or an array of them, received `null`',
    argumentError:
      '@gpahal/eslint-config: `.overrideRules()`: expected an object of rule entries, received `null`',
    rejections: [],
    awaited: expect.stringMatching(/^@gpahal\/eslint-config: `react`: needs `/) as unknown,
  })
})

const NEXT_PLUGIN = 'node_modules/@next/eslint-plugin-next/package.json'

describe('checkPeerVersions', () => {
  it.each([['15.0.0', '{"version":"15.0.0"}']])(
    'rejects %s, outside the range',
    async (version, manifest) => {
      await using project = await withProject({ [NEXT_PLUGIN]: manifest })
      expect(() => checkPeerVersions('nextjs', ['@next/eslint-plugin-next'], project.dir)).toThrow(
        `@gpahal/eslint-config: \`nextjs\`: needs @next/eslint-plugin-next ^16.3, but ${version} is installed. Run \`pnpm add -D "@next/eslint-plugin-next@^16.3"\``,
      )
    },
  )

  it('warns once for a version newer than the range', async () => {
    await using project = await withProject({ [NEXT_PLUGIN]: '{"version":"17.0.0"}' })
    expect(
      captureWarnings(() => {
        checkPeerVersions('nextjs', ['@next/eslint-plugin-next'], project.dir)
        checkPeerVersions('nextjs', ['@next/eslint-plugin-next'], project.dir)
      }),
    ).toEqual([
      [
        '@gpahal/eslint-config: `nextjs`: @next/eslint-plugin-next 17.0.0 is newer than the tested range ^16.3, so its rules may break. If they do, install a version in the range, as in `pnpm add -D "@next/eslint-plugin-next@^16.3"`',
        'GPAHAL_PEER_NEWER_THAN_RANGE',
      ],
    ])
  })
})

test("a plugin that throws when it loads names the preset's option and keeps the error as the cause", async () => {
  const error = new Error('Plugin went boom.')
  // A fresh module graph, since an earlier test may have loaded the plugin
  vi.resetModules()
  // A getter, since Vitest wraps an error that the factory throws
  vi.doMock('eslint-plugin-turbo', () => ({
    get default(): never {
      throw error
    },
  }))
  try {
    const { defineConfig } = await import('@/index')
    await expect(
      defineConfig({ root: path.join(FIXTURES_DIR, 'turbo'), turbo: true }),
    ).rejects.toThrow(
      expect.objectContaining({
        // ESLint's CLI prints only the stack, so the message carries the plugin's
        message: "@gpahal/eslint-config: `turbo`: can't load the preset: Plugin went boom",
        cause: error,
      }),
    )
  } finally {
    vi.doUnmock('eslint-plugin-turbo')
  }
})

describe('combinePeerErrors', () => {
  const notFound = Object.assign(new Error("Cannot find package 'x'"), {
    code: 'ERR_MODULE_NOT_FOUND',
  })

  async function missingPeers(option: string, peers: Array<string>): Promise<unknown> {
    try {
      await importPeers(option, peers, async () => {
        throw notFound
      })
    } catch (error) {
      return error
    }
    return undefined
  }

  it('lists the missing peers of two options with one install command', async () => {
    const errors = [
      await missingPeers('react', ['missing-peer-a', 'missing-peer-b']),
      new Error('another error'),
      await missingPeers('vitest', ['missing-peer-c']),
    ]
    expect(combinePeerErrors(errors)).toEqual(
      expect.objectContaining({
        message: [
          '@gpahal/eslint-config: options: 2 issues',
          "  `react`: needs `missing-peer-a` and `missing-peer-b`, which aren't installed",
          "  `vitest`: needs `missing-peer-c`, which isn't installed",
          'Install them as dev dependencies, as in `pnpm add -D missing-peer-a missing-peer-b missing-peer-c`',
        ].join('\n'),
        cause: expect.any(AggregateError) as unknown,
      }),
    )
  })
})

test('checkCorePeerVersions rejects ESLint and TypeScript older than their ranges together', async () => {
  await using project = await withProject({
    'node_modules/eslint/package.json': '{"name":"eslint","version":"9.39.0"}',
    'node_modules/typescript/package.json': '{"name":"typescript","version":"5.9.3"}',
    'package-lock.json': '{}\n',
  })
  expect(() => checkCorePeerVersions(project.dir)).toThrow(
    '@gpahal/eslint-config: peer dependencies: needs eslint ^10.11, but 9.39.0 is installed, and typescript ~6.0.3, but 5.9.3 is installed. Run `npm install -D "eslint@^10.11" "typescript@~6.0.3"`',
  )
})

describe('warnOfSonarjsTypescriptCopy', () => {
  const PARSER = {
    'node_modules/@typescript-eslint/parser/package.json': '{"name":"@typescript-eslint/parser"}',
    'node_modules/eslint-plugin-sonarjs/package.json': '{"name":"eslint-plugin-sonarjs"}',
    'node_modules/typescript/package.json': '{"name":"typescript","version":"6.0.3"}',
  }

  it('warns once when sonarjs keeps a TypeScript copy of its own in a pnpm layout', async () => {
    const store = 'node_modules/.pnpm/eslint-plugin-sonarjs@4.0.0/node_modules'
    await using project = await withProject({
      ...PARSER,
      [`${store}/eslint-plugin-sonarjs/package.json`]: '{"name":"eslint-plugin-sonarjs"}',
      [`${store}/typescript/package.json`]: '{"name":"typescript","version":"5.8.2"}',
    })
    const link = path.join(project.dir, 'node_modules/eslint-plugin-sonarjs')
    await fs.rm(link, { recursive: true })
    await fs.symlink(path.join(project.dir, store, 'eslint-plugin-sonarjs'), link, 'dir')
    const dir = await fs.realpath(project.dir)
    expect(
      captureWarnings(() => {
        warnOfSonarjsTypescriptCopy(project.dir)
        warnOfSonarjsTypescriptCopy(project.dir)
      }),
    ).toEqual([
      [
        expect.stringContaining(
          `loads TypeScript from \`${path.join(dir, store, 'typescript')}\`, but typescript-eslint loads it from \`${path.join(dir, 'node_modules/typescript')}\``,
        ),
        'GPAHAL_SONARJS_TYPESCRIPT_COPY',
      ],
    ])
  })

  it("doesn't warn when both load one copy", async () => {
    await using project = await withProject(PARSER)
    expect(captureWarnings(() => warnOfSonarjsTypescriptCopy(project.dir))).toEqual([])
  })
})
