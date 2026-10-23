import dns from 'node:dns/promises'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { BlockList } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describeValue, formatMessage, getErrorCode } from '@gpahal/std/errors'
import { escapeControls } from '@gpahal/std/strings'

import { findRegularFamily, getFamilySubject, type FamilyFace } from '@/internal/families'
import { EXPECTED_FAMILY_NAME, getFamilyKey, isFamilyName, PREFIX } from '@/internal/options'
import { readFontFile, type FontExtension } from '@/internal/parse'
import type { FontCategory, FontMetrics } from '@/internal/types'

export const HTTPS_REGEX: RegExp = /^https:\/\//i
/**
 * A string that reads as a path: one with a `/` or `\`, or one that ends in the extension of a font
 * file, supported or not
 */
export const PATH_LIKE_REGEX: RegExp = /[/\\]|\.(?:ttf|otf|woff2?|ttc|otc|dfont)$/i
/**
 * A string that starts with a URL scheme, but not a Windows path from a drive's root, which starts
 * like a URL of a one-letter scheme
 */
export const SCHEME_REGEX: RegExp = /^(?![a-z]:[/\\])[a-z][a-z\d+.-]*:/i
/**
 * A path of a font file, with its extension
 */
const FONT_PATH_REGEX = /\.(?<extension>ttf|otf|woff2?|ttc|otc)$/i
const FONT_EXTENSIONS: ReadonlyArray<FontExtension> = ['ttf', 'otf', 'woff2']
/**
 * The error descriptions of font files' extensions that aren't supported, by the extension
 */
const UNSUPPORTED_EXTENSIONS: Readonly<Record<string, string>> = {
  woff: "ends in .woff, and WOFF isn't supported. Pass its WOFF2 or TTF",
  ttc: "ends in .ttc, and collections aren't supported. Pass one of its fonts",
  otc: "ends in .otc, and collections aren't supported. Pass one of its fonts",
}
/**
 * A host name that's an IPv4 address. The URL parser writes every IPv4 form, such as `0x7f.1`, as
 * four decimals
 */
const IPV4_REGEX = /^\d+\.\d+\.\d+\.\d+$/
/**
 * A character the URL parser drops or rewrites in a URL string: whitespace, a control or format
 * character, or a backslash
 */
const UNPARSED_URL_REGEX = /[\s\p{Cc}\p{Cf}\\]/u
/**
 * Host names that resolve to loopback, through the hosts file of many Linux systems, besides
 * `localhost` and `*.localhost`
 */
const LOCALHOST_NAMES: ReadonlySet<string> = new Set([
  'localhost',
  'localhost.localdomain',
  // RHEL and Fedora name IPv4 and IPv6 loopback apart
  'localhost4',
  'localhost4.localdomain4',
  'localhost6',
  'localhost6.localdomain6',
  'ip6-localhost',
  'ip6-loopback',
])
/**
 * An IPv4 address as the two 16-bit hexadecimal groups of an IPv6 address
 */
function toHexGroups(address: string): [string, string] {
  const [a = 0, b = 0, c = 0, d = 0] = address.split('.').map(Number)
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)]
}
/**
 * The addresses a URL's host can't resolve to: unspecified, loopback, link-local, which holds cloud
 * metadata services, private (RFC 1918 and IPv6 unique local), shared (CGNAT), IETF protocol
 * assignments, multicast and reserved. `BlockList` matches an IPv4-mapped IPv6 address, such as
 * `::ffff:127.0.0.1`, by its IPv4 rules. The NAT64 (`64:ff9b::/96`), SIIT (`::ffff:0:0:0/96`) and
 * 6to4 (`2002::/16`) forms of the IPv4 ranges, which a gateway routes to the IPv4 address, are
 * listed too, as is all of local-use NAT64 (`64:ff9b:1::/48`). Benchmarking (`198.18.0.0/15`) is
 * left out, since proxies' fake-IP modes resolve public hosts to it
 */
const PRIVATE_ADDRESSES: BlockList = (() => {
  const list = new BlockList()
  for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const) {
    list.addSubnet(network, prefix, 'ipv4')
    const [high, low] = toHexGroups(network)
    list.addSubnet(`64:ff9b::${high}:${low}`, 96 + prefix, 'ipv6')
    list.addSubnet(`::ffff:0:${high}:${low}`, 96 + prefix, 'ipv6')
    list.addSubnet(`2002:${high}:${low}::`, 16 + prefix, 'ipv6')
  }
  for (const [network, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b:1::', 48],
    ['fe80::', 10],
    ['fc00::', 7],
    ['ff00::', 8],
  ] as const) {
    list.addSubnet(network, prefix, 'ipv6')
  }
  return list
})()
/**
 * The {@link getFamilyKey} of the families of `@capsizecss/metrics` that name the system UI font,
 * which a page can't load as a web font. They're taken as fallbacks
 */
