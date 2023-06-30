import { isString, trim } from '~/string'

export function isUrl(urlString: string): boolean {
  try {
    new URL(urlString)
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
  return !!ABSOLUTE_PATH_REGEX.exec(urlString) && isUrl(urlString)
}

export type Href = string | URL

export function isPathnameActive(href: Href, currentPathname: string, exactMatch?: boolean): boolean {
  let pathname = ''
  if (isString(href)) {
    if (isAbsoluteUrl(href)) {
      return false
    } else {
      pathname = href
    }
  } else {
    pathname = href.pathname
  }

  pathname = trim(pathname, '/')
  currentPathname = trim(pathname, '/')
  return currentPathname === pathname ? true : exactMatch ? false : currentPathname.startsWith(pathname + '/')
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
