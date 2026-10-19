import { execFileSync } from 'node:child_process'
import type { LookupAddress, LookupAllOptions } from 'node:dns'
import dns from 'node:dns/promises'
import { copyFile, mkdir, open, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { withTmpProject } from '@gpahal/internal/node/testing'
import { describeValue } from '@gpahal/std/errors'

import { getFontFallbacks } from '@/index'

import { FIGTREE_PATH, FIXTURES_DIR } from './fixtures'
import { getRejection, PREFIX } from './helpers'

const MAX_BYTES = 20 * 1024 * 1024
const FAMILY_RULE =
  'a family name of letters, digits, single spaces and hyphens, up to 64 characters'
const FILE_OPTIONS = { name: 'Figtree' }

type LookupAll = (hostname: string, options: LookupAllOptions) => Promise<Array<LookupAddress>>

/**
 * example.com's address, which the tests' hosts, which don't exist, resolve to unless a test sets
 * another
 */
const PUBLIC_ADDRESSES: Array<LookupAddress> = [{ address: '93.184.215.14', family: 4 }]
const lookup = vi.spyOn(dns as { lookup: LookupAll }, 'lookup')
beforeEach(() => {
  lookup.mockResolvedValue(PUBLIC_ADDRESSES)
})
afterEach(() => {
  lookup.mockReset()
  vi.unstubAllGlobals()
})

async function expectTypeError(promise: Promise<unknown>, message: string): Promise<Error> {
  const error = await getRejection(promise)
  expect(error).toBeInstanceOf(TypeError)
  expect(error.message).toBe(`${PREFIX}: ${message}`)
  return error
}

describe('family names', () => {
  it('matches a family name exactly, and suggests the name in another case', async () => {
    expect((await getFontFallbacks('Figtree')).fontFamily).toMatch(/^Figtree, /)
    await expectTypeError(
      getFontFallbacks('figtree'),
      'family `figtree`: @capsizecss/metrics has no such family. Did you mean `Figtree`?',
    )
    await expectTypeError(
      getFontFallbacks('Not A Real Font'),
      'family `Not A Real Font`: @capsizecss/metrics has no such family',
    )
  })

  it.each(['', 'Open  Sans', 'A'.repeat(65)])('rejects the family name %j', async (name) => {
    await expectTypeError(
      getFontFallbacks(name),
      `font: expected ${FAMILY_RULE}, or an https:// URL, received ${describeValue(name)}`,
    )
  })

  it.each([
    [
      './inter.woff2',
      `received \`"./inter.woff2"\`. Pass a \`file:\` URL, such as \`pathToFileURL(path)\``,
    ],
    // A string with a colon isn't echoed, as it may be a URL with credentials
    [
      String.raw`C:\fonts\f.ttf`,
      'received a string with a `:`, such as a URL of another scheme or a face suffix. Pass a `file:` URL, such as `pathToFileURL(path)`',
    ],
    [
      'http://u:hunter2@fonts.example/f.ttf',
      'received a string with a `:`, such as a URL of another scheme or a face suffix',
    ],
  ])('rejects %j with a hint for paths', async (name, received) => {
    await expectTypeError(
      getFontFallbacks(name),
      `font: expected ${FAMILY_RULE}, or an https:// URL, ${received}`,
    )
  })

  it('rejects the system UI font as the web font, but takes it as a fallback', async () => {
    await expectTypeError(
      getFontFallbacks('-apple-system', { fallbacks: ['Arial'] }),
      "family `-apple-system`: names the system UI font, which isn't a web font. Pass your web font's family name or font file",
    )
    expect((await getFontFallbacks('Inter', { fallbacks: ['-apple-system'] })).fontFamily).toBe(
      "Inter, 'Inter fallback -apple-system'",
    )
  })
})

describe('sources', () => {
  it('takes a file: URL and bytes, read as they were when called', async () => {
    const font = await readFile(FIGTREE_PATH)
    const { css } = await getFontFallbacks(pathToFileURL(FIGTREE_PATH), FILE_OPTIONS)
    expect((await getFontFallbacks(new Uint8Array(font), FILE_OPTIONS)).css).toBe(css)
    const changing = getFontFallbacks(font, FILE_OPTIONS)
    font.fill(0)
    expect((await changing).css).toBe(css)
  })

  it.each([
    [
      new URL('http://fonts.example/f.ttf'),
      'font URL: expected file: or https:, received `"http:"`',
    ],
    ['https://', "font URL: doesn't parse"],
    [42, 'font: expected a family name, an https: URL, a `URL` or a `Uint8Array`, received `42`'],
  ])('rejects the source %s', async (source, message) => {
    // @ts-expect-error - some sources are invalid for JavaScript callers too
    await expectTypeError(getFontFallbacks(source), message)
  })

  it('rejects bytes over 20 MiB', async () => {
    await expectTypeError(
      getFontFallbacks(new Uint8Array(MAX_BYTES + 1), FILE_OPTIONS),
      `font bytes: it's over the limit of ${MAX_BYTES} bytes`,
    )
  })

  it.each([
    ['bytes', new Uint8Array(4), 'font bytes'],
    ['an https: URL', 'https://fonts.example/f.ttf', 'font https://fonts.example/f.ttf'],
  ])('needs the name option for %s, before loading it', async (_, source, subject) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expectTypeError(
      getFontFallbacks(source),
      `${subject}: a font file needs the \`name\` option: the \`font-family\` name of your \`@font-face\``,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('file: URLs', () => {
  it('reads a path whose extension is in any case, and a URL whose host is localhost', async () => {
    await using project = await withTmpProject('font-fallback')
    const fontPath = path.join(project.dir, 'Figtree.TTF')
    await copyFile(FIGTREE_PATH, fontPath)
    const { css } = await getFontFallbacks(pathToFileURL(FIGTREE_PATH), FILE_OPTIONS)
    expect((await getFontFallbacks(pathToFileURL(fontPath), FILE_OPTIONS)).css).toBe(css)
    const url = new URL(`file://localhost${pathToFileURL(FIGTREE_PATH).pathname}`)
    expect((await getFontFallbacks(url, FILE_OPTIONS)).css).toBe(css)
  })

  it.each([
    ['f.woff', "ends in .woff, and WOFF isn't supported. Pass its WOFF2 or TTF"],
    ['f.ttc', "ends in .ttc, and collections aren't supported. Pass one of its fonts"],
    ['f.ttf.bak', 'expected a path that ends in .ttf, .otf or .woff2, received `"f.ttf.bak"`'],
  ])('rejects a path that ends in %j', async (fileName, description) => {
    const fontPath = path.join(FIXTURES_DIR, fileName)
    await expectTypeError(
      getFontFallbacks(pathToFileURL(fontPath), FILE_OPTIONS),
      `font ${fontPath}: ${description}`,
    )
  })

  it.skipIf(process.platform === 'win32')(
    'rejects a folder, and a FIFO without blocking on it',
    { timeout: 30_000 },
    async () => {
      await using project = await withTmpProject('font-fallback')
      const folder = path.join(project.dir, 'folder.ttf')
      const fifo = path.join(project.dir, 'fifo.ttf')
      await mkdir(folder)
      execFileSync('mkfifo', [fifo])
      for (const fontPath of [folder, fifo]) {
        await expect(getFontFallbacks(pathToFileURL(fontPath), FILE_OPTIONS)).rejects.toThrow(
          new Error(`${PREFIX}: font ${fontPath}: is not a file`),
        )
      }
    },
  )

  it('rejects a file it fails to read by its path, with its code and the error as the cause', async () => {
    const fontPath = path.join(FIXTURES_DIR, 'My Fonts', 'missing.ttf')
    const error = await getRejection(getFontFallbacks(pathToFileURL(fontPath), FILE_OPTIONS))
    expect(error.message).toBe(`${PREFIX}: font ${fontPath}: failed to read: ENOENT`)
    expect(error.cause).toMatchObject({ code: 'ENOENT' })
  })

  // An encoded `/` has no path, and neither does a host other than localhost
  it.each(['file:///fonts%2Ff.ttf', 'file://evil.example/share/x.ttf'])(
    'rejects %s, which has no path on this system, without naming it',
    async (url) => {
      await expectTypeError(
        getFontFallbacks(new URL(url), FILE_OPTIONS),
        'font URL: has no path on this system. Pass a local file: URL',
      )
    },
  )

  it('rejects a file over 20 MiB without reading it', async () => {
    await using project = await withTmpProject('font-fallback')
    const fontPath = path.join(project.dir, 'big.ttf')
    const file = await open(fontPath, 'w')
    await file.truncate(MAX_BYTES + 1)
    await file.close()
    await expect(getFontFallbacks(pathToFileURL(fontPath), FILE_OPTIONS)).rejects.toThrow(
      new Error(`${PREFIX}: font ${fontPath}: it's over the limit of ${MAX_BYTES} bytes`),
    )
  })
})

const FONT_URL = 'https://fonts.example/f.ttf'

/**
 * Replaces `fetch` with `respond`, which gets the URL and the init
 */
function stubFetch(
  respond: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    respond(input instanceof Request ? input.url : String(input), init),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function fontResponse(
  body: ConstructorParameters<typeof Response>[0],
  contentType: string | null = 'font/ttf',
  status = 200,
): Response {
  const response = new Response(body, { status })
  // A body can set a type of its own
  if (contentType === null) {
    response.headers.delete('content-type')
  } else {
    response.headers.set('content-type', contentType)
  }
  return response
}

describe('fetching', () => {
  let font: Buffer
  beforeAll(async () => {
    font = await readFile(FIGTREE_PATH)
  })

  it('fetches an https: URL, as a string in any case or a URL, without redirects', async () => {
    const fetchMock = stubFetch(() => fontResponse(font))
    const { css } = await getFontFallbacks(new Uint8Array(font), FILE_OPTIONS)
    expect((await getFontFallbacks('HTTPS://fonts.example/F.TTF', FILE_OPTIONS)).css).toBe(css)
    expect((await getFontFallbacks(new URL(FONT_URL), FILE_OPTIONS)).css).toBe(css)
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(FONT_URL),
      expect.objectContaining({ redirect: 'error' }),
    )
    expect(lookup).toHaveBeenCalledWith('fonts.example', { all: true, verbatim: true })
  })

  it('fetches and names an https: URL as it was when called', async () => {
    const fetched: Array<string> = []
    stubFetch((url) => {
      fetched.push(url)
      return fontResponse(null, null, 404)
    })
    const url = new URL(FONT_URL)
    const changing = getFontFallbacks(url, FILE_OPTIONS)
    url.hostname = '169.254.169.254'
    await expect(changing).rejects.toThrow(
      new Error(`${PREFIX}: font ${FONT_URL}: failed to fetch: received status 404`),
    )
    expect(fetched).toEqual([FONT_URL])
  })

  it.each(['Font/TTF; charset=binary', 'application/octet-stream'])(
    'takes the content type %j',
    async (contentType) => {
      stubFetch(() => fontResponse(font, contentType))
      await expect(getFontFallbacks(FONT_URL, FILE_OPTIONS)).resolves.toBeDefined()
    },
  )

  it.each([
    ['text/css; charset=utf-8', '`"text/css"`'],
    [null, 'none'],
  ])('rejects the content type %j', async (contentType, received) => {
    stubFetch(() => fontResponse(font, contentType))
    await expect(getFontFallbacks(FONT_URL, FILE_OPTIONS)).rejects.toThrow(
      new Error(
        `${PREFIX}: font ${FONT_URL}: failed to fetch: expected a font content type, received ${received}`,
      ),
    )
  })

  it.each<[string | URL, string]>([
    [
      'https://user:hunter2@fonts.example/f.ttf',
      'font URL: has a username or password. Fetch the font yourself and pass its bytes',
    ],
    [
      new URL('https://fonts.example/f.ttf#secret'),
      'font URL: has a query or fragment. Pass a URL without one, or fetch the font yourself and pass its bytes',
    ],
    [
      'https://fonts.ex\nample/f.ttf',
      'font URL: has whitespace, a control or format character, or a backslash. Pass the URL without them, percent-encoded where needed',
    ],
    [
      'https://fonts.example/%2e%2e/f.ttf',
      'font https://fonts.example/f.ttf: is what the URL parser rewrites the string passed to, such as by dropping an extra slash, a default port or a dot segment, or by percent-encoding a character. Pass this URL',
    ],
    [
      'https://fonts.example:8443/f.ttf',
      'font https://fonts.example:8443/f.ttf: expected no port, received `"8443"`. Fetch the font yourself and pass its bytes',
    ],
    [
      'https://fonts.example/a.ttf/',
      "font https://fonts.example/a.ttf/: the path ends in a separator. Pass the font file's path",
    ],
    ...[
      ['https://0x7f.1/f.ttf', '127.0.0.1'],
      ['https://[::1]/f.ttf', '[::1]'],
      ['https://LOCALHOST./f.ttf', 'localhost.'],
    ].map(([source = '', host = '']): [string, string] => [
      source,
      `font ${new URL(source).href}: expected a host other than an IP address or localhost, received \`"${host}"\`. Fetch the font yourself and pass its bytes`,
    ]),
  ])('rejects the URL %s without fetching it', async (source, message) => {
    const fetchMock = stubFetch(() => fontResponse(font))
    await expectTypeError(getFontFallbacks(source, FILE_OPTIONS), message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a redirect', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') })
    })
    const error = await getRejection(getFontFallbacks(FONT_URL, FILE_OPTIONS))
    expect(error.message).toBe(
      `${PREFIX}: font ${FONT_URL}: failed to fetch: the server redirected. Pass the final URL`,
    )
    expect(error.cause).toBeInstanceOf(TypeError)
  })

  it('rejects a failed connection with its code, and the error as the cause', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      })
    })
    const error = await getRejection(getFontFallbacks(FONT_URL, FILE_OPTIONS))
    expect(error.message).toBe(`${PREFIX}: font ${FONT_URL}: failed to fetch: ECONNREFUSED`)
    expect(error.cause).toBeInstanceOf(TypeError)
  })

  it.each([
    [fontResponse(null, null, 404), 'received status 404'],
    [fontResponse(null), 'the response has no body'],
  ])('rejects a response that fails with %#', async (response, description) => {
    stubFetch(() => response)
    await expect(getFontFallbacks(FONT_URL, FILE_OPTIONS)).rejects.toThrow(
      new Error(`${PREFIX}: font ${FONT_URL}: failed to fetch: ${description}`),
    )
  })

  it('stops reading a body once it passes 20 MiB, whatever its content length', async () => {
    let isCancelled = false
    stubFetch(() => {
      const body = new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024))
        },
        cancel() {
          isCancelled = true
        },
      })
      return new Response(body, { headers: { 'content-type': 'font/ttf', 'content-length': '1' } })
    })
    await expect(getFontFallbacks(FONT_URL, FILE_OPTIONS)).rejects.toThrow(
      new Error(
        `${PREFIX}: font ${FONT_URL}: failed to fetch: it's over the limit of ${MAX_BYTES} bytes`,
      ),
    )
    expect(isCancelled).toBe(true)
  })

  it('reads a body whose content length is over 20 MiB only before decoding', async () => {
    stubFetch(() => {
      const response = fontResponse(font)
      response.headers.set('content-length', String(MAX_BYTES + 1))
      response.headers.set('content-encoding', 'br')
      return response
    })
    expect((await getFontFallbacks(FONT_URL, FILE_OPTIONS)).css).toBe(
      (await getFontFallbacks(new Uint8Array(font), FILE_OPTIONS)).css,
    )
  })

  it.each<[string, () => void]>([
    [
      'a server that stalls its body after the headers',
      () => {
        stubFetch((_url, init) => {
          const { signal } = init ?? {}
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(100))
              // Errors once the signal aborts, as undici does
              signal?.addEventListener('abort', () => {
                controller.error(signal.reason)
              })
            },
          })
          return fontResponse(body)
        })
      },
    ],
    [
      'a lookup that never settles',
      () => {
        lookup.mockReturnValue(new Promise(() => undefined))
      },
    ],
  ])('times out after 10 seconds on %s', async (_, setUp) => {
    // A timeout signal that times out after 10 ms
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController()
      setTimeout(() => {
        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))
      }, 10)
      return controller.signal
    })
    try {
      setUp()
      const error = await getRejection(getFontFallbacks(FONT_URL, FILE_OPTIONS))
      expect(timeout).toHaveBeenCalledWith(10_000)
      expect(error.message).toBe(
        `${PREFIX}: font ${FONT_URL}: failed to fetch: timed out after 10 seconds`,
      )
    } finally {
      timeout.mockRestore()
    }
  })
})

