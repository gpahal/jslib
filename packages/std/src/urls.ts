/**
 * Url checks and parts. Contract: untrusted input, including attacker-controlled strings
 */

import { describeValue } from '@/internal/describe'
import { stdMessage } from '@/internal/message'
import { ensurePrefix, trim } from '@/strings'

/**
 * A url as a string or a `URL`. An object tagged `[object URL]` with a string `href` counts as a
 * `URL`, so one from another realm works. A plain `{ href }` object doesn't
 */
export type Url = string | URL

function getUrlString(caller: string, parameter: string, url: unknown): string {
  if (typeof url === 'string') {
    return url
  }
  const href = getUrlHref(url)
  if (href !== undefined) {
    return href
  }
  throw new TypeError(
    stdMessage(
      [caller, parameter],
      `expected a string or a \`URL\`, received ${describeValue(url)}`,
    ),
  )
}

/**
 * Reads `href` once, so a getter can't change it between the check and the use
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
 * The WHATWG URL parser removes these from anywhere in its input
 */
const TAB_OR_NEWLINE_REGEX = /[\t\n\r]/g
const HAS_TAB_OR_NEWLINE_REGEX = /[\t\n\r]/
const SCHEME_REGEX = /^[a-z][\d+.a-z-]*:/i
/**
 * Special schemes like `https` treat `\` like `/`, so `/\host` is protocol-relative too
 */
const PROTOCOL_RELATIVE_REGEX = /^[/\\]{2}/

/**
 * A url as the WHATWG URL parser sees it before parsing: without C0 controls and spaces at its
 * ends, or tabs and newlines anywhere. A scan rather than {@link trim}, which builds a set on every
 * call
 */
function preprocessUrlString(url: string): string {
  let start = 0
  let end = url.length
  while (start < end && isC0ControlOrSpaceAt(url, start)) {
    start++
  }
  while (end > start && isC0ControlOrSpaceAt(url, end - 1)) {
    end--
  }
  const trimmed = start === 0 && end === url.length ? url : url.slice(start, end)
  return HAS_TAB_OR_NEWLINE_REGEX.test(trimmed)
    ? trimmed.replaceAll(TAB_OR_NEWLINE_REGEX, '')
    : trimmed
}

function isC0ControlOrSpaceAt(s: string, index: number): boolean {
  return (s.codePointAt(index) ?? Infinity) <= 0x20
}

/**
 * An `https:` page on a reserved domain, which never resolves
 */
const BASE_URL = 'https://x.invalid'

/**
 * Check if a url is absolute, so it can lead to another origin: it has a scheme, such as `https:` or
 * `javascript:`, or it's protocol-relative, such as `//host` or `/\host`. Like the WHATWG URL
 * parser, it ignores leading C0 controls and spaces, and tabs and newlines anywhere, so ` //host`
 * and `java\tscript:` are absolute. Any scheme counts: `https:evil.com` is the host `evil.com` on
 * an `http:` page.
 *
 * After a check, redirect to the string you checked, never to a pathname resolved from it:
 * `/.//evil.com` is relative, but its pathname `//evil.com` isn't. Or use
 * {@link getSafeRedirectPath}.
 *
 * @throws TypeError if `url` isn't a string or a `URL`.
 */
export function isAbsoluteUrl(url: Url): boolean {
  return hasOrigin(preprocessUrlString(getUrlString('`isAbsoluteUrl`', '`url`', url)))
}

/**
 * A server that decodes the pathname before redirecting gets new separators, and with dot segments,
 * as in `/..%2F%2Fevil.com`, they resolve to a protocol-relative url
 */
const ENCODED_SEPARATOR_REGEX = /%(?:2f|5c)/i
/**
 * A percent-encoded C0 control or DEL. A server that decodes it gets the control back, and the URL
 * parser deletes a tab or newline, so `/%09/evil.com` becomes `//evil.com`
 */
const ENCODED_CONTROL_REGEX = /%(?:[01][\da-f]|7f)/i

/**
 * IIS decodes `%uXXXX`, so `/%u002f/evil` becomes `///evil` there
 */
const UNICODE_ESCAPE_REGEX = /%u[\da-f]{4}/i

const PERCENT_ENCODED_BYTE_REGEX = /%[\da-f]{2}/gi

/**
 * A path decoded once the way the most lenient server, such as PHP's `urldecode`, does: each valid
 * `%XX` becomes its byte's character and a malformed escape stays, so `%2%46` gives `%2F`. It never
 * throws. Multibyte characters decode wrong, which doesn't matter to checks for ASCII ones
 */
