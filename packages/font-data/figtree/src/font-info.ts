import type { FontInfo, FontPropertiesWithLocation } from '@gpahal/font'

export function getFontFamily(): string {
  return 'Figtree'
}

export function getFallbackFontFamilies(): string[] {
  return [
    '"Figtree fallback -apple-system"',
    '"Figtree fallback BlinkMacSystemFont"',
    '"Figtree fallback Segoe UI"',
    '"Figtree fallback Roboto"',
    '"Figtree fallback Helvetica Neue"',
    '"Figtree fallback Arial"',
  ]
}

export async function getFontInfoList(
  propertiesList: FontPropertiesWithLocation[],
  fetchFontData: (location: string) => FontInfo['data'],
): Promise<FontInfo[]> {
  const seen = new Set<string>()
  const infos: FontInfo[] = []
  for (const properties of propertiesList) {
    const key = `${properties.weight}-${properties.style}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    infos.push({
      name: 'Figtree',
      data: fetchFontData(properties.location),
      ...properties,
    })
  }

  return infos
}