const SYSTEM_FONT_KEYS: ReadonlySet<string> = new Set(
  ['-apple-system', 'BlinkMacSystemFont'].map(getFamilyKey),
)
/**
 * The end of a URL's authority, after `https://`
 */
const AUTHORITY_END_REGEX = /[/?#]|$/
/**
 * The subject of errors about a URL that give no detail of it, which could hold credentials or a
 * token
 */
const URL_SUBJECT = 'font URL'
/**
 * The most bytes read, fetched or passed
 */
const MAX_BYTES = 20 * 1024 * 1024
export const TOO_LARGE: string = `it's over the limit of ${MAX_BYTES} bytes`
/**
 * The longest a fetch may take
 */
const FETCH_TIMEOUT_MS = 10_000
/**
 * An error code safe to show, such as Node's `ENOENT` or a TLS code
 */
const ERROR_CODE_REGEX = /^[A-Z][A-Z\d_]*$/
/**
 * The media types of a fetched font. Servers send fonts with any of these. WOFF and collections
 * are taken so the font's signature check names them
 */
const FONT_CONTENT_TYPE_REGEX =
  /^(?:font\/(?:ttf|otf|sfnt|woff2?|opentype|collection)|(?:application|binary)\/octet-stream|application\/vnd\.ms-opentype|application\/(?:x-)?font-[\w.+-]+)$/

/**
 * The web font's source, checked: a family name, a font file to read or fetch, or its bytes
 */
export type CheckedSource =
  | { kind: 'family'; familyName: string; subject: string }
  | { kind: 'file'; url: URL; extension: FontExtension; subject: string }
  | { kind: 'bytes'; bytes: Uint8Array; subject: string }

/**
 * Checks the web font's source, without reading, fetching or looking it up
 *
 * @throws TypeError if `source` isn't a family name, an `https:` URL string, a `file:` or `https:`
 *   `URL` or a `Uint8Array`, a URL is rejected (see the README's "Rejected inputs"), or bytes are
 *   over 20 MiB.
 */
export function checkSource(source: unknown): CheckedSource {
  if (typeof source === 'string') {
    if (HTTPS_REGEX.test(source)) {
      // The URL parser drops tabs, newlines and surrounding controls and spaces, and reads `\` as
      // `/`, so a URL with them would be repaired. Not named, as it could hold credentials
      if (UNPARSED_URL_REGEX.test(source)) {
        throw new TypeError(
          formatMessage(
            PREFIX,
            [URL_SUBJECT],
            'has whitespace, a control or format character, or a backslash. Pass the URL without them, percent-encoded where needed',
          ),
        )
      }
      const url = URL.parse(source)
      if (url === null) {
        throw new TypeError(formatMessage(PREFIX, [URL_SUBJECT], "doesn't parse"))
      }
      const checked = checkHttpsUrl(url)
      checkUnrewritten(source, url)
      return checked
    }
    if (!isFamilyName(source)) {
      throw getStringError(source)
    }
    const subject = getFamilySubject('family', source)
    if (SYSTEM_FONT_KEYS.has(getFamilyKey(source))) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [subject],
          "names the system UI font, which isn't a web font. Pass your web font's family name or font file",
        ),
      )
    }
    return { kind: 'family', familyName: source, subject }
  }
  // A `URL` and bytes are copied before their contents are checked, as they're read after the
  // caller can change them
  const href = getUrlHref(source)
  if (href !== undefined) {
    // A `URL` from another realm can carry an `href` that doesn't parse
    const url = URL.parse(href)
    if (url === null) {
      throw new TypeError(formatMessage(PREFIX, [URL_SUBJECT], "doesn't parse"))
    }
    if (url.protocol === 'https:') {
      return checkHttpsUrl(url)
    }
    if (url.protocol === 'file:') {
      return checkFileUrl(url)
    }
    throw new TypeError(
      formatMessage(
        PREFIX,
        [URL_SUBJECT],
        `expected file: or https:, received ${describeValue(url.protocol)}`,
      ),
    )
  }
  if (source instanceof Uint8Array) {
    const subject = 'font bytes'
    if (source.byteLength > MAX_BYTES) {
      throw new TypeError(formatMessage(PREFIX, [subject], TOO_LARGE))
    }
    // Not `source.slice()`, which is a view for a `Buffer`
    const bytes = new Uint8Array(source)
    // Another thread can grow a `SharedArrayBuffer` between the check and the copy
    if (bytes.byteLength > MAX_BYTES) {
      throw new TypeError(formatMessage(PREFIX, [subject], TOO_LARGE))
    }
    return { kind: 'bytes', bytes, subject }
  }
  throw new TypeError(
    formatMessage(
      PREFIX,
      ['font'],
      `expected a family name, an https: URL, a \`URL\` or a \`Uint8Array\`, received ${describeValue(source)}`,
    ),
  )
}

