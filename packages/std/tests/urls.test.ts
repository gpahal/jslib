import {
  getLinkActiveState,
  getPathExtension,
  getSafeRedirectPath,
  getUrlExtension,
  isAbsoluteUrl,
} from '@/urls'

describe('isAbsoluteUrl', () => {
  it.each([
    'https://example.com/a',
    'mailto:x',
    'git+ssh://example.com/repo',
    // The URL parser drops tabs and newlines anywhere
    'java\tscript:alert(1)',
    // On an `http:` page, `https:evil.com` leads to evil.com
    'https:evil.com',
    String.raw` https:\evil.com`,
    // Protocol-relative, as the URL parser sees it, on any host, including the internal base's
    '//evil.com',
    String.raw`/\evil.com`,
    '/\t/evil.com',
    String.raw`\\X.INVALID`,
    '//x.invalid:443/',
    // C0 controls and spaces are ignored at the ends
    '\u{0}\u{1F} //evil.com \u{1}',
  ])('accepts %j', (url) => {
    expect(isAbsoluteUrl(url)).toBe(true)
  })

  it.each(['/a/b', 'a/b', '?a=b', '', '1a:b', '\u{1}/\u{1}/evil.com', '\u{A0}//evil.com'])(
    'rejects %j',
    (url) => {
      expect(isAbsoluteUrl(url)).toBe(false)
    },
  )
})

/**
 * Decodes each `%XX` to the character of its byte and keeps malformed escapes, like PHP's
 * `urldecode`. Only the ASCII characters matter to the url checks
 */
function decodeLeniently(path: string): string {
  return path.replaceAll(/%[\da-f]{2}/gi, (encoded) =>
    String.fromCodePoint(Number.parseInt(encoded.slice(1), 16)),
  )
}

