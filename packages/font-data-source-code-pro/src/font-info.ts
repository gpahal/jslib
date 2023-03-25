import type { FontInfo, FontPropertiesWithLocation } from "@gpahal/font";

export function getSourceCodeProFontFamily(): string {
  return '"Source Code Pro"';
}

export function getSourceCodeProFallbackFontFamilies(): string[] {
  return ['"Source Code Pro fallback Courier New"'];
}

export async function getSourceCodeProFontInfoList(
  propertiesList: FontPropertiesWithLocation[],
  fetchFontData: (location: string) => FontInfo["data"],
): Promise<FontInfo[]> {
  const seen = new Set<string>();
  const infos: FontInfo[] = [];
  for (let properties of propertiesList) {
    if (properties.weight === 100) {
      properties = {
        ...properties,
        weight: 200,
      };
    } else if (properties.weight === 700) {
      properties = {
        ...properties,
        weight: 800,
      };
    }

    const key = `${properties.weight}-${properties.style}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    infos.push({
      name: "Inter",
      data: fetchFontData(properties.location),
      ...properties,
    });
  }

  return infos;
}