describe('resolved addresses', () => {
  let font: Buffer
  beforeAll(async () => {
    font = await readFile(FIGTREE_PATH)
  })

  it.each([
    '169.254.169.254',
    '::ffff:a9fe:a9fe',
    // NAT64 and 6to4 forms of private IPv4 addresses
    '64:ff9b::7f00:1',
    '2002:ac1f:ffff::',
  ])('rejects a host that resolves to %s, without fetching it', async (address) => {
    const fetchMock = stubFetch(() => fontResponse(font))
    lookup.mockResolvedValue([
      ...PUBLIC_ADDRESSES,
      { address, family: address.includes(':') ? 6 : 4 },
    ])
    await expectTypeError(
      getFontFallbacks(FONT_URL, FILE_OPTIONS),
      `font ${FONT_URL}: expected a host that resolves to public addresses, received one that resolves to ${describeValue(address)}. Download the font and pass its path or bytes`,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['172.32.0.1', '64:ff9b::808:808'])(
    'fetches a host that resolves to %s',
    async (address) => {
      const fetchMock = stubFetch(() => fontResponse(font))
      lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }])
      await getFontFallbacks(FONT_URL, FILE_OPTIONS)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('rejects a host that fails to resolve with its code', async () => {
    const fetchMock = stubFetch(() => fontResponse(font))
    const failure = Object.assign(new Error('getaddrinfo ENOTFOUND fonts.example'), {
      code: 'ENOTFOUND',
    })
    lookup.mockRejectedValue(failure)
    const error = await getRejection(getFontFallbacks(FONT_URL, FILE_OPTIONS))
    expect(error.message).toBe(`${PREFIX}: font ${FONT_URL}: failed to fetch: ENOTFOUND`)
    expect(error.cause).toBe(failure)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
