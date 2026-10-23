import vm from 'node:vm'

import {
  assertNever,
  CustomError,
  describeValue,
  formatMessage,
  formatMessageList,
  formatNames,
  getErrorCode,
  getErrorMessage,
  getErrorReason,
  invariant,
  toError,
} from '@/errors'

import { minCpuMs } from './cpu-time'

describe('assertNever', () => {
  it('throws a TypeError that describes the value, or with the given message', () => {
    expect(() => assertNever({ kind: 'triangle' } as never)).toThrow(
      new TypeError('@gpahal/std: `assertNever`: expected no value, received an object'),
    )
    expect(() => assertNever('c' as never, 'unknown kind')).toThrow(new TypeError('unknown kind'))
  })
})

describe('invariant', () => {
  it('narrows a truthy condition and throws a TypeError with the message for a falsy one', () => {
    const value = 'a' as string | undefined
    invariant(value !== undefined, 'value is missing')
    expectTypeOf(value).toEqualTypeOf<string>()
    for (const condition of [0, '', null, NaN]) {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions -- A JavaScript caller can pass any value
        invariant(condition, 'failed')
      }).toThrow(new TypeError('failed'))
    }
  })

  it('calls a message function only when the condition is falsy', () => {
    const message = vi.fn(() => 'lazy')
    invariant(true, message)
    expect(message).not.toHaveBeenCalled()
    expect(() => {
      invariant(false, message)
    }).toThrow(new TypeError('lazy'))
  })

  it('rejects a message that is not a string or a function', () => {
    expect(() => {
      // @ts-expect-error - Not a string, as a JavaScript caller can pass
      invariant(true, 1)
    }).toThrow(
      new TypeError(
        '@gpahal/std: `invariant`: `message`: expected a string or a function, received `1`',
      ),
    )
  })
})

describe('CustomError', () => {
  it('takes the name of its subclass, without an own enumerable name', () => {
    class NotFoundError extends CustomError {}
    const cause = new Error('cause')
    const error = new NotFoundError('missing', { cause })
    expect(error).toBeInstanceOf(Error)
    expect(error.cause).toBe(cause)
    expect(String(error)).toBe('NotFoundError: missing')
    expect(Object.keys(error)).toEqual([])
  })

  it("keeps a name set on the subclass's prototype, which survives minification", () => {
    class A extends CustomError {}
    Object.defineProperty(A.prototype, 'name', { value: 'NotFoundError' })
    expect(String(new A('missing'))).toBe('NotFoundError: missing')
  })
})

/**
 * `levels` nested `AggregateError`s, each holding the level below twice
 */
function nestAggregates(levels: number): unknown {
  let error: unknown = new Error('a')
  for (let i = 0; i < levels; i++) {
    // eslint-disable-next-line unicorn/error-message -- The missing message makes it join its errors
    error = new AggregateError([error, error])
  }
  return error
}

/* eslint-disable unicorn/error-message -- The missing messages are what's tested */
function wrapAggregates(error: unknown, levels: number): unknown {
  let wrapped = error
  for (let i = 0; i < levels; i++) {
    wrapped = new AggregateError([wrapped])
  }
  return wrapped
}

