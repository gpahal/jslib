import { isString, trim } from '~/string'

export function isUrl(urlString: string): boolean {
  try {
    new URL(urlString)
    return true
  } catch {
    return false
  }
}

export type Url = string | URL

export function getUrlString(url: Url): string {
  return isString(url) ? url : url.href
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

export function isAbsoluteUrl(url: Url): boolean {
  const urlString = getUrlString(url)
  return !!ABSOLUTE_PATH_REGEX.exec(urlString) && isUrl(urlString)
}

export function isPathnameActive(url: Url, currentPathname: string): { isActive: boolean; isExactMatch: boolean } {
  let pathname = ''
  if (isString(url)) {
    if (isAbsoluteUrl(url)) {
      try {
        const urlObject = new URL(url)
        pathname = urlObject.pathname
      } catch {
        return { isActive: false, isExactMatch: false }
      }
    } else {
      pathname = url
    }
  } else {
    pathname = url.pathname
  }

  pathname = trim(pathname, '/')
  currentPathname = trim(pathname, '/')
  const isExactMatch = pathname === currentPathname
  return {
    isActive: isExactMatch || currentPathname.startsWith(pathname + '/'),
    isExactMatch,
  }
}

export function removeQueryString(url: Url): string {
  const urlString = getUrlString(url)
  const index = urlString.lastIndexOf('?')
  return index > 0 ? urlString.substring(0, index) : urlString
}

export function getExtension(urlOrFilePath: Url): string {
  const urlStringOrFilePath = getUrlString(urlOrFilePath)
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
