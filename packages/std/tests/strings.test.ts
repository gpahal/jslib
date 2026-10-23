import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

import { describeValue } from '@/errors'
import {
  camelCase,
  ensurePrefix,
  ensureSuffix,
  escapeControls,
  kebabCase,
  shorten,
  stripPrefix,
  stripSuffix,
  toString,
  trim,
  trimBlankLines,
  trimEnd,
  trimStart,
  words,
} from '@/strings'

import { minCpuMs } from './cpu-time'

/**
 * A seeded linear congruential generator, so a failure reproduces
 */
function createRandom(seed: number): (n: number) => number {
  return (n) => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) & 0x7f_ff_ff_ff
    // The high bits pick the index, since an LCG's low bits cycle quickly
    return Math.floor((seed / 0x80_00_00_00) * n)
  }
}

describe('toString', () => {
  it('converts primitives, keeping the sign of -0', () => {
    expect(toString(null)).toBe('')
    expect(toString(undefined)).toBe('')
    expect(toString(-0)).toBe('-0')
    expect(toString(10n)).toBe('10')
    expect(toString(Symbol('s'))).toBe('Symbol(s)')
  })

  it('converts objects like String(), falling back where String() would throw', () => {
    expect(toString({ toString: () => 'custom' })).toBe('custom')
    expect(toString(Object.create(null))).toBe('[object Object]')
    expect(toString({ toString: () => ({}), valueOf: () => 1 })).toBe('1')
  })

  it("joins arrays like String(), without an Array subclass's toString", () => {
    expect(toString([null, 1])).toBe(',1')
    expect(toString([1, [2, [3]]])).toBe('1,2,3')
    expect(toString([0n, -0])).toBe('0,-0')
    class Custom extends Array<unknown> {
      override toString(): string {
        return 'custom'
      }
    }
    expect(toString(Custom.from(['a', 1]))).toBe('a,1')
  })

  it('renders cycles as an empty string, like Array#join', () => {
    const cyclic: Array<unknown> = [1]
    cyclic.push(cyclic, 2)
    expect(toString(cyclic)).toBe('1,,2')
    const shared = [1]
    expect(toString([shared, shared])).toBe('1,1')
  })

  it('throws a RangeError like String() for a string longer than V8 makes', () => {
    const sparse: Array<unknown> = []
    sparse[2 ** 30 - 1] = undefined
    expect(() => toString(sparse)).toThrow(RangeError)
  })
})

describe('prefixes and suffixes', () => {
  it.each([
    [stripPrefix, '//foo', '/foo'],
    [stripPrefix, 'foo', 'foo'],
    [stripSuffix, 'foo//', 'foo/'],
    [ensurePrefix, 'foo', '/foo'],
    [ensurePrefix, '/foo', '/foo'],
    [ensureSuffix, 'foo', 'foo/'],
    [ensureSuffix, 'foo/', 'foo/'],
  ])('%o(%j, "/") is %j', (fn, input, expected) => {
    expect(fn(input, '/')).toBe(expected)
  })
})

describe('trim', () => {
  it('trims whitespace without chars, and nothing with empty chars', () => {
    expect(trim('  a  ')).toBe('a')
    expect(trim('  a  ', '')).toBe('  a  ')
  })

  it('treats chars as literal code points', () => {
    expect(trim(']]a]]', ']')).toBe('a')
    expect(trim('a-z', 'a-')).toBe('z')
    expect(trimStart('//a//', '/')).toBe('a//')
    expect(trimEnd('//a//', '/')).toBe('//a')
    expect(trim('😀😀a😀', '😀')).toBe('a')
    // A lone surrogate is its own code point, not half of the emoji's
    expect(trimEnd('a😀', '\u{D83D}')).toBe('a😀')
    expect(trimEnd('a\u{DC00}', '\u{DC00}')).toBe('a')
  })

  it('rejects a value that is not a string, and chars that are not a string or undefined', () => {
    // @ts-expect-error - Not a string, as a JavaScript caller can pass
    expect(() => trim(5)).toThrow(
      new TypeError('@gpahal/std: `trim`: `s`: expected a string, received `5`'),
    )
    // @ts-expect-error - Not a string, as a JavaScript caller can pass
    expect(() => trimEnd('a', ['/'])).toThrow(
      new TypeError(
        '@gpahal/std: `trimEnd`: `chars`: expected a string or `undefined`, received an array',
      ),
    )
  })

  it('looks at each code point once on long runs of chars that are not at the end', () => {
    // A `[chars]+$` regex would retry the run from each of its positions
    const run = `${'/'.repeat(100_000)}x`
    const has = vi.spyOn(Set.prototype, 'has')
    try {
      expect([trimEnd(run, '/'), trim(run, '/')]).toEqual([run, 'x'])
      expect(has.mock.calls.length).toBeLessThanOrEqual(run.length + 2)
    } finally {
      has.mockRestore()
    }
  })
})