describe('getErrorMessage', () => {
  it.each<[unknown, string]>([
    [new Error('a'), 'a'],
    [{ message: 42 }, '42'],
    ['a', 'a'],
    [null, 'null'],
    [new Error(), 'Unknown error'],
    [new TypeError(' \n'), 'TypeError'],
    [{ message: '', name: 'AbortError' }, 'AbortError'],
    [{ message: null, name: 'Named' }, 'Named'],
    [{ message: ['a'], name: 'HttpError' }, 'HttpError'],
    ['  ', 'Unknown error'],
    [{}, 'Unknown error'],
    [() => 'a', 'Unknown error'],
    [new DOMException('', 'AbortError'), 'AbortError'],
  ])('gives %o the message %j', (value, expected) => {
    expect(getErrorMessage(value)).toBe(expected)
  })

  it('reads an error from another realm', () => {
    expect(getErrorMessage(vm.runInNewContext('new RangeError()'))).toBe('RangeError')
  })

  it('falls back to the first non-blank message in the cause chain', () => {
    expect(
      getErrorMessage(new Error(' ', { cause: new Error('', { cause: new Error('deep') }) })),
    ).toBe('deep')
    expect(getErrorMessage({ message: {}, cause: 'disk full' })).toBe('disk full')
    expect(getErrorMessage(new Error('a', { cause: new Error('b') }))).toBe('a')
    expect(getErrorMessage(new TypeError('', { cause: new Error() }))).toBe('TypeError')
  })

  it('stops following causes at a cycle or after 10 levels', () => {
    const first: { message: string; cause?: unknown } = { message: '' }
    first.cause = { message: '', cause: first }
    expect(getErrorMessage(first)).toBe('Unknown error')
    let error = new Error('found')
    for (let index = 0; index < 10; index++) {
      error = new Error('', { cause: error })
    }
    expect(getErrorMessage(error)).toBe('found')
    expect(getErrorMessage(new Error('', { cause: error }))).toBe('Unknown error')
  })

  it('returns a fallback instead of throwing when a getter throws', () => {
    const throwing = Object.defineProperty(new Error('a'), 'message', {
      get() {
        throw new Error('getter')
      },
    })
    expect(getErrorMessage(throwing)).toBe('Unknown error')
    expect(getErrorMessage(new TypeError('', { cause: throwing }))).toBe('TypeError')
    const { proxy, revoke } = Proxy.revocable(new Error('a'), {})
    revoke()
    expect(getErrorMessage(proxy)).toBe('Unknown error')
  })

  it("joins the messages of an AggregateError's errors, after its own message when it has one", () => {
    expect(getErrorMessage(new AggregateError([new Error('a'), 'b', new TypeError()]))).toBe(
      'a; b; TypeError',
    )
    expect(
      getErrorMessage(
        Object.assign(new AggregateError([new Error('a')], 'own'), { message: null }),
      ),
    ).toBe('a')
    const cause = new AggregateError([new Error('conn refused')], 'all hosts failed')
    expect(getErrorMessage(new Error('', { cause }))).toBe('all hosts failed: conn refused')
  })

  it('leaves out the inner messages that its own message holds', () => {
    // As prettier-config's module resolution throws, with the second pass's message
    const resolution = new AggregateError(
      [new Error('esm fail'), new Error('cjs fail')],
      'cjs fail',
    )
    expect(getErrorMessage(resolution)).toBe('cjs fail: esm fail')
    expect(
      getErrorMessage(
        new AggregateError(
          [new Error('pkg: `a`: bad'), new Error('pkg: `b`: bad')],
          'pkg: options: 2 issues\n  `a`: bad\n  `b`: bad',
        ),
      ),
    ).toBe('pkg: options: 2 issues\n  `a`: bad\n  `b`: bad')
    expect(
      getErrorMessage(Object.assign(new Error('request failed'), { errors: [{ code: 1 }, {}] })),
    ).toBe('request failed')
  })

  it('appends the error and the suppressed error of a failed DisposableStack disposal', () => {
    const stack = new DisposableStack()
    stack.defer(() => {
      throw new Error('closing the file failed')
    })
    stack.defer(() => {
      throw new Error('flushing the file failed')
    })
    let error: unknown
    try {
      stack.dispose()
    } catch (error_) {
      error = error_
    }
    expect(getErrorMessage(error)).toBe(
      'An error was suppressed during disposal: closing the file failed; flushing the file failed',
    )
  })

  it('joins the messages of an AggregateError from another realm', () => {
    const error: unknown = vm.runInNewContext(
      'new AggregateError([new Error("a"), new Error("b")])',
    )
    expect(getErrorMessage(error)).toBe('a; b')
  })

  it('reads an error with a non-array errors property by its name', () => {
    expect(getErrorMessage(Object.assign(new TypeError(), { errors: 'a' }))).toBe('TypeError')
  })

  it("doesn't recurse forever into an AggregateError that contains itself", () => {
    expect(getErrorMessage(new AggregateError([]))).toBe('AggregateError')
    const cyclic = new AggregateError([new Error('a')])
    cyclic.errors.push(cyclic)
    expect(getErrorMessage(cyclic)).toBe('a; AggregateError')
    const error = new Error('')
    const aggregate = new AggregateError([error], '')
    Object.defineProperty(error, 'cause', { value: aggregate })
    expect(getErrorMessage(error)).toBe('Unknown error')
  })

  it('reads shared errors of nested AggregateErrors once and caps the message', () => {
    const capped = getErrorMessage(nestAggregates(20))
    expect(capped).toHaveLength(10_001)
    expect(capped).toMatch(/^a; a; .*…$/su)
    // Without memoising, 40 levels read 2^40 errors
    expect(getErrorMessage(nestAggregates(40))).toBe(capped)
  })

  it('stops reading after 10,000 inner errors when a back-reference blocks the cache', () => {
    // Each level holds the next one twice, and the last points back to the first, so every
    // message is read with a skipped cycle and isn't cached
    let errorsReads = 0
    const nodes = Array.from({ length: 25 }, () => new AggregateError([], 'z'))
    for (const [k, node] of nodes.entries()) {
      const next = nodes[k + 1]
      const errors = next === undefined ? [nodes[0]] : [next, next]
      Object.defineProperty(node, 'errors', {
        // eslint-disable-next-line no-loop-func -- Every getter counts into the one total
        get: () => {
          errorsReads++
          return errors
        },
      })
    }
    expect(getErrorMessage(nodes[0])).toMatch(/^z: z: .*…$/su)
    expect(errorsReads).toBeLessThanOrEqual(2 * 10_000 + 2)
  })

  it('reads AggregateErrors nested up to 100 levels and renders deeper ones as an ellipsis', () => {
    expect(getErrorMessage(wrapAggregates(new Error('leaf'), 100))).toBe('leaf')
    expect(getErrorMessage(wrapAggregates(new Error('leaf'), 101))).toBe('…')
    expect(
      getErrorMessage(
        new AggregateError([new Error('a'), wrapAggregates(new Error('leaf'), 5000)]),
      ),
    ).toBe('a; …')
    const shared = new AggregateError([new AggregateError([new Error('leaf')])])
    expect(getErrorMessage(new AggregateError([wrapAggregates(shared, 98), shared]))).toBe(
      '…; leaf',
    )
  })

  it('ends AggregateErrors with messages nested past 100 levels in an ellipsis', () => {
    let error: unknown = new Error('leaf')
    for (let i = 0; i < 101; i++) {
      error = new AggregateError([error], `m${String(100 - i)}`)
    }
    const message = getErrorMessage(error)
    expect(message).toMatch(/^m0: m1: m2: .* m99: m100: …$/su)
    expect(getErrorMessage(new AggregateError([], 'm'))).toBe('m')
  })

  it('caps the message without splitting a surrogate pair', () => {
    const message = `${'a'.repeat(9999)}😀b`
    expect(getErrorMessage(new AggregateError([new Error(message)]))).toBe(`${'a'.repeat(9999)}…`)
  })
})
/* eslint-enable unicorn/error-message */

