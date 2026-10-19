import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertBuildIsCurrent, runNode, withTmpProject } from '@gpahal/internal/node/testing'

import { getFontFallbacks } from '@/index'

import { FIGTREE_PATH, FIXTURES_DIR } from './fixtures'
import { readBytes, setUint16 } from './helpers'

const BUILD_DIR = path.join(import.meta.dirname, '..', 'build')
const CLI_PATH = path.join(BUILD_DIR, 'cli.js')
/**
 * A module that replaces `fetch` in the CLI's process: it logs each URL to stderr and serves
 * Figtree Regular, but for the host `fail.test`, where it fails silently as `fetch` does, with a
 * cause that holds the URL. The DNS lookup of the hosts, which don't exist, resolves to
 * example.com's address
 */
const FETCH_STUB = String.raw`
import dns from 'node:dns/promises'
import { readFileSync } from 'node:fs'
dns.lookup = async () => [{ address: '93.184.215.14', family: 4 }]
globalThis.fetch = async (input) => {
  if (new URL(input).host === 'fail.test') {
    throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED ' + String(input)) })
  }
  process.stderr.write('fetch ' + String(input) + '\n')
  return new Response(readFileSync(${JSON.stringify(FIGTREE_PATH)}), {
    headers: { 'content-type': 'font/ttf' },
  })
}
`

/**
 * Runs the built CLI without colours, with `fetch` stubbed when `stubFetch` is set
 */
async function runCli(
  args: Array<string>,
  { cwd, stubFetch = false }: { cwd?: string | undefined; stubFetch?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const nodeArgs = stubFetch
    ? ['--import', `data:text/javascript,${encodeURIComponent(FETCH_STUB)}`]
    : []
  const { stdout, stderr, status } = await runNode([...nodeArgs, CLI_PATH, ...args], {
    cwd,
    env: { NO_COLOR: '1' },
  })
  return { stdout, stderr, exitCode: status }
}

/**
 * Runs the built CLI with `input` as its stdin, or with stdin left open when it's `undefined`.
 * `runNode` ignores stdin, so this spawns Node as it does
 */
async function runCliWithInput(
  args: Array<string>,
  input: Uint8Array | undefined,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  // The CLI stops reading past the limit, so a write it never reads fails with EPIPE
  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    expect(error.code).toBe('EPIPE')
  })
  if (input !== undefined) {
    child.stdin.end(input)
  }
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode) => {
      child.stdin.destroy()
      resolve({ stdout, stderr, exitCode })
    })
  })
}

const SOURCE_RULE = 'expected an https:// URL, a font path or a family name'

beforeAll(async () => assertBuildIsCurrent(BUILD_DIR))

test(
  'prints the font-family stack, a table of the overrides and the rules',
  { timeout: 30_000 },
  async () => {
    const { stdout, exitCode } = await runCli(['Figtree', '-f', 'Arial'])
    const { css, fontFamily } = await getFontFallbacks('Figtree', { fallbacks: ['Arial'] })
    expect(exitCode).toBe(0)
    expect(stdout).toContain(`font-family\n${fontFamily}\n`)
    expect(stdout).toMatch(/^Fallback\s+size-adjust\s+ascent\s+descent\s+line-gap\n/m)
    expect(stdout).toMatch(/^Arial\s+100\.72%\s+94\.32%\s+24\.82%\s+0%\n/m)
    expect(stdout).toContain(`CSS\n${css}\n`)
  },
)

test(
  "notes a font file's line height on Windows when it differs from hhea's",
  { timeout: 30_000 },
  async () => {
    await using project = await withTmpProject('font-fallback')
    const bytes = await readBytes(FIGTREE_PATH)
    // Clear USE_TYPO_METRICS, bit 7 of OS/2 `fsSelection` at 62, and set `usWinAscent` and
    // `usWinDescent`, at 74 and 76, to a box of 1500 units over hhea's 1200. The fallbacks' lines,
    // 1200 units, are 20% shorter than the web font's 1500
    setUint16(bytes, 'OS/2', 62, 0x40)
    setUint16(bytes, 'OS/2', 74, 1100)
    setUint16(bytes, 'OS/2', 76, 400)
    await writeFile(path.join(project.dir, 'win.ttf'), bytes)
    const args = ['win.ttf', '-n', 'Figtree', '-f', 'Arial']
    const { stdout, exitCode } = await runCli(args, { cwd: project.dir })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(
      /^Arial\s[^\n]+\nNote: the font's line height on Windows differs from its hhea one, which the overrides match, so there the fallbacks' lines are about 20% shorter than the web font's\n\nCSS\n/mu,
    )
  },
)

