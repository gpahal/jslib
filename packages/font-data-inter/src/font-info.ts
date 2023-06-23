import { FontInfo, FontPropertiesWithLocation } from '@gpahal/font'

export function getInterFontFamily(): string {
  return 'Inter'
}

export function getInterFallbackFontFamilies(): string[] {
  return [
    '"Inter fallback -apple-system"',
    '"Inter fallback BlinkMacSystemFont"',
    '"Inter fallback Segoe UI"',
    '"Inter fallback Roboto"',
    '"Inter fallback Helvetica Neue"',
    '"Inter fallback Arial"',
  ]
}

export async function getInterFontInfoList(
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
      name: 'Inter',
      data: fetchFontData(properties.location),
      ...properties,
    })
  }

  return infos
}
