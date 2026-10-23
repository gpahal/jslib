/**
 * Helpers for the packages' tests. Contract: the tests' own values
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describeValue, formatMessage } from '@gpahal/std/errors'

const PREFIX = '@gpahal/internal'

export type RunNodeOptions = {
  cwd?: string | undefined
  /**
   * Variables added to this process's environment, or removed from it when `undefined`
   */
  env?: Readonly<Record<string, string | undefined>> | undefined
  /**
   * The text written to stdin, which then ends
   */
  input?: string | undefined
  /**
   * The milliseconds after which the process is killed with `SIGKILL`. Default is no limit
   */
  timeout?: number | undefined
}

export type NodeResult = {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

function childEnv(env: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const removed = new Set(
    Object.entries(env)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name),
  )
  const merged: NodeJS.ProcessEnv = { ...process.env, ...env, NODE_PATH: '' }
  const { NODE_OPTIONS: _, ...rest } = merged
  return Object.fromEntries(Object.entries(rest).filter(([name]) => !removed.has(name)))
}

/**
 * Run Node with `args`, resolving when the process ends, whatever its exit code. `NODE_PATH` is
 * always empty, even with `env`, since pnpm sets it to its store for package scripts, which would
 * hide a missing dependency. `NODE_OPTIONS` is always unset, so the test runner's loaders and flags
 * don't change the child
 */
export async function runNode(
  args: ReadonlyArray<string>,
  { cwd, env = {}, input, timeout }: RunNodeOptions = {},
): Promise<NodeResult> {
  const child = spawn(process.execPath, args, {
    cwd,
    env: childEnv(env),
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(timeout !== undefined && { timeout, killSignal: 'SIGKILL' }),
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  // A process that exits before reading its input closes the pipe, which the result reports
  child.stdin.on('error', () => {
    // Ignored
  })
  child.stdin.end(input)
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr })
    })
  })
}

/**
 * The output of {@link runNode} when the process exits with 0
 *
 * @throws Error with the process's `stderr` when it exits otherwise.
 */
export async function runNodeOk(
  args: ReadonlyArray<string>,
  options: RunNodeOptions = {},
): Promise<string> {
  const { status, signal, stdout, stderr } = await runNode(args, options)
  if (status !== 0) {
    const ending = signal === null ? `exited with ${String(status)}` : `was killed with ${signal}`
    throw new Error(formatMessage(PREFIX, ['`runNodeOk`'], `node ${ending}\n${stderr}`))
  }
  return stdout
}

export async function writeFiles(
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      const filePath = path.join(dir, file)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content)
    }),
  )
}

/**
 * A temporary folder with `files` in it, removed when disposed. Its path is the real one, since a
 * symlinked temporary folder, as on macOS, changes how some tools resolve paths
 */
export async function withTmpProject(
  prefix: string,
  files: Readonly<Record<string, string>> = {},
): Promise<AsyncDisposable & { dir: string }> {
  const tmpDir = await fs.mkdtempDisposable(path.join(os.tmpdir(), `${prefix}-`))
  try {
    const dir = await fs.realpath(tmpDir.path)
    await writeFiles(dir, files)
    return { dir, [Symbol.asyncDispose]: async () => tmpDir[Symbol.asyncDispose]() }
  } catch (error) {
    await tmpDir[Symbol.asyncDispose]()
    throw error
  }
}

export type Call = {
  thisArg: unknown
  args: ReadonlyArray<unknown>
  result: unknown
}

/**
 * A method by its owner, such as `String.prototype`, and key, with an optional weight of a call,
 * such as the length of the array it scans. A call without a weight adds 1
 */
export type CallTarget =
  | readonly [owner: object, key: PropertyKey]
  | readonly [owner: object, key: PropertyKey, weigh: (call: Call) => number]

/**
 * How many times `fn` called each of `targets`, by name, or the sum of the calls' weights. Each
 * method is wrapped while `fn` runs, until the promise it returns settles, and restored after, even
 * when `fn` throws. Calls from inside a target, such as `RegExp.prototype.test` calling `exec`,
 * count too, as do calls from other code that runs meanwhile. A count without weights is of calls,
 * not of the work in each, so a scaling test needs targets its code calls once per step
 *
 * @throws Error when a target isn't an own method of its owner.
 */