describe('words', () => {
  it('rejects a value that is not a string, and a pattern that is not a string or a RegExp', () => {
    // @ts-expect-error - Not a string, as a JavaScript caller can pass
    expect(() => words(5)).toThrow(
      new TypeError('@gpahal/std: `words`: `s`: expected a string, received `5`'),
    )
    // @ts-expect-error - Not a pattern, as a JavaScript caller can pass
    expect(() => words('a b', null)).toThrow(
      new TypeError(
        '@gpahal/std: `words`: `pattern`: expected a string, a `RegExp` or `undefined`, received `null`',
      ),
    )
  })

  it('rejects an object that only claims to be a RegExp, and accepts one from another realm', () => {
    const fake = { [Symbol.toStringTag]: 'RegExp', source: 'a', flags: '', global: false }
    for (const pattern of [fake, new Proxy(/a/, {}), RegExp.prototype]) {
      expect(() => words('a b', pattern as RegExp)).toThrow(
        new TypeError(
          `@gpahal/std: \`words\`: \`pattern\`: expected a string, a \`RegExp\` or \`undefined\`, received ${describeValue(pattern)}`,
        ),
      )
    }
    expect(words('a b', vm.runInNewContext('/[a-z]/') as RegExp)).toEqual(['a', 'b'])
  })

  it('rejects a string pattern that is not a valid regular expression, keeping the cause', () => {
    let thrown: unknown
    try {
      words('x', '(')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SyntaxError)
    expect((thrown as SyntaxError).message).toBe(
      '@gpahal/std: `words`: `pattern`: expected a valid regular expression, received `"("`',
    )
    expect((thrown as SyntaxError).cause).toBeInstanceOf(SyntaxError)
  })

  it.each([
    ['fooBar', ['foo', 'Bar']],
    ['XMLHttpRequest', ['XML', 'Http', 'Request']],
    ['foo_bar-baz qux', ['foo', 'bar', 'baz', 'qux']],
    ['HTML5Parser', ['HTML', '5', 'Parser']],
    ['iOS', ['i', 'OS']],
    ['helloМир αβγΔέλτα', ['hello', 'Мир', 'αβγ', 'Δέλτα']],
    ['हिन्दी भाषा', ['हिन्दी', 'भाषा']],
    ['ラーメン', ['ラーメン']],
    // Ordinals stay whole, like lodash, unless a letter of the suffix's case follows
    ['1st place', ['1st', 'place']],
    ['3RD place', ['3RD', 'place']],
    ['1stplace', ['1', 'stplace']],
  ])('splits %j like lodash', (input, expected) => {
    expect(words(input)).toEqual(expected)
  })

  it('keeps combining marks with their letter', () => {
    expect(words('ÉcoleNormale'.normalize('NFD'))).toEqual(
      ['École', 'Normale'].map((w) => w.normalize('NFD')),
    )
  })

  it('keeps an emoji with a variation selector, modifier, joiner or tags as one word', () => {
    const england = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'
    const family = '👨\u{200D}👩\u{200D}👧'
    expect(words(`a😀b❤️c👍🏽d${family}e${england}f🇺🇸`)).toEqual([
      'a',
      '😀',
      'b',
      '❤️',
      'c',
      '👍🏽',
      'd',
      family,
      'e',
      england,
      'f',
      '🇺🇸',
    ])
  })

  it.each([
    ['an uppercase run', (n: number) => 'A'.repeat(n)],
    ['a long ordinal', (n: number) => `${'1'.repeat(n)}st`],
    ['decomposed uppercase letters', (n: number) => `${'A\u{301}'.repeat(n / 2)}a`],
    ['case and digit changes', (n: number) => 'aA1'.repeat(n / 2)],
    ['emoji', (n: number) => '😀'.repeat(n)],
  ])('splits %s in linear time', (_, makeInput) => {
    const short = makeInput(12_500)
    const long = makeInput(50_000)
    // CPU time, since a regex backtracks inside one call. 4 times the input takes 16 times as long
    // in quadratic code, and the slack covers the timer's resolution
    const [shortMs = 0, longMs = 0] = minCpuMs([() => words(short), () => words(long)])
    expect(longMs).toBeLessThan(8 * shortMs + 50)
  })

  it('returns every non-empty match of a custom pattern, even a sticky one', () => {
    expect(words('foo bar', String.raw`\w+`)).toEqual(['foo', 'bar'])
    expect(words('xfoo', /o/y)).toEqual(['o', 'o'])
    expect(words('abc', '')).toEqual([])
    expect(words('a b', /\w*/)).toEqual(['a', 'b'])
  })
})

