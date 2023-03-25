import {
  getFontFallbacksCssProperties,
  getFontFallbackCssString,
  getFontFamilyMetrics,
} from "../src";

import type { Font } from "@capsizecss/unpack";

const FONT_FAMILY = "Inter";
const FALLBACK_FONT_FAMILIES = [
  "-apple-system",
  "BlinkMacSystemFont",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
  "Noto Sans",
];

test("font-fallback", async () => {
  const fontMetrics = (await getFontFamilyMetrics(FONT_FAMILY)) as Font;
  expect(fontMetrics).not.toBeNull();

  const fallbacks = await getFontFallbacksCssProperties(fontMetrics, FALLBACK_FONT_FAMILIES);
  expect(fallbacks).not.toBeNull();

  console.info(`Fallback fonts:\n\n${fallbacks.map(getFontFallbackCssString).join("\n")}`);

  expect(fallbacks.length).toBe(FALLBACK_FONT_FAMILIES.length);
});