/**
 * The `href` of `value` if it's a `URL`, read once so a getter can't change it between the check
 * and the use. As in std's urls module, `instanceof URL` fails for one from another realm, such as
 * a `vm` context or another bundle's polyfill, so an object that `Object.prototype.toString` tags
 * `[object URL]` with a string `href` is accepted too
 */
function getUrlHref(value: unknown): string | undefined {
  if (value instanceof URL) {
    return value.href
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.prototype.toString.call(value) !== '[object URL]'
  ) {
    return undefined
  }
  const href: unknown = Reflect.get(value, 'href')
  return typeof href === 'string' ? href : undefined
}

/**
 * The error of a string that's neither a family name nor an `https:` URL
 */
function getStringError(source: string): TypeError {
  // A string with a `:` isn't echoed, as a URL of another scheme can hold credentials
  const received = source.includes(':')
    ? 'a string with a `:`, such as a URL of another scheme or a face suffix'
    : describeValue(source)
  const hint =
    PATH_LIKE_REGEX.test(source) && !SCHEME_REGEX.test(source)
      ? '. Pass a `file:` URL, such as `pathToFileURL(path)`'
      : ''
  return new TypeError(
    formatMessage(
      PREFIX,
      ['font'],
      `expected ${EXPECTED_FAMILY_NAME}, or an https:// URL, received ${received}${hint}`,
    ),
  )
}

function checkCredentials(url: URL): void {
  if (url.username !== '' || url.password !== '') {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [URL_SUBJECT],
        'has a username or password. Fetch the font yourself and pass its bytes',
      ),
    )
  }
}

/**
 * The extension of a font file's path. The error gives its last segment, as the subject names the
 * whole path and a long one would be cut short
 *
 * @throws TypeError if the path ends in a separator or doesn't end in `.ttf`, `.otf` or `.woff2`,
 *   naming why for a WOFF font or a collection.
 */
function getExtension(filePath: string, fileName: string, subject: string): FontExtension {
  // `path.basename` drops a trailing separator, so the name it gives would look valid
  if (filePath.endsWith('/') || filePath.endsWith(path.sep)) {
    throw new TypeError(
      formatMessage(PREFIX, [subject], "the path ends in a separator. Pass the font file's path"),
    )
  }
  const lowerExtension = FONT_PATH_REGEX.exec(filePath)?.groups?.['extension']?.toLowerCase()
  const extension = FONT_EXTENSIONS.find((known) => known === lowerExtension)
  const unsupported = UNSUPPORTED_EXTENSIONS[lowerExtension ?? '']
  if (unsupported !== undefined) {
    throw new TypeError(formatMessage(PREFIX, [subject], unsupported))
  }
  if (extension === undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [subject],
        `expected a path that ends in .ttf, .otf or .woff2, received ${describeValue(fileName)}`,
      ),
    )
  }
  return extension
}

function checkHttpsUrl(url: URL): CheckedSource {
  checkCredentials(url)
  // `href` keeps an empty query or fragment, which `search` and `hash` don't
  if (url.search !== '' || url.hash !== '' || url.href.includes('?') || url.href.includes('#')) {
    // Not named, as a query can hold a token
    throw new TypeError(
      formatMessage(
        PREFIX,
        [URL_SUBJECT],
        'has a query or fragment. Pass a URL without one, or fetch the font yourself and pass its bytes',
      ),
    )
  }
  const subject = `font ${url.href}`
  // A host can end in several dots, which name the same host
  let host = url.hostname.toLowerCase()
  while (host.endsWith('.')) {
    host = host.slice(0, -1)
  }
  if (
    LOCALHOST_NAMES.has(host) ||
    host.startsWith('[') ||
    host.endsWith('.localhost') ||
    IPV4_REGEX.test(host)
  ) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [subject],
        `expected a host other than an IP address or localhost, received ${describeValue(url.hostname)}. Fetch the font yourself and pass its bytes`,
      ),
    )
  }
  if (url.port !== '') {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [subject],
        `expected no port, received ${describeValue(url.port)}. Fetch the font yourself and pass its bytes`,
      ),
    )
  }
  return {
    kind: 'file',
    url,
    extension: getExtension(
      url.pathname,
      url.pathname.slice(url.pathname.lastIndexOf('/') + 1),
      subject,
    ),
    subject,
  }
}

