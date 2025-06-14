import { fileURLToPath } from 'node:url'

import { fromFile, fromUrl, type Font } from '@capsizecss/unpack'

import { camelCase, trim } from '@gpahal/std/strings'

const metricsCache = new Map<string, Font | null>()

export async function getFontFamilyMetrics(fontFamily: string): Promise<Font | undefined> {
  fontFamily = normalizeFontFamily(fontFamily)
  if (metricsCache.has(fontFamily)) {
    return metricsCache.get(fontFamily) || undefined
  }

  try {
    const metrics: Font = await import(`@capsizecss/metrics/${fontFamily}`).then(
      (r) => (r as { default: Font }).default || (r as Font),
    )
    metricsCache.set(fontFamily, metrics)
    return metrics
  } catch {
    metricsCache.set(fontFamily, null)
    return undefined
  }
}

function normalizeFontFamily(fontFamily: string): string {
  return camelCase(
    trim(trim(fontFamily, '"'), "'")
      .split(/[\s|-]/)
      .filter(Boolean)
      .join(' '),
  )
}

export async function getFontUrlMetrics(url: URL): Promise<Font | undefined> {
  const href = url.href
  if (href in metricsCache) {
    return metricsCache.get(href) || undefined
  }

  if (!url.protocol) {
    metricsCache.set(href, null)
    return undefined
  }

  const metrics =
    url.protocol === 'file:' ? await fromFile(fileURLToPath(url)) : await fromUrl(href)
  metricsCache.set(href, metrics)
  return metrics
}

export type FontFallbackCssProperties = {
  familyName: string
  originalFamilyName: string
  fallbackFamilyName: string
  sizeAdjust: number
  ascentOverride: number
  descentOverride: number
  lineGapOverride: number
}

export function getFontFallbackCssString(fallbackCssProperties: FontFallbackCssProperties): string {
  return `/* fallback ${fallbackCssProperties.fallbackFamilyName} */
@font-face {
  font-family: ${familyNameToString(fallbackCssProperties.familyName)};
  src: local(${familyNameToString(fallbackCssProperties.fallbackFamilyName)});
  size-adjust: ${toPercentage(fallbackCssProperties.sizeAdjust)};
  ascent-override: ${toPercentage(fallbackCssProperties.ascentOverride)};
  descent-override: ${toPercentage(fallbackCssProperties.descentOverride)};
  line-gap-override: ${toPercentage(fallbackCssProperties.lineGapOverride)};
}`
}

export async function getFontFallbacksCssProperties(
  originalMetrics: Font,
  fallbackFontFamilies: Array<string>,
): Promise<Array<FontFallbackCssProperties>> {
  const fallbacksProperties = await Promise.all(
    fallbackFontFamilies.map(async (fallbackFontFamily) =>
      getFontFallbackCssProperties(originalMetrics, fallbackFontFamily),
    ),
  )
  const array: Array<FontFallbackCssProperties> = []
  for (const fallbackProperties of fallbacksProperties) {
    if (fallbackProperties) {
      array.push(fallbackProperties)
    }
  }
  return array
}

async function getFontFallbackCssProperties(
  originalFontMetrics: Font,
  fallbackFontFamily: string,
): Promise<FontFallbackCssProperties | undefined> {
  const fallbackFontMetrics = await getFontFamilyMetrics(fallbackFontFamily)
  if (!fallbackFontMetrics) {
    return undefined
  }

  // Credits to: https://github.com/seek-oss/capsize/blob/master/packages/core/src/createFontStack.ts

  // Calculate size adjust
  const preferredFontXAvgRatio = originalFontMetrics.xWidthAvg / originalFontMetrics.unitsPerEm
  const fallbackFontXAvgRatio = fallbackFontMetrics.xWidthAvg / fallbackFontMetrics.unitsPerEm
  const sizeAdjust = preferredFontXAvgRatio / fallbackFontXAvgRatio

  // Calculate metric overrides for preferred font
  const adjustedEmSquare = originalFontMetrics.unitsPerEm * sizeAdjust
  const ascentOverride = originalFontMetrics.ascent / adjustedEmSquare
  const descentOverride = Math.abs(originalFontMetrics.descent) / adjustedEmSquare
  const lineGapOverride = originalFontMetrics.lineGap / adjustedEmSquare

  return {
    familyName: `${originalFontMetrics.familyName} fallback ${fallbackFontMetrics.familyName}`,
    originalFamilyName: originalFontMetrics.familyName,
    fallbackFamilyName: fallbackFontMetrics.familyName,
    sizeAdjust,
    ascentOverride,
    descentOverride,
    lineGapOverride,
  }
}

const FAMILY_NAME_KEYWORDS = new Set([
  'inherit',
  'serif',
  'sans-serif',
  'cursive',
  'fantasy',
  'system-ui',
  'monospace',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
])

function familyNameToString(familyName: string): string {
  return FAMILY_NAME_KEYWORDS.has(familyName) ? familyName : `'${familyName}'`
}

function toPercentage(value: number, fractionDigits = 6): string {
  const percentage = value * 100
  return `${percentage % 1 ? percentage.toFixed(fractionDigits).replace(/0+$/, '') : percentage}%`
}