export function countCalls(
  fn: () => Promise<unknown>,
  targets: Readonly<Record<string, CallTarget>>,
): Promise<Record<string, number>>
export function countCalls(
  fn: () => unknown,
  targets: Readonly<Record<string, CallTarget>>,
): Record<string, number>
export function countCalls(
  fn: () => unknown,
  targets: Readonly<Record<string, CallTarget>>,
): Record<string, number> | Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const wrapped: Array<{
    owner: object
    key: PropertyKey
    original: PropertyDescriptor
    wrapper: PropertyDescriptor
  }> = []
  for (const [name, [owner, key, weigh]] of Object.entries(targets)) {
    const original = Object.getOwnPropertyDescriptor(owner, key)
    const method: unknown = original?.value
    if (original === undefined || typeof method !== 'function') {
      throw new Error(
        formatMessage(
          PREFIX,
          ['`countCalls`', `\`targets.${name}\``],
          `expected an own method, received ${describeValue(method)}`,
        ),
      )
    }
    counts[name] = 0
    const value = function (this: unknown, ...args: Array<unknown>): unknown {
      const result: unknown = Reflect.apply(method, this, args)
      counts[name] = (counts[name] ?? 0) + (weigh?.({ thisArg: this, args, result }) ?? 1)
      return result
    }
    wrapped.push({ owner, key, original, wrapper: { ...original, value } })
  }
  // Index loops, since a target can be what a `for…of` loop calls
  const restore = () => {
    // In reverse, so a target listed twice ends as it started
    for (let index = wrapped.length - 1; index >= 0; index--) {
      const target = wrapped[index]
      if (target !== undefined) {
        Object.defineProperty(target.owner, target.key, target.original)
      }
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- A `for…of` loop would call `ArrayIterator#next`, which can be a target, once it's wrapped
    for (let index = 0; index < wrapped.length; index++) {
      const target = wrapped[index]
      if (target !== undefined) {
        Object.defineProperty(target.owner, target.key, target.wrapper)
      }
    }
    const result = fn()
    if (result instanceof Promise) {
      return settleThenRestore(result, counts, restore)
    }
  } catch (error) {
    restore()
    throw error
  }
  restore()
  return counts
}

async function settleThenRestore(
  promise: Promise<unknown>,
  counts: Record<string, number>,
  restore: () => void,
): Promise<Record<string, number>> {
  try {
    await promise
    return counts
  } finally {
    restore()
  }
}

/**
 * `Array.isArray`, kept before {@link countWork} wraps it, so weighing a call doesn't count as one
 */
const isArray = Array.isArray

function lengthOf(value: unknown): number {
  return typeof value === 'string' || isArray(value) ? value.length : 1
}

function receiverLength({ thisArg }: Call): number {
  return lengthOf(thisArg)
}

function resultLength({ result }: Call): number {
  return lengthOf(result)
}

/**
 * The code units a `String.prototype.indexOf` call read, to the end of the match or the string
 */
function indexOfLength({ thisArg, args, result }: Call): number {
  const length = lengthOf(thisArg)
  const from = Math.trunc(Number(args[1] ?? 0))
  const start = Number.isNaN(from) ? 0 : Math.min(Math.max(from, 0), length)
  const end = typeof result === 'number' && result !== -1 ? result + String(args[0]).length : length
  return Math.max(end - start, 1)
}

const SCAN_METHODS = [
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'lastIndexOf',
  'map',
  'reduce',
  'some',
] as const

/**
 * Array scans weigh the whole length even when they stop early, so a scan's weight is its worst
 * case. Copies weigh the copy's length, and other searches, regex runs and lookups count 1
 */
const WORK_TARGETS: Readonly<Record<string, CallTarget>> = {
  ...Object.fromEntries(
    SCAN_METHODS.map((key) => [`Array#${key}`, [Array.prototype, key, receiverLength]]),
  ),
  'Array#concat': [Array.prototype, 'concat', resultLength],
  'Array#slice': [Array.prototype, 'slice', resultLength],
  'String#slice': [String.prototype, 'slice', resultLength],
  'String#substring': [String.prototype, 'substring', resultLength],
  'String#split': [String.prototype, 'split', receiverLength],
  'String#endsWith': [String.prototype, 'endsWith'],
  'String#includes': [String.prototype, 'includes'],
  'String#indexOf': [String.prototype, 'indexOf', indexOfLength],
  'String#lastIndexOf': [String.prototype, 'lastIndexOf'],
  'String#startsWith': [String.prototype, 'startsWith'],
  'RegExp#exec': [RegExp.prototype, 'exec'],
  // Each item that a `for…of` loop or a spread reads from an array
  'ArrayIterator#next': [Reflect.getPrototypeOf([].values()) ?? {}, 'next'],
  'Array.isArray': [Array, 'isArray'],
  'Object.hasOwn': [Object, 'hasOwn'],
  'Reflect.get': [Reflect, 'get'],
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0)
}

