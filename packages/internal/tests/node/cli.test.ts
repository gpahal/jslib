import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'

import { formatCliError, getCauses, readPackageVersion } from '@/node/cli'
import { withTmpProject } from '@/node/testing'

describe('readPackageVersion', () => {
  it('reads the version of a package.json', async () => {
    await using project = await withTmpProject('internal-cli', {
      'package.json': '{ "version": "1.2.3" }',
    })
    expect(await readPackageVersion('@scope/x', pathToFileURL(`${project.dir}/package.json`))).toBe(
      '1.2.3',
    )
  })

  it('fails on a manifest that fails to read, keeping the cause, or a version that is not a string', async () => {
    await using project = await withTmpProject('internal-cli', {
      'bad.json': '{',
      'package.json': '{ "version": 1 }',
    })
    await expect(
      readPackageVersion('@scope/x', pathToFileURL(`${project.dir}/bad.json`)),
    ).rejects.toThrow(
      expect.objectContaining({
        message: '@scope/x: `package.json`: failed to read',
        cause: expect.any(SyntaxError) as unknown,
      }),
    )
    await expect(
      readPackageVersion('@scope/x', pathToFileURL(`${project.dir}/package.json`)),
    ).rejects.toThrow(
      new TypeError('@scope/x: `package.json`: `version`: expected a string, received `1`'),
    )
  })
})

describe('formatCliError', () => {
  const stream = new PassThrough()

  it('gives the message line by line, then each cause once, with controls escaped', () => {
    const inner = new TypeError('bad\npath\u{1B}[2J')
    const outer = new Error('a: b\n  - c\u{1B}[31m', { cause: new Error('d', { cause: inner }) })
    // A cycle back to the outer error stops the chain
    Object.defineProperty(inner, 'cause', { value: outer })
    expect(getCauses(outer)).toEqual([outer.cause, inner])
    expect(formatCliError(outer, { stream })).toBe(
      [
        'error: a: b',
        String.raw`  - c\u001b[31m`,
        '  Caused by: Error: d',
        '  Caused by: TypeError: bad',
        String.raw`    path\u001b[2J`,
        '',
      ].join('\n'),
    )
  })

  it('gives the name of an error without a message, and the messages of inner errors', () => {
    // eslint-disable-next-line unicorn/error-message -- The missing message is what's tested
    expect(formatCliError(new TypeError(), { stream })).toBe('error: TypeError\n')
    // eslint-disable-next-line unicorn/error-message -- The missing message is what's tested
    expect(formatCliError(new AggregateError([new Error('a')]), { stream })).toBe('error: a\n')
    expect(
      formatCliError(new AggregateError([new Error('a'), new Error('b')], 'all failed'), {
        stream,
      }),
    ).toBe('error: all failed: a; b\n')
  })

  it('leaves out the causes when asked, and takes a thrown value that is not an error', () => {
    expect(formatCliError(new Error('a', { cause: 'secret' }), { causes: false, stream })).toBe(
      'error: a\n',
    )
    expect(formatCliError(new Error('a', { cause: 'b' }), { stream })).toBe(
      'error: a\n  Caused by: b\n',
    )
  })
})