function decodeBytes(path: string): string {
  return path.replaceAll(PERCENT_ENCODED_BYTE_REGEX, (encoded) =>
    String.fromCodePoint(Number.parseInt(encoded.slice(1), 16)),
  )
}

/**
 * Get a same-origin path to redirect to from a user-supplied target, such as a `?next=` parameter.
 * Redirect only to what it returns, not to the target.
 *
 * The path is the target's pathname, query string and hash, resolved against `/`. A trailing `/` is
 * kept, and so is a `//` or a doubly encoded separator in the query string or hash, as in
 * `/login?next=%252Fhome`.
 *
 * It returns `fallback` for:
 *
 * - a target that isn't a string, is blank or is absolute
 * - a pathname with an empty segment anywhere but at its end, as in `/a//b`, also once its `;` path
 *   parameters are dropped after up to two decodes. A server that decodes double-encoded dot
 *   segments or drops path parameters can turn a later empty segment into a leading one, as in
 *   `/%252e%252e//evil.com` or `/.;//evil.com`
 * - an encoded `/` or `\` in the pathname, or an encoded C0 control or DEL anywhere, also once
 *   decoded, as in `/%09/evil.com` or `/%25%32%46`
 * - an IIS-style `%uXXXX` escape anywhere, also once decoded
 *
 * It doesn't apply Unicode normalization, so don't NFKC-normalize paths after this check: a
 * fullwidth solidus, returned as `/%EF%BC%8F`, would become `/`. Overlong UTF-8 such as `%c0%af` and
 * encoded C1 controls such as `%C2%85` pass.
 *
 * @example
 * ```ts
 * import { getSafeRedirectPath } from '@gpahal/std/urls'
 *
 * getSafeRedirectPath('/a?b=1#c') // '/a?b=1#c'
 * getSafeRedirectPath('a/b') // '/a/b'
 * getSafeRedirectPath('https://evil.com') // '/'
 * getSafeRedirectPath('/.//evil.com', '/home') // '/home'
 * ```
 *
 * @param target - The user-supplied target, of any type.
 * @param fallback - The path to return for an unsafe target, as given. Default is `/`.
 * @throws TypeError if `fallback` isn't a safe path that it would return unchanged as a target,
 *   such as `'home'`, `' /home'`, `'/ho\tme'`, `'/.//evil.com'` or `'/%09/evil.com'`. A character
 *   the URL parser percent-encodes must be encoded already: `'/a%20b'`, not `'/a b'`.
 */
export function getSafeRedirectPath(target: unknown, fallback = '/'): string {
  if (typeof fallback !== 'string' || resolveRedirectPath(fallback) !== fallback) {
    throw new TypeError(
      stdMessage(
        ['`getSafeRedirectPath`', '`fallback`'],
        `expected a safe path that it returns unchanged as a target, received ${describeValue(fallback)}`,
      ),
    )
  }
  return typeof target === 'string' ? (resolveRedirectPath(target) ?? fallback) : fallback
}

function resolveRedirectPath(target: string): string | undefined {
  const preprocessedTarget = preprocessUrlString(target)
  if (preprocessedTarget.trim() === '' || hasOrigin(preprocessedTarget)) {
    return undefined
  }

  const url = URL.parse(preprocessedTarget, BASE_URL)
  if (
    url?.origin !== BASE_URL ||
    hasEmptySegment(url.pathname) ||
    hasEncodedMatch(url.pathname, ENCODED_SEPARATOR_REGEX)
  ) {
    return undefined
  }
  const path = `${url.pathname}${url.search}${url.hash}`
  return hasEncodedMatch(path, ENCODED_CONTROL_REGEX) || hasEncodedMatch(path, UNICODE_ESCAPE_REGEX)
    ? undefined
    : path
}

/**
 * Whether `pathname` has an empty segment before its last one, also once a server drops `;` path
 * parameters after up to two decodes. Anywhere, not just at the start, since a server can resolve
 * the dot segments before it into `//evil.com`
 */
function hasEmptySegment(pathname: string): boolean {
  return pathname
    .split('/')
    .slice(1, -1)
    .some((segment) => segment === '' || decodeBytes(decodeBytes(segment)).startsWith(';'))
}

/**
 * Whether `s` matches `regex`, as is or decoded once. Checking the decoded string, rather than
 * looking for `%25`, also catches `%25%32%46`, which decodes to `%2F`
 */
function hasEncodedMatch(s: string, regex: RegExp): boolean {
  return regex.test(s) || regex.test(decodeBytes(s))
}

const UNRESERVED_CHAR_REGEX = /^[\w.~-]$/

/**
 * RFC 3986 normalization: percent-encoded unreserved characters are decoded and the hex digits of
 * the rest are uppercased. `/a%2Fb` stays distinct from `/a/b`
 */