test(
  'prints only the rules with --css, and everything as JSON with --json',
  { timeout: 30_000 },
  async () => {
    const result = await getFontFallbacks('Figtree', { fallbacks: ['Arial'] })
    expect((await runCli(['Figtree', '-f', 'Arial', '--css'])).stdout).toBe(`${result.css}\n`)
    expect(JSON.parse((await runCli(['Figtree', '-f', 'Arial', '--json'])).stdout)).toEqual(result)
  },
)

test('reads a path, absolute or relative', { timeout: 30_000 }, async () => {
  const { css } = await getFontFallbacks(pathToFileURL(FIGTREE_PATH), {
    name: 'Display',
    category: 'serif',
  })
  for (const [arg, cwd] of [
    [FIGTREE_PATH, undefined],
    [path.basename(FIGTREE_PATH), FIXTURES_DIR],
  ] as const) {
    const { stdout, exitCode } = await runCli([arg, '-n', 'Display', '-c', 'serif', '--css'], {
      cwd,
    })
    expect(exitCode).toBe(0)
    expect(stdout).toBe(`${css}\n`)
  }
})

test(
  'needs --name for a font file, and --category or --fallback for an unknown name',
  { timeout: 30_000 },
  async () => {
    const missing = await runCli(['https://cdn.test/f.ttf', '-f', 'Arial'], { stubFetch: true })
    expect(missing.exitCode).toBe(1)
    expect(missing.stderr).toBe(
      'error: @gpahal/font-fallback: `--name`: is required for a font file, URL or stdin. Pass the font-family name of your @font-face\n',
    )
    const unknown = await runCli([FIGTREE_PATH, '-n', 'figtree'])
    expect(unknown.exitCode).toBe(1)
    expect(unknown.stderr).toBe(
      "error: @gpahal/font-fallback: `--name`: `figtree` isn't a family in @capsizecss/metrics, so pass `-c`/`--category` or `-f`/`--fallback`. Did you mean `Figtree`?\n",
    )
  },
)

test('fetches an https: URL as written', { timeout: 30_000 }, async () => {
  const { stdout, stderr, exitCode } = await runCli(
    ['HTTPS://cdn.test/F.ttf', '-n', 'Figtree', '-f', 'Roboto', '--css'],
    { stubFetch: true },
  )
  expect(stderr).toBe('fetch https://cdn.test/F.ttf\n')
  expect(exitCode).toBe(0)
  expect(stdout).toContain("font-family: 'Figtree fallback Roboto';")
})

test.each([
  [
    ['http://cdn.test/f.ttf'],
    `font: ${SOURCE_RULE}, received a string that starts with \`"http:"\`. Pass its https:// URL`,
  ],
  [
    ['file:fonts/x.ttf'],
    `font: ${SOURCE_RULE}, received a string that starts with \`"file:"\`. Pass the font's path, or a file:/// URL`,
  ],
  [
    ['Inter', '-c', 'display'],
    '`--category`: expected `sans-serif`, `serif` or `monospace`, received `"display"`',
  ],
  [
    ['--', '-f.ttf', '--css'],
    'arguments: expected one font, received 2 fonts. Put options before `--`',
  ],
  [
    ['Inter', '--bad'],
    `arguments: failed to parse: Unknown option '--bad'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--bad". Run font-fallback --help for the options`,
  ],
  [['Inter', '--css', '--json'], "`--css` and `--json`: can't be combined. Drop one"],
])('fails with a message for %j', { timeout: 30_000 }, async (args, message) => {
  const { stderr, exitCode } = await runCli(args)
  expect(exitCode).toBe(1)
  expect(stderr).toBe(`error: @gpahal/font-fallback: ${message}\n`)
})

test('reads a name with a slash as a path', { timeout: 30_000 }, async () => {
  await using project = await withTmpProject('font-fallback')
  const { stderr, exitCode } = await runCli(['fonts/inter', '-n', 'Foo'], { cwd: project.dir })
  expect(exitCode).toBe(1)
  expect(stderr).toBe(
    `error: @gpahal/font-fallback: font ${path.join(project.dir, 'fonts/inter')}: expected a path that ends in .ttf, .otf or .woff2, received \`"inter"\`\n`,
  )
})

