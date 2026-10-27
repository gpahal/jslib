import fs from 'node:fs/promises'
import path from 'node:path'

import { runNodeOk } from '@gpahal/internal/node/testing'

import {
  checkCorePeerVersions,
  checkPeerVersions,
  checkTypescriptInstalled,
  combinePeerErrors,
  importPeers,
  warnOfSonarjsTypescriptCopy,
} from '@/internal/peers'

import { captureWarnings, CORE_AREAS_OFF, FIXTURES_DIR, withProject } from './helpers'

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

/**
 * What a project's job does in the child process, from the folder of the project, with its copy of
 * the package. `lint` lints each case's file with its options and gives its messages or the error
 * that building its config threw
 */
type JobKind = 'lint' | 'astroWithoutJsxA11y' | 'rejections'

/**
 * Runs each project's job in one process, from the project's folder, with the `defineConfig` of the
 * project's own copy of the package. Each copy loads its own modules, and resolves its imports from
 * its project's `node_modules`, which links to only the packages the project gives it, so an
 * optional peer that bundling pulled into the entry point, or that a preset needs without the README
 * saying so, fails to load
 */
const SCRIPT = `
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason.message))
const emitWarning = process.emitWarning

const KINDS = {
  async lint({ defineConfig, ESLint, cases }) {
    const results = []
    for (const { options, file } of cases) {
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
    return results
  },
  // Builds a config that silences the warning, which leaves it to the next config, then two more to
  // check the warning is emitted once
  async astroWithoutJsxA11y({ defineConfig, ESLint, cases: [{ options, file }] }) {
    const warnings = []
    process.emitWarning = (warning, options) => warnings.push([String(warning), options?.code])
    let result
    try {
      for (const warningOptions of [{ GPAHAL_ASTRO_JSX_A11Y_MISSING: false }, {}, {}]) {
        const config = await defineConfig({ root: process.cwd(), ...options, warnings: warningOptions })
        const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: true, overrideConfig: config })
        const [lintResult] = await eslint.lintFiles([file])
        result = {
          a11yRules: config.flatMap((entry) => Object.keys(entry.rules ?? {})).filter((rule) => rule.startsWith('astro/jsx-a11y/')).length,
          messages: lintResult.messages.map((message) => message.ruleId ?? message.message),
        }
      }
    } finally {
      process.emitWarning = emitWarning
    }
    return { result, warnings }
  },
  // A composer made after them loads the same modules in the same order, so once it settles, any
  // of their presets' imports have failed too. The immediate runs after Node's check for unhandled
  // rejections
  async rejections({ defineConfig, cases: [{ options }] }) {
    const start = rejections.length
    let configError
    try {
      defineConfig({ root: process.cwd(), ...options, configs: [null] })
    } catch (caught) {
      configError = caught.message
    }
    const composer = defineConfig({ root: process.cwd(), ...options })
    let argumentError
    try {
      composer.overrideRules(null)
    } catch (caught) {
      argumentError = caught.message
    }
    await defineConfig({ root: process.cwd(), ...options }).then(() => undefined, () => undefined)
    await new Promise((resolve) => setImmediate(resolve))
    const awaited = await composer.then(() => undefined, (caught) => caught.message)
    return { configError, argumentError, rejections: rejections.slice(start), awaited }
  },
}

const output = []
for (const { dir, kind, cases } of JSON.parse(process.env.JOBS)) {
  process.chdir(dir)
  const modules = path.join(dir, 'node_modules')
  const { defineConfig } = await import(pathToFileURL(path.join(modules, '@gpahal/eslint-config/build/index.js')).href)
  const { ESLint } = await import(pathToFileURL(path.join(modules, 'eslint/lib/api.js')).href)
  output.push(await KINDS[kind]({ defineConfig, ESLint, cases }))
}
console.log(JSON.stringify(output))
`

type Job = {
  kind?: JobKind
  presets: Array<Preset>
  peers: Array<string>
  omitted?: Array<string>
  /**
   * Under each preset's options. The default turns off the type information and the core areas of
   * `CORE_AREAS_OFF`, since loading them makes up most of the time building a config takes. The
   * JavaScript-only project's job passes `{}` to keep them on, to check that none of them needs an
   * optional peer
   */
  defaults?: object
}

/**
 * The output of each job, run in one child process from a project of its own, whose
 * `node_modules` holds a copy of the package, what it requires but `omitted`, and `peers`
 */