function normalizePercentEncoding(pathname: string): string {
  return pathname.replaceAll(PERCENT_ENCODED_BYTE_REGEX, (encoded) => {
    const char = String.fromCodePoint(Number.parseInt(encoded.slice(1), 16))
    return UNRESERVED_CHAR_REGEX.test(char) ? char : encoded.toUpperCase()
  })
}

/**
 * The current page for {@link getLinkActiveState}, such as `location`
 */
export type LinkActiveStateCurrent = {
  readonly pathname: string
  readonly origin?: string | null | undefined
}

/**
 * Check whether a navigation link is active for the current page.
 *
 * Pathnames match after percent-encoding normalization, so `/café` matches `/caf%C3%A9`, but
 * `/a%2Fb` doesn't match `/a/b`. Leading and trailing `/`, query strings and hashes are ignored. A
 * relative target resolves against the current url, as an `<a href>` does. An empty or query-only
 * target is active, and a hash-only one never is. Only `http:` and `https:` targets can be active.
 *
 * @example
 * ```ts
 * import { getLinkActiveState } from '@gpahal/std/urls'
 *
 * const { isActive, isChildActive } = getLinkActiveState('/docs', { pathname: '/docs/start' })
 * getLinkActiveState('b', { pathname: '/docs/b' }) // { isActive: true, isChildActive: false }
 * ```
 *
 * @param targetUrl - The link's url, a string or a `URL`
 * @param current - The current page, such as `location`
 * @param current.pathname - The current page's pathname
 * @param current.origin - The current page's origin. When given, a link to an absolute url is
 *   active only if it has the same origin, and targets resolve against it. When missing, `null` or
 *   the opaque origin `'null'`, only pathnames are compared
 * @throws TypeError if an argument has the wrong type, or `current.origin` isn't a url with an
 *   origin, `'null'`, `null` or `undefined`
 * @returns `isActive` when the pathnames are the same, `isChildActive` when the current pathname is
 *   below the target's, like `/docs/a` for `/docs`. A target of `/` is never child-active
 */
export function getLinkActiveState(
  targetUrl: Url,
  current: LinkActiveStateCurrent,
): { isActive: boolean; isChildActive: boolean } {
  const caller = '`getLinkActiveState`'
  // Checked before the `try` below, which would swallow the error and report the link inactive
  const targetUrlString = getUrlString(caller, '`targetUrl`', targetUrl)
  const currentValue: unknown = current
  if (typeof currentValue !== 'object' || currentValue === null) {
    throw new TypeError(
      stdMessage([caller, '`current`'], `expected an object, received ${describeValue(current)}`),
    )
  }
  const origin = getCurrentOrigin(current.origin)
  const pathname: unknown = current.pathname
  if (typeof pathname !== 'string') {
    throw new TypeError(
      stdMessage(
        [caller, '`current.pathname`'],
        `expected a string, received ${describeValue(pathname)}`,
      ),
    )
  }
  let currentPathname = pathname
  const inactive = { isActive: false, isChildActive: false }
  const targetString = typeof targetUrl === 'string' ? preprocessUrlString(targetUrl) : undefined
  if (targetString?.startsWith('#') === true) {
    return inactive
  }

  let target: URL
  try {
    // Appended to an origin, so a pathname starting with `//` isn't protocol-relative. The current
    // origin, when known, since a target like `http:docs` is relative to it when the schemes match
    const currentUrl = new URL(`${origin ?? BASE_URL}${ensurePrefix(currentPathname, '/')}`)
    currentPathname = currentUrl.pathname
    target = new URL(targetUrlString, currentUrl)
  } catch {
    return inactive
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return inactive
  }
  // Uses the target's syntax, since comparing origins would take `https://x.invalid/docs` for a
  // relative target
  if (
    origin !== undefined &&
    (targetString === undefined || hasOrigin(targetString)) &&
    target.origin !== origin
  ) {
    return inactive
  }

  const targetPathname = trim(normalizePercentEncoding(target.pathname), '/')
  currentPathname = trim(normalizePercentEncoding(currentPathname), '/')
  const isActive = targetPathname === currentPathname
  return {
    isActive,
    isChildActive: !isActive && currentPathname.startsWith(`${targetPathname}/`),
  }
}

/**
 * `undefined` when missing or the opaque origin `'null'` of a sandboxed iframe or a `file:` page
 */
function getCurrentOrigin(currentOrigin: string | null | undefined): string | undefined {
  if (currentOrigin == null || currentOrigin === 'null') {
    return undefined
  }
  const origin = typeof currentOrigin === 'string' ? getOrigin(currentOrigin) : undefined
  if (origin === undefined) {
    throw new TypeError(
      stdMessage(
        ['`getLinkActiveState`', '`current.origin`'],
        `expected a url with an origin or \`"null"\`, received ${describeValue(currentOrigin)}`,
      ),
    )
  }
  return origin
}