async function sumSettledCounts(counts: Promise<Record<string, number>>): Promise<number> {
  return sumCounts(await counts)
}

/**
 * A deterministic measure of the work `fn` does, for scaling tests: the summed, weighted calls to
 * common builtins. A loop that calls none of them, or a regex that backtracks, isn't measured. Use
 * {@link minCpuMs} for that
 */
export function countWork(fn: () => Promise<unknown>): Promise<number>
export function countWork(fn: () => unknown): number
export function countWork(fn: () => unknown): number | Promise<number> {
  const counts: Record<string, number> | Promise<Record<string, number>> = countCalls(
    fn,
    WORK_TARGETS,
  )
  return counts instanceof Promise ? sumSettledCounts(counts) : sumCounts(counts)
}

/**
 * The least CPU time, in milliseconds, this thread spent in each of `fns` over `runs` rounds. Unlike
 * wall-clock time, it leaves out time other processes take, and interleaving the runs spreads a
 * slower period across all of them
 */
export function minCpuMs(fns: ReadonlyArray<() => unknown>, runs = 3): Array<number> {
  const mins = fns.map(() => Infinity)
  for (let run = 0; run < runs; run++) {
    for (const [index, fn] of fns.entries()) {
      const start = process.threadCpuUsage()
      fn()
      const { user, system } = process.threadCpuUsage(start)
      mins[index] = Math.min(mins[index] ?? Infinity, (user + system) / 1000)
    }
  }
  return mins
}

/**
 * A fenced code block: the language of its info string, or `''`, and its text with a final line
 * break
 */
export type MarkdownBlock = { language: string; code: string }

/**
 * The Markdown section under the heading line `heading`, such as `### Next.js`, up to the next
 * heading of its level or higher outside code fences
 */
export function readMarkdownSection(text: string, heading: string): string | undefined {
  const lines = text.split('\n')
  const start = lines.indexOf(heading)
  if (start === -1) {
    return undefined
  }
  const level = heading.indexOf(' ')
  let isInFence = false
  let end = start + 1
  for (; end < lines.length; end++) {
    const line = lines[end] ?? ''
    if (line.startsWith('```')) {
      isInFence = !isInFence
    } else if (!isInFence && /^#+ /.test(line) && line.indexOf(' ') <= level) {
      break
    }
  }
  return lines.slice(start + 1, end).join('\n')
}

const CODE_BLOCK_REGEX = /^```(?<language>\S*)\n(?<code>[\s\S]*?)^```$/gm

export function readCodeBlocks(text: string): Array<MarkdownBlock> {
  return text
    .matchAll(CODE_BLOCK_REGEX)
    .map(({ groups }) => ({ language: groups?.['language'] ?? '', code: groups?.['code'] ?? '' }))
    .toArray()
}

/**
 * A first-line comment that is only a file name: `// name`, `# name` or `/* name *\/`
 */
const FILE_NAME_REGEX = /^(?:(?:\/\/|#) (?<name>\S+)|\/\* (?<cssName>\S+) \*\/)$/

/**
 * A first-line comment that names a file, maybe followed by words about it, as in
 * `// eslint.config.mjs in the monorepo's root`
 */
const DESCRIBED_FILE_NAME_REGEX =
  /^(?:(?:\/\/|#) (?<name>[\w./-]+)(?: .*)?|\/\* (?<cssName>[\w./-]+) \*\/)$/

export type FileNameComment = {
  fileName: string | undefined
  /**
   * The text without its file-name comment
   */
  code: string
}

/**
 * The file name of a code block's first-line comment, `// name`, `# name` or `/* name *\/`, and
 * the text after it. With `allowDescription`, a `//` or `#` comment may have words after the name
 */
export function splitFileNameComment(
  code: string,
  { allowDescription = false }: { allowDescription?: boolean | undefined } = {},
): FileNameComment {
  const [first = '', ...rest] = code.split('\n')
  const groups = (allowDescription ? DESCRIBED_FILE_NAME_REGEX : FILE_NAME_REGEX).exec(
    first,
  )?.groups
  const fileName = groups?.['name'] ?? groups?.['cssName']
  return { fileName, code: fileName === undefined ? code : rest.join('\n') }
}