/**
 * Checks that the URL parser kept an `https://` string as it is, but for the case of its scheme and
 * host
 *
 * @throws TypeError naming the URL as parsed if the parser rewrote the string, as it drops an extra
 *   slash, a default port and dot segments, and percent-encodes some characters.
 */
function checkUnrewritten(source: string, url: URL): void {
  const rest = source.slice('https://'.length)
  const authorityEnd = AUTHORITY_END_REGEX.exec(rest)?.index ?? rest.length
  const expected = `https://${rest.slice(0, authorityEnd).toLowerCase()}${rest.slice(authorityEnd)}`
  if (url.href !== expected) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [`font ${url.href}`],
        'is what the URL parser rewrites the string passed to, such as by dropping an extra slash, a default port or a dot segment, or by percent-encoding a character. Pass this URL',
      ),
    )
  }
}

function checkFileUrl(url: URL): CheckedSource {
  checkCredentials(url)
  const noPath = 'has no path on this system. Pass a local file: URL'
  // `fileURLToPath` rejects a host only on POSIX. On Windows, it makes a UNC path, which is read
  // over SMB
  // The URL parser drops a `localhost` host, so any host left is another machine's
  if (url.host !== '') {
    throw new TypeError(formatMessage(PREFIX, [URL_SUBJECT], noPath))
  }
  let filePath: string
  try {
    filePath = fileURLToPath(url)
  } catch (error) {
    // An encoded `/`, or on Windows an encoded `\`
    throw new TypeError(formatMessage(PREFIX, [URL_SUBJECT], noPath), { cause: error })
  }
  // A Windows path keeps its single backslashes
  const subject = `font ${escapeControls(filePath, { keepBackslashes: true })}`
  return {
    kind: 'file',
    url,
    extension: getExtension(filePath, path.basename(filePath), subject),
    subject,
  }
}

/**
 * The regular face of a family of `@capsizecss/metrics`, and its category
 *
 * @throws TypeError if the family is unknown or has no regular face.
 */
export async function loadFamily(
  source: Extract<CheckedSource, { kind: 'family' }>,
): Promise<{ face: FamilyFace; category: FontCategory }> {
  return findRegularFamily(
    source.familyName,
    source.subject,
    'Pass a font file of its regular face',
  )
}

/**
 * Reads, fetches or parses a font file, and reads its regular face's metrics
 *
 * @throws The signal's reason once it's aborted.
 * @throws If the font file can't be loaded or is rejected (see `readFontFile`).
 */
export async function loadFontFile(
  source: Exclude<CheckedSource, { kind: 'family' }>,
  signal: AbortSignal | undefined,
): Promise<FontMetrics> {
  if (source.kind === 'bytes') {
    return readFontFile(source.bytes, source.subject, undefined)
  }
  const { url, extension, subject } = source
  const bytes = await (url.protocol === 'file:'
    ? readFile(url, subject, signal)
    : fetchFile(url, subject, signal))
  return readFontFile(bytes, subject, extension)
}

/**
 * Why reading or fetching failed, without the URL, which a message can hold: the library's own
 * timeout, or the error's code or its cause's
 */