describe('getSafeRedirectPath', () => {
  it.each([
    [' /x', '/x'],
    ['#x', '/#x'],
    ['?x', '/?x'],
    ['/docs/café', '/docs/caf%C3%A9'],
    // Encoded C1 controls pass, as its JSDoc states
    ['/\u{85}/evil', '/%C2%85/evil'],
    // Dot segments that would leave an empty segment
    ['/%2e//evil.com', '/'],
    ['/a/..//evil.com', '/'],
    [String.raw`/./\evil.com`, '/'],
  ])('gives %j for %j', (target, path) => {
    expect(getSafeRedirectPath(target)).toBe(path)
  })

  it.each([
    [['//evil.com']],
    [null],
    [' '],
    // An encoded separator or control in the pathname
    ['/%2F/evil.com'],
    ['/%5cevil.com'],
    ['/%09/evil.com'],
    ['/a?b=%00'],
    // A separator or control once decoded twice, or to a lenient decoder
    ['/%252F%252Fevil.com'],
    ['/a?b=%2509'],
    ['/%25%32%46%25%32%46evil.com'],
    ['/%2%46%2%46evil.com'],
    // An empty segment, after dot segments or path parameters
    ['/%252e%252e//evil.com'],
    ['/..;/..;//evil.com'],
    ['/a//b'],
    // An IIS-style unicode escape
    ['/%u002f/evil'],
  ])('returns the fallback for the unsafe target %j', (target) => {
    expect(getSafeRedirectPath(target, '/home')).toBe('/home')
  })

  it.each([
    '/a;b/c',
    '/a%3Bb/c',
    '/a?u=//x',
    '/a#//x',
    '/a%25u/b',
    '/login?next=%252Fhome',
    '/a?b=%2F#%5C',
  ])('keeps %j', (target) => {
    expect(getSafeRedirectPath(target, '/home')).toBe(target)
  })

  it.each(['home', '//home', '', ' /home', '/a/..//evil.com', '/%2F/evil.com'])(
    'throws for the fallback %j, which it would not return unchanged',
    (fallback) => {
      expect(() => getSafeRedirectPath('https://x', fallback)).toThrow(TypeError)
    },
  )

  it('throws for a fallback that is not a string', () => {
    // @ts-expect-error - JavaScript callers can pass a non-string fallback
    expect(() => getSafeRedirectPath('/a', 5)).toThrow(
      new TypeError(
        '@gpahal/std: `getSafeRedirectPath`: `fallback`: expected a safe path that it returns unchanged as a target, received `5`',
      ),
    )
  })

  it('returns paths that keep the origin and that it returns unchanged', () => {
    // Pieces of open-redirect payloads: separators, dot segments, encoded and doubly encoded
    // separators and hex digits, path parameters, schemes, controls, spaces and lookalikes of `/`
    // `|` separates them, so a piece can be a space
    const pieces = [
      String.raw`/|\|.|..|%2e|%2F|%5c|%25|%252F|%255c|%2509|%2|%32|%46|%30|%39|%3B|%253B|%3%42`,
      ';|:|@|?|#|a|evil.com|%09|%0a|%00|%7f|\t|\n| |\u{0}|\u{A0}|\u{FEFF}|\u{FF0F}|%u002f',
      '%%32%66|F|http:|https://|file:|%c0%af|é|[|\u{D800}',
    ]
      .join('|')
      .split('|')
    let seed = 2
    const random = () => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) & 0x7f_ff_ff_ff
      return seed / 0x80_00_00_00
    }
    const base = 'https://site.test'
    for (let i = 0; i < 2000; i++) {
      const length = 1 + Math.floor(random() * 8)
      let target = random() < 0.5 ? '/' : ''
      for (let j = 0; j < length; j++) {
        target += pieces[Math.floor(random() * pieces.length)]!
      }
      const path = getSafeRedirectPath(target)
      const message = JSON.stringify(target)
      expect(path.startsWith('/'), message).toBe(true)
      // So any result is also a valid `fallback`
      expect(getSafeRedirectPath(path, '/fallback'), message).toBe(path)
      // A server could split a header at a line break
      expect(path, message).not.toMatch(/[\p{Cc}\s]/u)
      // A server that reads `\` as `/` would read `/\evil.com` as protocol-relative
      expect(path, message).not.toMatch(/^[^#?]*\\/)
      // A server may decode the path once or twice and drop path parameters before redirecting
      const decoded = decodeLeniently(path)
      expect(new URL(decoded, base).pathname, message).not.toMatch(/^\/\//)
      for (const decodedPath of [path, decoded, decodeLeniently(decoded)]) {
        const url = new URL(decodedPath, base)
        expect(url.origin, message).toBe(base)
        const withoutParameters = url.pathname
          .split('/')
          .map((segment) => segment.split(';', 1)[0])
          .join('/')
        expect(new URL(withoutParameters, base).origin, message).toBe(base)
      }
    }
  })
})

describe('getUrlExtension', () => {
  it.each([
    ['a/b.tar.gz', 'gz'],
    ['a/.gitignore', ''],
    ['a/b', ''],
    ['https://x.com/a.png?v=1', 'png'],
    ['/a.webp#w=1.5', 'webp'],
    ['/a?file=b.png', ''],
    ['https://example.com', ''],
    ['foo://host/a.png', 'png'],
    ['mailto:john.doe@example.com', ''],
    ['https://exa mple.com/a.png', ''],
    // Percent-encoding decodes once, the same way for absolute and relative urls
    ['https://x.com/a.caf%C3%A9', 'café'],
    ['a.caf%c3%a9', 'café'],
    ['/a.%E0%A4%A', ''],
    ['/a%2520b.png', 'png'],
    ['/a.%2570ng', '%70ng'],
    // Whitespace and combining marks are only deceptive in the extension
    ['/my%20report.pdf', 'pdf'],
    ['/a.exe%20', ''],
    ['/a.ex%CC%81e', ''],
    // An encoded separator splits the name
    ['/a.b%2Fc.png', 'png'],
  ])('gives %j the extension %j', (url, extension) => {
    expect(getUrlExtension(url)).toBe(extension)
  })

  it('accepts a URL', () => {
    expect(getUrlExtension(new URL('https://x.com/a.jpg?v=2'))).toBe('jpg')
  })

  it.each([
    // A `?` or `#` in the name, which a stack that decodes and reparses splits at
    '/a.php%3F.png',
    '/a.php%2523.png',
    // A separator once decoded twice
    '/a.php%252F.png',
    '/a.php%255c.png',
    // A `:`, which starts an NTFS data stream
    '/a.php:.png',
    '/a.php%253A.png',
    '/a.php::$DATA',
    // A `;`, which some servers end the name at
    '/a.php;.png',
    '/a.php%253b.png',
    // A control or format character anywhere in the name, even after a malformed escape
    '/upload/shell.php%00.png',
    '/a%E2%80%AE.png',
    '/a.gnp%E2%80%AEexe',
    '/a.php%2500.png',
    '/a.php%25u202e.png',
    '/shell.php%00%ZZ.png',
    '/shell.php%E2%80%AE%5Ca.png',
  ])('returns no extension for %j, whose name could pass as another type', (url) => {
    expect(getUrlExtension(url)).toBe('')
  })
})

describe('getPathExtension', () => {
  it('returns the extension of the basename, with ? and # as part of the name', () => {
    expect(getPathExtension(String.raw`a\b\c.tar.gz`)).toBe('gz')
    expect(getPathExtension(String.raw`C:\a.b\c`)).toBe('')
    expect(getPathExtension('a/.gitignore')).toBe('')
    expect(getPathExtension('a/b.png?v=1')).toBe('png?v=1')
  })

  it('rejects a value that is not a string', () => {
    // @ts-expect-error - Not a string, as a JavaScript caller can pass
    expect(() => getPathExtension(5)).toThrow(
      new TypeError('@gpahal/std: `getPathExtension`: `path`: expected a string, received `5`'),
    )
  })
})

describe('getLinkActiveState', () => {
  const inactive = { isActive: false, isChildActive: false }
  const active = { isActive: true, isChildActive: false }
  const childActive = { isActive: false, isChildActive: true }
  const origin = 'https://x.com'

  it.each([
    // Slashes at the ends, the query and the hash don't count
    ['docs', { pathname: '/docs' }, active],
    ['/docs', { pathname: '/docs/' }, active],
    ['/docs', { pathname: '/docs/a' }, childActive],
    ['/docs', { pathname: '/docs-a' }, inactive],
    ['/', { pathname: '/docs' }, inactive],
    ['/docs?x=1', { pathname: '/docs/a#b' }, childActive],
    ['/docs', { pathname: '/docs/a?x#y' }, childActive],
    ['/docs/a', { pathname: '/docs?/a' }, inactive],
    // Percent-encoding normalizes, but encoded reserved characters stay significant
    ['/caf%C3%A9', { pathname: '/café' }, active],
    ['/%41', { pathname: '/A' }, active],
    ['/a%2Fb', { pathname: '/a/b' }, inactive],
    ['/a', { pathname: '/a%3Fb' }, inactive],
    // Relative targets resolve against the current url, as a link does
    ['b', { pathname: '/docs/a' }, inactive],
    ['b', { pathname: '/docs/a/' }, inactive],
    ['./', { pathname: '/docs/a' }, childActive],
    ['../b', { pathname: '/b/c' }, childActive],
    ['../../../b', { pathname: '/b' }, active],
    ['../a', { pathname: '/docs/a/b', origin }, childActive],
    ['?page=2', { pathname: '/docs' }, active],
    ['', { pathname: '/docs' }, active],
    ['#top', { pathname: '/' }, inactive],
    // A current pathname starting with // stays a pathname
    ['/docs', { pathname: '//docs' }, active],
    ['/docs', { pathname: '//evil.com/docs' }, inactive],
    // Not http or https
    ['mailto:x', { pathname: '/x' }, inactive],
    ['https://', { pathname: '/x' }, inactive],
    // Without an origin, or with `null` or the opaque `'null'`, only pathnames count
    ['https://other.com/docs', { pathname: '/docs' }, active],
    ['https://other.com/docs', { pathname: '/docs', origin: null }, active],
    ['https://other.com/docs', { pathname: '/docs', origin: 'null' }, active],
    // With an origin, absolute targets need the same one
    ['HTTPS://X.COM:443/docs', { pathname: '/docs', origin }, active],
    ['//x.com/docs', { pathname: '/docs/a', origin }, childActive],
    ['https://other.com/docs', { pathname: '/docs', origin }, inactive],
    // eslint-disable-next-line unicorn/prefer-https -- a different scheme is a different origin
    ['http://x.com/docs', { pathname: '/docs', origin }, inactive],
    // `x.invalid` is the internal base host
    [' //x.invalid/docs', { pathname: '/docs', origin: 'https://y.com' }, inactive],
    // With the scheme of the origin and no slashes, a target is relative; otherwise `docs` is the host
    // eslint-disable-next-line unicorn/prefer-https -- the scheme has to match the target's
    ['http:docs', { pathname: '/docs', origin: 'http://x.com' }, active],
    ['http:docs', { pathname: '/docs', origin }, inactive],
  ])('gives %j on %j %j', (target, current, state) => {
    expect(getLinkActiveState(target, current)).toEqual(state)
  })

  it('compares the origin of a URL object target', () => {
    const current = { pathname: '/docs', origin }
    expect(getLinkActiveState(new URL('https://x.com/docs'), current)).toEqual(active)
    expect(getLinkActiveState(new URL('https://other.com/docs'), current)).toEqual(inactive)
  })

  it.each([
    [
      { pathname: '/docs', origin: 'a.com' },
      'current.origin',
      'a url with an origin or `"null"`',
      '`"a.com"`',
    ],
    [
      { pathname: '/docs', origin: 'mailto:a@b.com' },
      'current.origin',
      'a url with an origin or `"null"`',
      '`"mailto:a@b.com"`',
    ],
    [null, 'current', 'an object', '`null`'],
    [{ pathname: 1 }, 'current.pathname', 'a string', '`1`'],
  ])('throws for the current page %j', (current, subject, expected, received) => {
    // @ts-expect-error - JavaScript callers can pass anything
    expect(() => getLinkActiveState('/docs', current)).toThrow(
      new TypeError(
        `@gpahal/std: \`getLinkActiveState\`: \`${subject}\`: expected ${expected}, received ${received}`,
      ),
    )
  })
})

describe('url arguments', () => {
  it('accepts a URL from another realm, reading its href once', () => {
    // Stands in for an iframe's or happy-dom's URL, which fails `instanceof URL`
    let reads = 0
    const url = {
      [Symbol.toStringTag]: 'URL',
      get href() {
        reads++
        return 'https://example.com/a.png'
      },
    }
    // @ts-expect-error - not this realm's URL
    expect(isAbsoluteUrl(url)).toBe(true)
    expect(reads).toBe(1)
    // @ts-expect-error - not this realm's URL
    expect(getUrlExtension(url)).toBe('png')
    // @ts-expect-error - not this realm's URL
    expect(getLinkActiveState(url, { pathname: '/a.png' })).toEqual({
      isActive: true,
      isChildActive: false,
    })
  })

  it.each([
    [1, '`1`'],
    [{ href: 'https://example.com/a.png' }, 'an object'],
    [{ [Symbol.toStringTag]: 'URL', href: 1 }, 'an object tagged `URL`'],
  ] as const)('throws for %j, which is not a string or a URL', (url, received) => {
    const description = `expected a string or a \`URL\`, received ${received}`
    // @ts-expect-error - JavaScript callers can pass anything
    expect(() => isAbsoluteUrl(url)).toThrow(
      new TypeError(`@gpahal/std: \`isAbsoluteUrl\`: \`url\`: ${description}`),
    )
    // @ts-expect-error - JavaScript callers can pass anything
    expect(() => getLinkActiveState(url, { pathname: '/a.png' })).toThrow(
      new TypeError(`@gpahal/std: \`getLinkActiveState\`: \`targetUrl\`: ${description}`),
    )
  })
})