async function runJobs(jobs: Array<Job>): Promise<Array<unknown>> {
  const projects = await Promise.all(
    jobs.map(async ({ presets, peers, omitted = [] }) => {
      const project = await withProject({
        'package.json': '{ "name": "project", "private": true, "type": "module" }\n',
        'styles.css': "@import 'tailwindcss';\n",
        ...Object.fromEntries(presets.map(({ file, code }) => [file, code])),
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
          await fs.symlink(
            await fs.realpath(path.join(PACKAGE_DIR, 'node_modules', name)),
            link,
            'dir',
          )
        }),
      ])
      return project
    }),
  )
  try {
    const stdout = await runNodeOk(['--input-type=module', '--eval', SCRIPT], {
      env: {
        JOBS: JSON.stringify(
          jobs.map(
            (
              { kind = 'lint', presets, defaults = { typeAware: false, ...CORE_AREAS_OFF } },
              index,
            ) => ({
              dir: projects[index]!.dir,
              kind,
              cases: presets.map(({ options, file }) => ({
                options: { ...defaults, ...options },
                file,
              })),
            }),
          ),
        ),
      },
    })
    return JSON.parse(stdout) as Array<unknown>
  } finally {
    await Promise.all(projects.map(async (project) => project[Symbol.asyncDispose]()))
  }
}

const PRESETS_WITH_PEERS = PRESETS.filter(({ peers }) => peers.length > 0)

test('checkTypescriptInstalled throws only when typescript is needed and missing', async () => {
  await using project = await withProject()
  expect(() => checkTypescriptInstalled(false, project.dir)).not.toThrow()
  expect(() => checkTypescriptInstalled(true, project.dir)).toThrow(
    "@gpahal/eslint-config: `typescript`: needs `typescript`, which isn't installed",
  )
})

describe('a project with some of the peer dependencies', () => {
  type CaseResult = { messages?: Array<string>; error?: string }

  // Every job's output. Each preset with its peers needs a project of its own
  let outputs: {
    javascriptOnly: Array<CaseResult>
    withPeers: Array<Array<CaseResult>>
    withoutPeers: Array<CaseResult>
    astroWithoutJsxA11y: unknown
    rejections: unknown
  }

  beforeAll(async () => {
    const [[javascriptOnly, rejections, withoutPeers, ...withPeers], [astroWithoutJsxA11y]] =
      await Promise.all([
        runJobs([
          { presets: [BASE], peers: [], omitted: ['typescript'], defaults: {} },
          { kind: 'rejections', presets: [preset('react')], peers: [] },
          // One project for every preset
          { presets: PRESETS, peers: [] },
          ...PRESETS_WITH_PEERS.map((p) => ({ presets: [p], peers: p.peers })),
        ]),
        // A process of its own, since eslint-plugin-astro keeps what it found of jsx-a11y for the
        // process
        runJobs([
          {
            kind: 'astroWithoutJsxA11y',
            presets: [preset('astro')],
            peers: ['eslint-plugin-astro'],
          },
        ]),
      ])
    outputs = {
      javascriptOnly: javascriptOnly as Array<CaseResult>,
      withPeers: withPeers as Array<Array<CaseResult>>,
      withoutPeers: withoutPeers as Array<CaseResult>,
      astroWithoutJsxA11y,
      rejections,
    }
  })

  it('loads the config of a JavaScript-only project without typescript', () => {
    expect(outputs.javascriptOnly).toEqual([{ messages: [] }])
  })

  it.each(PRESETS_WITH_PEERS.map((p, index) => [JSON.stringify(p.options), index] as const))(
    'loads the config %s with only its documented peer dependencies',
    (_name, index) => {
      expect(outputs.withPeers[index]).toEqual([{ messages: [] }])
    },
  )

  it.each(
    PRESETS.flatMap((p, index) =>
      p.peers.length > 0 ? [[JSON.stringify(p.options), p, index] as const] : [],
    ),
  )(
    'names the option of the config %s and the packages to install without any optional peer dependency',
    (_name, p, index) => {
      const [option = ''] = Object.keys(p.options)
      const error = outputs.withoutPeers[index]?.error ?? ''
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
    },
  )

  it('loads astro without jsx-a11y where ESLint runs, warns once and leaves out the `astro/jsx-a11y/*` rules', () => {
    expect(outputs.astroWithoutJsxA11y).toEqual({
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

  it('leaves no rejection for a missing peer after an invalid config of yours or a composer argument that throws, which awaiting still gives', () => {
    expect(outputs.rejections).toEqual({
      configError:
        '@gpahal/eslint-config: `configs[0]`: expected a config object or an array of them, received `null`',
      argumentError:
        '@gpahal/eslint-config: `.overrideRules()`: expected an object of rule entries, received `null`',
      rejections: [],
      awaited: expect.stringMatching(/^@gpahal\/eslint-config: `react`: needs `/) as unknown,
    })
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
