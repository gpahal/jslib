import { fileURLToPath } from "node:url";

import { fromFile, fromUrl } from "@capsizecss/unpack";
import { camelCase, trimEnd, trimStart } from "@gpahal/std/string";

import type { Font } from "@capsizecss/unpack";

const metricsCache = new Map<string, Font | null>();

export async function getFontFamilyMetrics(fontFamily: string): Promise<Font | null> {
  fontFamily = normalizeFontFamily(fontFamily);
  if (metricsCache.has(fontFamily)) {
    return metricsCache.get(fontFamily) || null;
  }

  try {
    const metrics: Font = await import(`@capsizecss/metrics/${fontFamily}.js`).then(
      (r) => r.default || r,
    );
    metricsCache.set(fontFamily, metrics);
    return metrics;
  } catch (e) {
    metricsCache.set(fontFamily, null);
    return null;
  }
}

function normalizeFontFamily(fontFamily: string): string {
  return camelCase(
    trimEnd(trimStart(fontFamily, '"'), '"')
      .split(/[\s|-]/)
      .filter(Boolean)
      .join(" "),
  );
}

export async function getFontUrlMetrics(url: URL): Promise<Font | null> {
  const href = url.href;
  if (href in metricsCache) {
    return metricsCache.get(href) || null;
  }

  if (!url.protocol) {
    metricsCache.set(href, null);
    return null;
  }

  const metrics =
    url.protocol === "file:" ? await fromFile(fileURLToPath(url)) : await fromUrl(href);
  metricsCache.set(href, metrics);
  return metrics;
}

export type FontFallbackCssProperties = {
  familyName: string;
  originalFamilyName: string;
  fallbackFamilyName: string;
  sizeAdjust: number;
  ascentOverride: number;
  descentOverride: number;
  lineGapOverride: number;
};

export function getFontFallbackCssString(fallbackCssProperties: FontFallbackCssProperties): string {
  return `/* fallback ${fallbackCssProperties.fallbackFamilyName} */
@font-face {
  font-family: ${familyNameToString(fallbackCssProperties.familyName)};
  src: local(${familyNameToString(fallbackCssProperties.fallbackFamilyName)});
  size-adjust: ${toPercentage(fallbackCssProperties.sizeAdjust)};
  ascent-override: ${toPercentage(fallbackCssProperties.ascentOverride)};
  descent-override: ${toPercentage(fallbackCssProperties.descentOverride)};
  line-gap-override: ${toPercentage(fallbackCssProperties.lineGapOverride)};
}`;
}

export async function getFontFallbacksCssProperties(
  originalMetrics: Font,
  fallbackFontFamilies: string[],
): Promise<FontFallbackCssProperties[]> {
  const fallbacksProperties = await Promise.all(
    fallbackFontFamilies.map(async (fallbackFontFamily) =>
      getFontFallbackCssProperties(originalMetrics, fallbackFontFamily),
    ),
  );
  const array: FontFallbackCssProperties[] = [];
  for (const fallbackProperties of fallbacksProperties) {
    if (fallbackProperties) {
      array.push(fallbackProperties);
    }
  }
  return array;
}

async function getFontFallbackCssProperties(
  originalFontMetrics: Font,
  fallbackFontFamily: string,
): Promise<FontFallbackCssProperties | null> {
  const fallbackFontMetrics = await getFontFamilyMetrics(fallbackFontFamily);
  if (!fallbackFontMetrics) {
    return null;
  }

  const sizeAdjust =
    (originalFontMetrics.xWidthAvg * fallbackFontMetrics.unitsPerEm) /
    (fallbackFontMetrics.xWidthAvg * originalFontMetrics.unitsPerEm);
  const unitsPerEm = originalFontMetrics.unitsPerEm * sizeAdjust;
  return {
    familyName: `${originalFontMetrics.familyName} fallback ${fallbackFontMetrics.familyName}`,
    originalFamilyName: originalFontMetrics.familyName,
    fallbackFamilyName: fallbackFontMetrics.familyName,
    sizeAdjust,
    ascentOverride: originalFontMetrics.ascent / unitsPerEm,
    descentOverride: originalFontMetrics.descent / unitsPerEm,
    lineGapOverride: originalFontMetrics.lineGap / unitsPerEm,
  };
}

const FAMILY_NAME_KEYWORDS = [
  "inherit",
  "serif",
  "sans-serif",
  "cursive",
  "fantasy",
  "system-ui",
  "monospace",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
];

function familyNameToString(familyName: string): string {
  return FAMILY_NAME_KEYWORDS.includes(familyName) ? familyName : `"${familyName}"`;
}

function toPercentage(value: number, fractionDigits = 6): string {
  const percentage = value * 100;
  return `${percentage % 1 ? percentage.toFixed(fractionDigits).replace(/0+$/, "") : percentage}%`;
}