describe('built files', () => {
  it('have no regex literal with the v flag, so loading them needs no v-flag support', () => {
    const buildDir = path.join(import.meta.dirname, '..', 'build')
    const files = fs
      .readdirSync(buildDir, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.js'))
    expect(files).toContain('strings.js')
    // The closing `/` of a regex literal follows its pattern, never a space, a comment's `*` or
    // another `/`
    const vFlagLiteral = /[^\s*/]\/[dgimsuy]*v[dgimsuy]*(?![\w$])/
    for (const file of files) {
      expect(fs.readFileSync(path.join(buildDir, file), 'utf8'), file).not.toMatch(vFlagLiteral)
    }
  })
})

describe('camelCase and kebabCase', () => {
  it.each([
    ['Segoe UI', 'segoeUi', 'segoe-ui'],
    ['--foo-bar--', 'fooBar', 'foo-bar'],
    ["don't stop", 'dontStop', 'dont-stop'],
    ['don\u{2018}t stop', 'dontStop', 'dont-stop'],
    ['camelCase123ABC', 'camelCase123Abc', 'camel-case-123-abc'],
    // The first code point, not code unit, of an astral word is uppercased
    ['foo 𐐨𐐨', 'foo𐐀𐐨', 'foo-𐐨𐐨'],
  ])('converts %j', (input, camel, kebab) => {
    expect(camelCase(input)).toBe(camel)
    expect(kebabCase(input)).toBe(kebab)
  })

  it('keeps a decomposed accent on its letter', () => {
    expect(kebabCase('E\u{301}COLE')).toBe('e\u{301}cole')
  })
})

describe('shorten', () => {
  it('keeps strings that fit, and replaces the middle of longer ones with …', () => {
    expect(shorten('abcdefghij')).toBe('abcdefghij')
    expect(shorten('abcdefghijk')).toBe('abcde…hijk')
    expect(shorten('abcdefghij', 7)).toBe('abc…hij')
  })

  it.each([
    ['a negative maxLen', () => shorten('abc', -1), RangeError],
    ['a fractional maxLen', () => shorten('abc', 1.5), RangeError],
    [
      'a maxLen that is not a number',
      // @ts-expect-error - JavaScript callers can pass anything
      () => shorten('abc', '2'),
      new TypeError(
        '@gpahal/std: `shorten`: `maxLen`: expected a number or `undefined`, received `"2"`',
      ),
    ],
    [
      'options that are not an object',
      // @ts-expect-error - JavaScript callers can pass anything
      () => shorten('abcdefghijk', 10, null),
      new TypeError('@gpahal/std: `shorten`: `options`: expected an object, received `null`'),
    ],
    [
      'an ellipsis that is not a string, even when nothing is shortened',
      // @ts-expect-error - JavaScript callers can pass anything
      () => shorten('abc', 8, { ellipsis: 1 }),
      new TypeError(
        '@gpahal/std: `shorten`: `options.ellipsis`: expected a string or `undefined`, received `1`',
      ),
    ],
  ])('rejects %s', (_, call, error) => {
    expect(call).toThrow(error)
  })

  it('cuts a grapheme cluster longer than 32 code units, so a Zalgo stack stays bounded', () => {
    expect(shorten(`a${'\u{301}'.repeat(9999)}`, 10)).toBe(`a${'\u{301}'.repeat(31)}`)
    expect(shorten(`a${'\u{301}'.repeat(39)}b`, 10)).toBe(`a${'\u{301}'.repeat(31)}b`)
    const family = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}'
    const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'
    expect(shorten(`${family}${england}`, 2)).toBe(`${family}${england}`)
  })

  it('only segments the ends of a long string', () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      expect(shorten(`${'x'.repeat(1_000_000)}😀`, 10)).toBe('xxxxx…xxx😀')
      const codeUnits = segment.mock.calls.reduce((sum, [input]) => sum + input.length, 0)
      expect(codeUnits).toBeLessThanOrEqual(2 * 10 * 64 + 2)
    } finally {
      segment.mockRestore()
    }
    expect(shorten(`a${'\u{301}'.repeat(2_000_000)}`, 10)).toBe(
      `a${'\u{301}'.repeat(31)}…${'\u{301}'.repeat(32)}`,
    )
  })

  it("doesn't split a surrogate pair or a regional indicator pair at the edge of a window", () => {
    expect(shorten(`${'😀'.repeat(10_000)}x`, 4)).toBe('😀😀…x')
    expect(shorten(`x${'🇺🇸'.repeat(500)}`, 6)).toBe('x🇺🇸🇺🇸…🇺🇸🇺🇸')
    expect(shorten(`🇺${'🇺🇸'.repeat(500)}`, 6)).toBe('🇺🇺🇸🇺🇸🇺…🇸🇺🇸')
  })

  it('matches the head and tail of full segmentation on random strings', () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const graphemes = (s: string) => Array.from(segmenter.segment(s), ({ segment }) => segment)
    // Code points that join or split clusters in different ways, lone surrogates and a `.`,
    // which can merge with the ellipsis
    const alphabet =
      'a|\u{301}|\u{200D}|👍|\u{1F3FD}|\u{1F1FA}|\u{1F1F8}|\u{1100}|\u{1161}|\r|\n|\u{600}|क|्|\u{D800}|\u{DC00}|\u{FE0F}|.'.split(
        '|',
      )
    const random = createRandom(12_345)
    for (let i = 0; i < 1000; i++) {
      let s = ''
      for (let length = random(30); length > 0; length--) {
        s += alphabet[random(alphabet.length)]!
      }
      const maxLen = random(12)
      const ellipsis = ['..', '…', ''][random(3)]!
      const all = graphemes(s)
      const kept = maxLen - graphemes(ellipsis).length
      const head = Math.ceil(kept / 2)
      const expected =
        all.length <= maxLen
          ? s
          : kept < 2
            ? all.slice(0, maxLen).join('')
            : `${all.slice(0, head).join('')}${ellipsis}${all.slice(all.length - (kept - head)).join('')}`
      expect(shorten(s, maxLen, { ellipsis }), JSON.stringify([s, maxLen, ellipsis])).toBe(expected)
    }
  })
})

