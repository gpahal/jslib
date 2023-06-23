import { trim } from '~/string'

export function isUrl(endpoint: string): boolean {
  try {
    new URL(endpoint)
    return true
  } catch {
    return false
  }
}

/**
 * Handles:
 * - //
 * - http://
 * - https://
 * - ftp://
 * - ... and other possible protocols
 */
const ABSOLUTE_PATH_REGEX = /^(?:[a-zA-Z]+:)?\/\//

export function isAbsoluteUrl(urlString: string): boolean {
  return !!ABSOLUTE_PATH_REGEX.exec(urlString)
}

export function getAbsoluteUrl(currentUrl: URL, urlString: string): URL {
  if (isAbsoluteUrl(urlString)) {
    return new URL(urlString)
  }
  if (!urlString.startsWith('/')) {
    urlString = `/${urlString}`
  }
  return new URL(`${currentUrl.origin}${urlString}`)
}

export function isHrefActive(currentUrl: URL, href?: string) {
  const currentPathname = trim(currentUrl.pathname, '/')
  const hrefPathname = trim(getAbsoluteUrl(currentUrl, href || '').pathname, '/')
  return hrefPathname ? currentPathname.startsWith(hrefPathname) : currentPathname === hrefPathname
}

export function removeQueryString(urlString: string) {
  const index = urlString.lastIndexOf('?')
  return index > 0 ? urlString.substring(0, index) : urlString
}

export function getExtension(urlStringOrFilePath: string): string {
  const basename = urlStringOrFilePath.split(/[\\/]/).pop()
  if (!basename) {
    return ''
  }

  const pos = basename.lastIndexOf('.')
  if (pos < 1) {
    return ''
  }

  return basename.slice(pos + 1)
}