describe('getErrorReason', () => {
  it.each([
    ['needs version 22.1.', 'needs version 22.1'],
    ['waiting...', 'waiting...'],
    ['.', '.'],
    ['pass a format, e.g.', 'pass a format, e.g.'],
    ['made in the U.S.', 'made in the U.S.'],
    [String.raw`C:\a`, String.raw`C:\a`],
    ['a\nb', String.raw`a\u000ab`],
  ])('gives the message %j the reason %j', (message, expected) => {
    expect(getErrorReason(new Error(message))).toBe(expected)
  })

  it('escapes control and bidi characters, leaving getErrorMessage raw', () => {
    let error: unknown
    try {
      JSON.parse('x\u{202E}\u{1B}[31mred')
    } catch (error_) {
      error = error_
    }
    expect(getErrorReason(error)).toContain(String.raw`\u202e\u001b[31mred`)
    expect(getErrorMessage(error)).toContain('\u{202E}\u{1B}')
    expect(getErrorReason({})).toBe('Unknown error')
  })
})

describe('toError', () => {
  it('returns an error as it is, from this realm or another', () => {
    const error = new TypeError('bad')
    expect(toError(error)).toBe(error)
    const foreign = vm.runInNewContext('new RangeError("far")') as unknown
    expect(toError(foreign)).toBe(foreign)
  })

  it.each<[unknown, string]>([
    ['failed', 'failed'],
    [undefined, 'undefined'],
    [{ [Symbol.toStringTag]: 'Error', message: 'spoofed' }, 'spoofed'],
    [{}, 'Unknown error'],
  ])('wraps %o in an Error with its message, keeping it as the cause', (value, message) => {
    const error = toError(value)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe(message)
    expect(error.cause).toBe(value)
  })

  it('never throws, even for a revoked proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(toError(proxy).message).toBe('Unknown error')
  })
})

