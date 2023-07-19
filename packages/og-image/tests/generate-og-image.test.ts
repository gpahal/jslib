import { readFile } from 'node:fs/promises'

import { FONT_PROPERTIES, type FontPropertiesWithLocation } from '@gpahal/font'
import { getInterFontFamily, getInterFontInfoList } from '@gpahal/font-data-inter/font-info'
import { getSourceCodeProFontFamily, getSourceCodeProFontInfoList } from '@gpahal/font-data-source-code-pro/font-info'

import { generateOgImage, html } from '@/index'

function getImportPath(importPath: string): string {
  try {
    return require.resolve(importPath)
  } catch {
    return ''
  }
}

const INTER_FONT_PROPERTIES_WITH_URL = FONT_PROPERTIES.map((properties) => {
  return {
    ...FONT_PROPERTIES,
    location: getImportPath(`@gpahal/font-data-inter/files/${properties.weight}-${properties.style}.woff`),
  } as unknown as FontPropertiesWithLocation
}).filter((properties) => !!properties.location)

const SOURCE_CODE_PROP_FONT_PROPERTIES_WITH_URL = FONT_PROPERTIES.map((properties) => {
  return {
    ...FONT_PROPERTIES,
    location: getImportPath(`@gpahal/font-data-source-code-pro/files/${properties.weight}-${properties.style}.woff`),
  } as unknown as FontPropertiesWithLocation
}).filter((properties) => !!properties.location)

test('generate-og-image', async () => {
  const code = `
    function sum(a, b) {
      return a + b;
    }

    const a = 5;
    const b = 10;
    const sum = a + b;
  `
  const svg = await generateOgImage(
    html` <div
      style="${`width: 100%; display: flex; flex-direction: column; align-items: center; justify-items: center; background-color: #FFFFFF; color: #000000;`}"
    >
      <h1 style="${`font-family: ${getInterFontFamily()}; font-size: 24px; line-height: 32px; font-weight: 800;`}">
        Heading
      </h1>
      <p
        style="${`font-family: ${getInterFontFamily()}; font-size: 18px; line-height: 26px; font-weight: 600; margin-top: 8px; color: #636363;`}"
      >
        A very long description
      </p>
      <pre
        style="${`font-family: ${getSourceCodeProFontFamily()}; font-size: 16px; line-height: 24px; font-weight: 400; margin-top: 12px;`}"
      >
        <code>${code}</code>
      </pre
      >
    </div>`,
    {
      fonts: [
        ...(await getInterFontInfoList(INTER_FONT_PROPERTIES_WITH_URL, readFile)),
        ...(await getSourceCodeProFontInfoList(SOURCE_CODE_PROP_FONT_PROPERTIES_WITH_URL, readFile)),
      ],
    },
  )

  expect(svg).toBeTruthy()
})