/**
 * A url's origin, or `undefined` when it isn't a url or has an opaque origin, such as `mailto:`
 */
function getOrigin(url: string): string | undefined {
  const origin = URL.parse(url)?.origin
  return origin === 'null' ? undefined : origin
}

/**
 * Whether a preprocessed url string has a scheme or is protocol-relative. `http:docs` counts, though
 * it can resolve to the page's origin
 */
function hasOrigin(url: string): boolean {
  return SCHEME_REGEX.test(url) || PROTOCOL_RELATIVE_REGEX.test(url)
}

/**
 * Characters that can make an extension display or be read as another one: controls, format
 * characters such as bidi overrides, whitespace, which Windows strips from a name's end, and
 * combining marks
 */
const DECEPTIVE_CHAR_REGEX = /[\p{Cc}\p{Cf}\p{M}\s]/u
const CONTROL_OR_FORMAT_CHAR_REGEX = /[\p{Cc}\p{Cf}]/u
const NAME_ENDING_CHAR_REGEX = /[#:;?]/u

/**
 * Get the extension of a url's last path segment, without the `.`, or `''` if it has none. The
 * query string and hash are ignored, and a dotfile like `.gitignore` has none. The segment is
 * percent-decoded first, so `a.caf%C3%A9` gives `'café'`.
 *
 * It gives `''` for an invalid url or percent-encoding, a segment with a control or format
 * character, `;`, `:`, `?` or `#` anywhere, which a file system or server can end the name at, as in
 * `shell.php%00.png` or `a.php;.png`, or whitespace or combining marks in the extension. Since some
 * stacks decode twice, it also checks the segment decoded again for those characters, encoded
 * separators and IIS `%uXXXX` escapes, as in `a.php%252F.png`.
 *
 * The extension keeps its case. Compare it lowercased against the extensions you allow, not against
 * the ones you deny.
 *
 * @example
 * ```ts
 * import { getUrlExtension } from '@gpahal/std/urls'
 *
 * getUrlExtension('https://example.com/a.png?v=1') // 'png'
 * getUrlExtension('/images/a.webp#top') // 'webp'
 * ```
 *
 * @throws TypeError if `url` isn't a string or a `URL`.
 */
export function getUrlExtension(url: Url): string {
  const pathname = URL.parse(getUrlString('`getUrlExtension`', '`url`', url), BASE_URL)?.pathname
  // An invalid url or an opaque path, like `mailto:a@b.com`'s, has no segments
  if (pathname?.startsWith('/') !== true) {
    return ''
  }
  let segment: string
  try {
    segment = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1))
  } catch {
    return ''
  }
  // These count anywhere in the segment. Whitespace and combining marks count only in the
  // extension, since `my report.pdf` is a PDF
  if (
    hasNameEndingChar(segment) ||
    hasNameEndingChar(decodeBytes(segment)) ||
    ENCODED_SEPARATOR_REGEX.test(segment) ||
    UNICODE_ESCAPE_REGEX.test(segment)
  ) {
    return ''
  }
  // An encoded separator separates like a decoded one
  const extension = getPathExtension(segment)
  return DECEPTIVE_CHAR_REGEX.test(extension) ? '' : extension
}

/**
 * Whether a decoded segment has a character that can end or disguise the name before its
 * extension: a NUL, which a file system cuts at, a bidi override, a `;`, which IIS 6 and servlet
 * path parameters end at, a `:`, which starts an NTFS alternate data stream, or a `?` or `#`, which
 * end the path for a proxy that decodes and parses it again
 */
function hasNameEndingChar(segment: string): boolean {
  return CONTROL_OR_FORMAT_CHAR_REGEX.test(segment) || NAME_ENDING_CHAR_REGEX.test(segment)
}

/**
 * Get the extension of a file path's basename, without the `.`, or `''` if it has none. Both `/`
 * and `\` separate segments, `?` and `#` are part of the name, and a dotfile like `.gitignore` has
 * no extension
 *
 * @example
 * ```ts
 * import { getPathExtension } from '@gpahal/std/urls'
 *
 * getPathExtension('a/b/c.tar.gz') // 'gz'
 * getPathExtension(String.raw`C:\a\b.txt`) // 'txt'
 * ```
 */
export function getPathExtension(path: string): string {
  const basename = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const pos = basename.lastIndexOf('.')
  return pos < 1 ? '' : basename.slice(pos + 1)
}