describe('getErrorCode', () => {
  it('returns the string code of an error-like object, or undefined', () => {
    expect(getErrorCode({ code: 1 })).toBeUndefined()
    expect(getErrorCode('ENOENT')).toBeUndefined()
    expect(getErrorCode(null)).toBeUndefined()
    const throwing = Object.defineProperty({}, 'code', {
      get() {
        throw new Error('getter')
      },
    })
    expect(getErrorCode(throwing)).toBeUndefined()
  })
})

describe('describeValue', () => {
  it.each([
    {
      name: 'the control and format characters that JSON leaves, such as a bidi override',
      value: 'a\u{202E}b\u{85}\u{AD}',
      expected: String.raw`${'`'}"a\u202eb\u0085\u00ad"${'`'}`,
    },
    { name: 'quotes and newlines as JSON', value: 'it\'s "a"\n', expected: '`"it\'s \\"a\\"\\n"`' },
    { name: 'a backslash before a backtick once', value: 'a\\`', expected: '`"a\\\\\\`"`' },
    {
      name: 'a symbol description as JSON, so the message stays on one line',
      value: Symbol('a\nb'),
      expected: '`Symbol(a\\nb)`',
    },
    { name: 'a backtick in a symbol description', value: Symbol('`'), expected: '`Symbol(\\`)`' },
  ])('escapes $name', ({ value, expected }) => {
    expect(describeValue(value)).toBe(expected)
  })

  it.each<[unknown, string]>([
    ['a', '`"a"`'],
    [() => 1, 'a function'],
    [[1], 'an array'],
    [{}, 'an object'],
    [Object.create(null), 'an object'],
    [new Map(), 'an instance of `Map`'],
    [{ [Symbol.toStringTag]: 'Custom' }, 'an object tagged `Custom`'],
    [undefined, '`undefined`'],
    [null, '`null`'],
    [1n, '`1n`'],
    [-0, '`-0`'],
  ])('describes %o as %s', (value, expected) => {
    expect(describeValue(value)).toBe(expected)
  })

  it('falls back to an object for a proxy that throws on inspection', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(describeValue(proxy)).toBe('an object')
  })

  it('cuts a long class name short, and describes a class with a name that is not a string', () => {
    class LongName extends Map {}
    Object.defineProperty(LongName, 'name', { value: 'N'.repeat(100) })
    expect(describeValue(new LongName())).toBe(`an instance of \`${'N'.repeat(40)}…\``)
    class NumberName extends Map {}
    Object.defineProperty(NumberName, 'name', { value: 5 })
    expect(describeValue(new NumberName())).toBe('an object that is not plain')
  })

  it('truncates long values without splitting a surrogate pair', () => {
    expect(describeValue('x'.repeat(10_000))).toMatch(/^`"x{1,90}…"`$/)
    expect(describeValue(Symbol('y'.repeat(10_000)))).toMatch(/^`Symbol\(y+…\)`$/)
    expect(describeValue('😀'.repeat(10_000))).toMatch(/^`"😀+…"`$/u)
  })

  it('describes a bigint of more than 10,000 bits by its size, without writing its digits', () => {
    expect(describeValue(2n ** 10_000n - 1n)).toMatch(/^`1\d{39}…n`$/)
    expect(describeValue(-(2n ** 10_000n))).toBe('a negative 10001-bit bigint')
    const big = 2n ** 20_000_000n
    expect(describeValue(big)).toBe('a 20000001-bit bigint')
    // Against writing it in hexadecimal, which is linear. Writing its digits in decimal takes over
    // 100 times as long
    const [describeMs = 0, hexMs = 0] = minCpuMs([() => describeValue(big), () => big.toString(16)])
    expect(describeMs).toBeLessThan(4 * hexMs + 50)
  })
})