test(
  'names -f in the error when every default fallback is out of range',
  { timeout: 30_000 },
  async () => {
    const { stderr, exitCode } = await runCli(['Six Caps'])
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(
      /^error: @gpahal\/font-fallback: family `Six Caps`: 4 issues\. Every default fallback is out of range\. Pass `-f`\/`--fallback`\n(?: {2}fallback `[^`]+`: [^\n]+ for a size-adjusted fallback\n){4}$/u,
    )
  },
)

test('keeps URL credentials and tokens out of stderr', { timeout: 30_000 }, async () => {
  for (const url of ['file://u:hunter2@x/a.ttf?t=s3cr3t', 'https://user:hunter2@fail.test/f.ttf']) {
    const { stderr, exitCode } = await runCli([url, '-n', 'Figtree'], { stubFetch: true })
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(/^error: @gpahal\/font-fallback: font/)
    expect(stderr).not.toMatch(/hunter2|s3cr3t/)
  }
  // A failure prints no cause, which holds the URL
  const failed = await runCli(['https://fail.test/f.ttf', '-n', 'Figtree'], { stubFetch: true })
  expect(failed.stderr).toBe(
    'error: @gpahal/font-fallback: font https://fail.test/f.ttf: failed to fetch\n',
  )
})

test('prints the causes of an error for a font path', { timeout: 30_000 }, async () => {
  const missingPath = path.join(FIXTURES_DIR, 'missing.ttf')
  const missing = await runCli([missingPath, '-n', 'Figtree'])
  expect(missing.exitCode).toBe(1)
  expect(missing.stderr).toBe(
    `error: @gpahal/font-fallback: font ${missingPath}: failed to read: ENOENT\n  Caused by: Error: ENOENT: no such file or directory, open '${missingPath}'\n`,
  )
})

test('escapes control characters of the arguments in errors', { timeout: 30_000 }, async () => {
  for (const args of [['\u{1B}[31mInter'], ['Inter', '--\u{1B}[31m']]) {
    const { stderr, exitCode } = await runCli(args)
    expect(exitCode).toBe(1)
    expect(stderr).toContain(String.raw`\u001b[31m`)
    expect(stderr).not.toContain('\u{1B}')
  }
})

test('prints the version with --version', { timeout: 30_000 }, async () => {
  const { version } = JSON.parse(
    await readFile(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  ) as { version: string }
  const { stdout, exitCode } = await runCli(['Inter', '--version'])
  expect(exitCode).toBe(0)
  expect(stdout).toBe(`${version}\n`)
})

test('prints the help, and fails without a font', { timeout: 30_000 }, async () => {
  const help = await runCli(['-h'])
  expect(help.exitCode).toBe(0)
  expect(help.stdout).toMatch(/^Usage: font-fallback <font> /)
  const missing = await runCli([])
  expect(missing.exitCode).toBe(1)
  expect(missing.stdout).toBe('')
  expect(missing.stderr).toBe(help.stdout)
})

test('reads a font from stdin for -', { timeout: 30_000 }, async () => {
  const bytes = await readBytes(FIGTREE_PATH)
  const { css } = await getFontFallbacks(bytes, { name: 'Figtree', fallbacks: ['Arial'] })
  const { stdout, stderr, exitCode } = await runCliWithInput(
    ['-', '-n', 'Figtree', '-f', 'Arial', '--css'],
    bytes,
  )
  expect(stderr).toBe('')
  expect(exitCode).toBe(0)
  expect(stdout).toBe(`${css}\n`)
})

test('needs --name for a font from stdin, before reading it', { timeout: 30_000 }, async () => {
  // Stdin stays open, so the CLI exits only if it checks --name first
  const { stderr, exitCode } = await runCliWithInput(['-', '-f', 'Arial'], undefined)
  expect(exitCode).toBe(1)
  expect(stderr).toBe(
    'error: @gpahal/font-fallback: `--name`: is required for a font file, URL or stdin. Pass the font-family name of your @font-face\n',
  )
})

test('rejects a font from stdin over 20 MiB', { timeout: 30_000 }, async () => {
  const { stderr, exitCode } = await runCliWithInput(
    ['-', '-n', 'Figtree', '-f', 'Arial'],
    new Uint8Array(20 * 1024 * 1024 + 1),
  )
  expect(exitCode).toBe(1)
  expect(stderr).toBe(
    "error: @gpahal/font-fallback: font bytes: it's over the limit of 20971520 bytes\n",
  )
})
