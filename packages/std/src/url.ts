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

function getPathname(url: Url): string {
  if (isString(url)) {
    if (isAbsoluteUrl(url)) {
      const urlObject = new URL(url)
      return urlObject.pathname
    } else {
      return new URL(url, 'http://test.com').pathname
    }
  } else {
    return url.pathname
  }
}

export function isPathnameActive(
  currentPathname: string,
  targetUrl: Url,
): { isActive: boolean; isExactMatch: boolean } {
  let targetPathname = ''
  try {
    targetPathname = getPathname(targetUrl)
  } catch {
    return { isActive: false, isExactMatch: false }
  }

  targetPathname = trim(targetPathname, '/')
  currentPathname = trim(currentPathname, '/')
  const isExactMatch = targetPathname === currentPathname
  return {
    isActive: isExactMatch || currentPathname.startsWith(targetPathname + '/'),
    isExactMatch,
  }
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