describe('formatNames', () => {
  it('lists names in backticks, joining the last two with a conjunction', () => {
    expect(formatNames(['a', 'b'])).toBe('`a`, `b`')
    expect(formatNames([])).toBe('')
    expect(formatNames(['a', 'b', 'c'], { conjunction: 'and' })).toBe('`a`, `b` and `c`')
    expect(formatNames(['a'], { conjunction: 'or' })).toBe('`a`')
  })

  it('escapes backslashes, then backticks, and control and format characters in names', () => {
    expect(formatNames(['a`b', 'c'], { conjunction: 'or' })).toBe('`a\\`b` or `c`')
    expect(formatNames(['a\\`b'])).toBe('`a\\\\\\`b`')
    expect(formatNames(['a\u{202E}b'])).toBe(String.raw`${'`'}a\u202eb${'`'}`)
  })

  it.each([
    { input: 'ab', subject: '`names`', expected: 'an array', described: '`"ab"`' },
    { input: ['a', 1], subject: '`names[1]`', expected: 'a string', described: '`1`' },
  ])('throws a TypeError for names $input', ({ input, subject, expected, described }) => {
    // @ts-expect-error - Not an array of strings, as a JavaScript caller can pass
    expect(() => formatNames(input)).toThrow(
      new TypeError(
        `@gpahal/std: \`formatNames\`: ${subject}: expected ${expected}, received ${described}`,
      ),
    )
  })

  it.each([
    [5, '`5`'],
    ['nor', '`"nor"`'],
  ])('throws a TypeError for the conjunction %o, even with one name', (conjunction, described) => {
    for (const names of [['a', 'b'], ['a']]) {
      // @ts-expect-error - Not a conjunction, as a JavaScript caller can pass
      expect(() => formatNames(names, { conjunction })).toThrow(
        new TypeError(
          `@gpahal/std: \`formatNames\`: \`options.conjunction\`: expected \`"and"\`, \`"or"\` or \`undefined\`, received ${described}`,
        ),
      )
    }
  })
})

describe('formatMessage', () => {
  it('leaves out the subjects when there are none', () => {
    expect(formatMessage('@scope/pkg', [], 'failed')).toBe('@scope/pkg: failed')
  })
})

describe('formatMessageList', () => {
  it('gives one problem as one line, with its subjects after the shared ones', () => {
    expect(
      formatMessageList('@scope/pkg', ['options'], [{ subjects: ['`a`'], description: 'bad' }]),
    ).toBe('@scope/pkg: options: `a`: bad')
  })

  it('counts several problems and lists each on an indented line, its continuation lines further', () => {
    expect(
      formatMessageList(
        '@scope/pkg',
        ['options'],
        [
          { subjects: ['`a`'], description: 'bad\nworse' },
          { subjects: [], description: 'one\r\ntwo\rthree' },
        ],
      ),
    ).toBe('@scope/pkg: options: 2 issues\n  `a`: bad\n    worse\n  one\r\n    two\r    three')
  })

  it.each([
    {
      name: 'prefix',
      args: [1, [], [{ subjects: [], description: 'a' }]],
      subject: '`prefix`',
      expected: 'a string',
      described: '`1`',
    },
    {
      name: 'item subject',
      args: ['p', [], [{ subjects: ['a', 2], description: 'b' }]],
      subject: '`items[0].subjects[1]`',
      expected: 'a string',
      described: '`2`',
    },
    {
      name: 'list',
      args: ['p', [], []],
      subject: '`items`',
      expected: 'at least one item',
      described: 'an empty array',
    },
  ])('throws a TypeError for a bad $name', ({ args, subject, expected, described }) => {
    // @ts-expect-error - The wrong types, as a JavaScript caller can pass
    expect(() => formatMessageList(...args)).toThrow(
      new TypeError(
        `@gpahal/std: \`formatMessageList\`: ${subject}: expected ${expected}, received ${described}`,
      ),
    )
  })
})
