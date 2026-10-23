import fs from 'node:fs/promises'
import path from 'node:path'

import {
  countCalls,
  countWork,
  minCpuMs,
  readCodeBlocks,
  readMarkdownSection,
  runNode,
  runNodeOk,
  splitFileNameComment,
  withTmpProject,
} from '@/node/testing'

describe('runNode', () => {
  it("runs Node in `cwd` without pnpm's `NODE_PATH` or `NODE_OPTIONS`, even when `env` sets them", async () => {
    await using project = await withTmpProject('internal-testing')
    const script =
      'console.log(JSON.stringify([process.env.NODE_PATH, process.env.NODE_OPTIONS ?? null, process.env.EXTRA, process.cwd()]))'
    const output = await runNodeOk(['--eval', script], {
      cwd: project.dir,
      env: { EXTRA: 'x', NODE_PATH: '/store', NODE_OPTIONS: '--max-old-space-size=4096' },
    })
    expect(JSON.parse(output)).toEqual(['', null, 'x', project.dir])
  })

  it('reports a failing exit with its output, and rejects it with `runNodeOk`', async () => {
    const args = ['--eval', 'console.error("bad"); process.exit(3)']
    expect(await runNode(args)).toEqual({ status: 3, signal: null, stdout: '', stderr: 'bad\n' })
    await expect(runNodeOk(args)).rejects.toThrow(
      new Error('@gpahal/internal: `runNodeOk`: node exited with 3\nbad\n'),
    )
    await expect(
      runNodeOk(['--eval', 'setTimeout(() => {}, 60_000)'], { timeout: 100 }),
    ).rejects.toThrow('node was killed with SIGKILL')
  })
})

test('reads a README section up to the next heading of its level, and its code blocks', () => {
  const readme = [
    '## A',
    '',
    '```ts',
    '// a.ts in the root',
    'export {}',
    '```',
    '',
    '```sh',
    '# not a heading',
    '```',
    '',
    '### A.1',
    '',
    '```css',
    '/* a.css */',
    'a {}',
    '```',
    '',
    '## B',
  ].join('\n')
  const section = readMarkdownSection(readme, '## A')!
  expect(section).toContain('### A.1')
  expect(section).not.toContain('## B')
  expect(readMarkdownSection(readme, '## C')).toBeUndefined()
  const [ts, sh, css] = readCodeBlocks(section)
  expect([ts?.language, sh?.language, css?.language]).toEqual(['ts', 'sh', 'css'])
  expect(splitFileNameComment(ts!.code).fileName).toBeUndefined()
  expect(splitFileNameComment(ts!.code, { allowDescription: true })).toEqual({
    fileName: 'a.ts',
    code: 'export {}\n',
  })
  expect(splitFileNameComment(css!.code)).toEqual({ fileName: 'a.css', code: 'a {}\n' })
})

test('`withTmpProject` writes the files in a real folder, and removes it when disposed', async () => {
  let dir: string
  {
    await using project = await withTmpProject('internal-testing', { 'a/b.txt': 'b' })
    dir = project.dir
    expect(await fs.realpath(dir)).toBe(dir)
    expect(await fs.readFile(path.join(dir, 'a/b.txt'), 'utf8')).toBe('b')
  }
  await expect(fs.access(dir)).rejects.toThrow(/ENOENT/)
})

/**
 * The method of `owner` at `key`, to check that it's restored
 */
function methodOf(owner: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(owner, key)?.value
}

describe('countCalls', () => {
  it("counts the calls to each target while `fn` runs, adding each call's weight", () => {
    let results: Array<unknown> = []
    const counts = countCalls(
      () => {
        results = ['a-b-c'.split('-'), [3, 1, 2].indexOf(2), [1, 2, 3].some((item) => item > 2)]
      },
      {
        split: [String.prototype, 'split'],
        some: [
          Array.prototype,
          'some',
          ({ thisArg }) => (Array.isArray(thisArg) ? thisArg.length : 0),
        ],
      },
    )
    expect(counts).toEqual({ split: 1, some: 3 })
    expect(results).toEqual([['a', 'b', 'c'], 2, true])
  })

  it('counts until the promise that `fn` returns settles, and restores the methods when it fails', async () => {
    const indexOf = methodOf(Array.prototype, 'indexOf')
    const counts = await countCalls(
      async () => {
        await Promise.resolve()
        return [1].indexOf(1)
      },
      { indexOf: [Array.prototype, 'indexOf'] },
    )
    expect(counts).toEqual({ indexOf: 1 })
    await expect(
      countCalls(
        async () => {
          await Promise.resolve()
          throw new Error('fail')
        },
        { indexOf: [Array.prototype, 'indexOf'] },
      ),
    ).rejects.toThrow('fail')
    expect(methodOf(Array.prototype, 'indexOf')).toBe(indexOf)
  })

  it("rejects a target that isn't an own method, before wrapping any", () => {
    const slice = methodOf(String.prototype, 'slice')
    expect(() =>
      countCalls(() => undefined, {
        slice: [String.prototype, 'slice'],
        inherited: [[], 'indexOf'],
      }),
    ).toThrow(
      '@gpahal/internal: `countCalls`: `targets.inherited`: expected an own method, received `undefined`',
    )
    expect(methodOf(String.prototype, 'slice')).toBe(slice)
  })
})

test('`countWork` weighs array scans by length, string searches by code units read, and copies by items copied', () => {
  const items = Array.from({ length: 100 }, (_, index) => index)
  let results: Array<unknown> = []
  const work = countWork(() => {
    results = [
      // Matches at once, yet weighs 100
      items.indexOf(0),
      items.slice(10, 20).length,
      'abcabc'.indexOf('c', 1),
    ]
    for (const _ of [1, 2]) {
      // The 2 items and the call that ends the loop
    }
  })
  expect(results).toEqual([0, 10, 2])
  expect(work).toBe(100 + 10 + 2 + 3)
})

test('`minCpuMs` runs the functions in turn, and leaves out time the thread spends waiting', () => {
  const order: Array<string> = []
  const wait = new Int32Array(new SharedArrayBuffer(4))
  const times = minCpuMs(
    [
      () => {
        order.push('busy')
      },
      () => {
        order.push('idle')
        // Waits at least 40ms of wall-clock time, and spends next to no CPU time
        Atomics.wait(wait, 0, 0, 40)
      },
    ],
    2,
  )
  expect(order).toEqual(['busy', 'idle', 'busy', 'idle'])
  expect(Math.max(...times)).toBeLessThan(20)
})