function getFailureReason(error: unknown): string | undefined {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`
  }
  const code = getErrorCode(error) ?? getErrorCode(error instanceof Error ? error.cause : undefined)
  return code !== undefined && ERROR_CODE_REGEX.test(code) ? code : undefined
}

function createFailures(
  subject: string,
  signal: AbortSignal | undefined,
): {
  fail: (description: string, cause?: unknown) => Error
  failTo: (verb: 'read' | 'fetch', error: unknown) => Error
} {
  const fail = (description: string, cause?: unknown): Error =>
    new Error(
      formatMessage(PREFIX, [subject], description),
      cause === undefined ? undefined : { cause },
    )
  return {
    fail,
    // The error of a failure to read or fetch, or the signal's reason once it's aborted, so the
    // usual `AbortError` check works
    failTo: (verb, error) => {
      signal?.throwIfAborted()
      const reason = getFailureReason(error)
      return fail(`failed to ${verb}${reason === undefined ? '' : `: ${reason}`}`, error)
    },
  }
}

async function readFile(
  url: URL,
  subject: string,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const { fail, failTo } = createFailures(subject, signal)
  const reading = async <T>(read: Promise<T>): Promise<T> => {
    try {
      return await read
    } catch (error) {
      throw failTo('read', error)
    }
  }
  // Opened before it's checked, so the checked file is the one read. Nonblocking, so opening a FIFO
  // doesn't wait for a writer
  const handle = await reading(open(url, constants.O_RDONLY | constants.O_NONBLOCK))
  try {
    const stats = await reading(handle.stat())
    if (!stats.isFile()) {
      throw fail('is not a file')
    }
    if (stats.size > MAX_BYTES) {
      throw fail(TOO_LARGE)
    }
    // A stream made with an aborted signal emits its error before it's read, unhandled, so an abort
    // since `open` rejects here
    signal?.throwIfAborted()
    // The size can change after `stat`, so the read stops one byte past the limit too. `end` is
    // inclusive
    const bytes = await reading(
      readAtMost(handle.createReadStream({ start: 0, end: MAX_BYTES, autoClose: false, signal })),
    )
    if (bytes === undefined) {
      throw fail(TOO_LARGE)
    }
    return bytes
  } finally {
    await handle.close()
  }
}

async function fetchFile(
  url: URL,
  subject: string,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const { fail, failTo } = createFailures(subject, signal)
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const fetchSignal = signal ? AbortSignal.any([timeout, signal]) : timeout
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await untilAborted(
      dns.lookup(url.hostname, { all: true, order: 'verbatim' }),
      fetchSignal,
    )
  } catch (error) {
    throw failTo('fetch', error)
  }
  const privateAddress = addresses.find(({ address, family }) =>
    PRIVATE_ADDRESSES.check(address, family === 6 ? 'ipv6' : 'ipv4'),
  )
  if (privateAddress !== undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [subject],
        `expected a host that resolves to public addresses, received one that resolves to ${describeValue(privateAddress.address)}. Download the font and pass its path or bytes`,
      ),
    )
  }
  let response: Response
  try {
    response = await fetch(url, { signal: fetchSignal, redirect: 'error' })
  } catch (error) {
    // undici rejects a redirect with this cause, which `tests/upstream.test.ts` checks
    const isRedirect =
      error instanceof TypeError &&
      error.cause instanceof Error &&
      error.cause.message === 'unexpected redirect'
    throw isRedirect
      ? fail('failed to fetch: the server redirected. Pass the final URL', error)
      : failTo('fetch', error)
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw fail(`failed to fetch: received status ${response.status}`)
  }
  const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim() ?? ''
  if (!FONT_CONTENT_TYPE_REGEX.test(contentType.toLowerCase())) {
    await response.body?.cancel()
    throw fail(
      `failed to fetch: expected a font content type, received ${contentType === '' ? 'none' : describeValue(contentType)}`,
    )
  }
  // Without a content encoding, the length is the body's, so a body over the limit is rejected
  // without fetching it. Its decoded size is unknown otherwise, so it's checked as it's read
  const contentLength = response.headers.get('content-length')
  if (
    contentLength !== null &&
    !response.headers.has('content-encoding') &&
    Number(contentLength) > MAX_BYTES
  ) {
    await response.body?.cancel()
    throw fail(`failed to fetch: ${TOO_LARGE}`)
  }
  const body: AsyncIterable<Uint8Array> | null = response.body
  if (body === null) {
    throw fail('failed to fetch: the response has no body')
  }
  let bytes: Uint8Array | undefined
  try {
    bytes = await readAtMost(body)
  } catch (error) {
    throw failTo('fetch', error)
  }
  if (bytes === undefined) {
    throw fail(`failed to fetch: ${TOO_LARGE}`)
  }
  return bytes
}

/**
 * `promise`, or a rejection with `signal`'s reason once it aborts, for work such as a DNS lookup
 * that takes no signal and keeps running after it
 */
async function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const { promise: aborted, reject } = Promise.withResolvers<never>()
  const onAbort = (): void => {
    reject(signal.reason)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * The bytes of a stream, or `undefined` once they pass {@link MAX_BYTES}
 */
export async function readAtMost(
  stream: AsyncIterable<Uint8Array>,
): Promise<Uint8Array | undefined> {
  const chunks: Array<Uint8Array> = []
  let size = 0
  // Leaving the loop early cancels or closes the stream
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > MAX_BYTES) {
      return undefined
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}
