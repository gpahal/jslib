export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
export type FontStyle = 'normal' | 'italic'
export type FontProperties = {
  weight: FontWeight
  style: FontStyle
}
export type FontPropertiesWithLocation = FontProperties & {
  location: string
}

export const FONT_WEIGHTS: Array<FontWeight> = [100, 200, 300, 400, 500, 600, 700, 800, 900]
export const FONT_STYLES: Array<FontStyle> = ['normal', 'italic']
export const FONT_PROPERTIES: Array<FontProperties> = FONT_WEIGHTS.flatMap((weight) =>
  FONT_STYLES.map((style) => ({ weight, style })),
)

export type FontData = Buffer | ArrayBuffer
export type FontInfo = {
  name: string
  data: FontData | Promise<FontData> | (() => FontData | Promise<FontData>)
} & Partial<FontProperties>