describe('trimBlankLines', () => {
  it('gives no lines when every line is blank', () => {
    expect(trimBlankLines(['', '  '])).toEqual([])
  })
})

describe('escapeControls', () => {
  it.each([
    [
      'control and format characters',
      'a\u{1B}b\u{202E}c\u{85}d\u{AD}e',
      String.raw`a\u001bb\u202ec\u0085d\u00ade`,
    ],
    [
      'line and paragraph separators and lone surrogates',
      'x\u{2028}y\u{2029}\u{D800}z\u{DC00}😀',
      `${String.raw`x\u2028y\u2029\ud800z\udc00`}😀`,
    ],
    // They can hide data
    [
      'variation selectors and the combining grapheme joiner',
      'a\u{FE00}b\u{FE0F}c\u{E0100}d\u{34F}e',
      String.raw`a\ufe00b\ufe0fc\u{e0100}d\u034fe`,
    ],
    // They render as nothing or as blanks
    [
      'default-ignorable code points and blanks',
      'a\u{17B4}b\u{E0001}c\u{1BCA0}d\u{3164}e\u{2800}f',
      String.raw`a\u17b4b\u{e0001}c\u{1bca0}d\u3164e\u2800f`,
    ],
  ])('escapes %s', (_, input, escaped) => {
    expect(escapeControls(input)).toBe(escaped)
  })

  it.each(['café 🙂', '👨\u{200D}👩\u{200D}👧', 'می\u{200C}خواهم', '한글 \u{2801}'])(
    'leaves %j as it is',
    (input) => {
      expect(escapeControls(input)).toBe(input)
    },
  )

  it('rejects a value that is not a string', () => {
    // @ts-expect-error - Not a string, as a JavaScript caller can pass
    expect(() => escapeControls(5)).toThrow(
      new TypeError('@gpahal/std: `escapeControls`: `text`: expected a string, received `5`'),
    )
  })

  it('escapes backslashes by default', () => {
    expect(escapeControls(String.raw`\u001b`)).toBe(String.raw`\\u001b`)
  })

  it('escapes so that any BMP string, lone surrogates included, reads back exactly', () => {
    const atoms = 'a|\\|"|\u{1B}|\u{2028}|\u{FEFF}|\u{202E}|\u{D800}|\u{DC00}'.split('|')
    const random = createRandom(11)
    for (let i = 0; i < 1000; i++) {
      let s = ''
      for (let length = random(10); length > 0; length--) {
        s += atoms[random(atoms.length)]!
      }
      const escaped = escapeControls(s)
      // Only BMP code points are escaped here, as `\uXXXX`, which JSON reads too
      expect(JSON.parse(`"${escaped.replaceAll('"', String.raw`\"`)}"`), JSON.stringify(s)).toBe(s)
      expect(escaped).not.toMatch(/[\p{Cc}\u{2028}\u{2029}\u{202E}\u{FEFF}]/u)
    }
  })
})
