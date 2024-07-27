import { getFontFallbackCssString, getFontFallbacksCssProperties, getFontFamilyMetrics } from '../src'

const FONT_FAMILY = 'Figtree'
const FALLBACK_FONT_FAMILIES = [
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  'Noto Sans',
]

test('font-fallback', async () => {
  const fontMetrics = await getFontFamilyMetrics(FONT_FAMILY)
  expect(fontMetrics == null).toBe(false)

  const fallbacks = await getFontFallbacksCssProperties(fontMetrics!, FALLBACK_FONT_FAMILIES)
  expect(fallbacks == null).toBe(false)

  console.info(`Fallback fonts:\n\n${fallbacks.map(getFontFallbackCssString).join('\n')}`)

  expect(fallbacks.length).toBe(FALLBACK_FONT_FAMILIES.length)
})
