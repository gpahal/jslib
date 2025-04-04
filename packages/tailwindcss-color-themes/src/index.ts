import { writeFile } from 'node:fs/promises'

import { isString, kebabCase } from '@gpahal/std/strings'

export type ColorTheme = {
  [key: string | number]: string | ColorTheme
}

export type ColorThemeSelection = {
  selector: string
  subSelectors?: Array<string>
  theme: ColorTheme
}

export type ColorThemeConfig = {
  default: ColorTheme
  defaultDark?: ColorTheme
  selections?: Array<ColorThemeSelection>
}

export type CSS = Map<string, string | CSS>

export async function generateCSSFile(config: ColorThemeConfig, filePath: string, indent = 2) {
  const css = generateCSS(config)
  const cssString = `/* Generated by @gpahal/tailwindcss-color-themes. DO NOT EDIT */\n\n@import 'tailwindcss';\n\n${cssToString(css, indent)}\n`
  await writeFile(filePath, cssString)
}

export function generateCSSString(config: ColorThemeConfig, indent = 2): string {
  const css = generateCSS(config)
  return cssToString(css, indent)
}

function cssToString(css: CSS, indent = 2): string {
  const results = cssToStringArrayInternal(css, indent, 0)
  return results.join('\n')
}

function cssToStringArrayInternal(css: CSS, indent: number, currentIndent: number): Array<string> {
  const indentString = ' '.repeat(currentIndent)
  const results: Array<string> = []
  let isFirst = true
  for (const [key, value] of css.entries()) {
    if (isString(value)) {
      results.push(`${indentString}${key}: ${value};`)
    } else {
      if (!isFirst) {
        results.push('')
      }
      const innerResults = cssToStringArrayInternal(value, indent, currentIndent + indent)
      results.push(`${indentString}${key} {`, ...innerResults, `${indentString}}`)
    }
    isFirst = false
  }
  return results
}

const DARK_COLOR_SCHEME_MEDIA_QUERY = '@media (prefers-color-scheme: dark)'

export function generateCSS(config: ColorThemeConfig): CSS {
  const css = themeSelectionToCSS({
    selector: ':root',
    theme: config.default,
  })
  if (config.defaultDark) {
    mergeCSSInPlace(
      css,
      themeSelectionToCSS({
        selector: ':root',
        subSelectors: [DARK_COLOR_SCHEME_MEDIA_QUERY],
        theme: config.defaultDark,
      }),
    )
  }
  if (config.selections && config.selections.length > 0) {
    for (const selection of config.selections) {
      mergeCSSInPlace(css, themeSelectionToCSS(selection))
    }
  }

  const themeCSS = new Map<string, string | CSS>()
  themeCSS.set('--color-*', 'initial')
  for (const [key, value] of themeColorsToWithoutP3CSS(config.default).entries()) {
    themeCSS.set(key, value)
  }
  return new Map<string, string | CSS>([
    ['@theme', themeCSS],
    ['@layer base', css],
  ])
}

function themeSelectionToCSS(selection: ColorThemeSelection): CSS {
  let selectionCSS = themeColorsToCSS(selection.theme)
  if (selection.subSelectors && selection.subSelectors.length > 0) {
    selectionCSS = nestCSS(selectionCSS, selection.subSelectors)
  }
  return nestCSS(selectionCSS, [selection.selector])
}

function themeColorsToCSS(theme: ColorTheme): CSS {
  const css = themeColorsToWithoutP3CSS(theme)
  mergeCSSInPlace(css, themeColorsToP3CSS(theme))
  return css
}

function themeColorsToWithoutP3CSS(theme: ColorTheme): CSS {
  return themeColorsToP3UnawareCSS(getWithoutP3Theme(theme))
}

const P3_MEDIA_QUERIES = ['@supports (color: color(display-p3 1 1 1))', '@media (color-gamut: p3)']

function themeColorsToP3CSS(theme: ColorTheme): CSS {
  return nestCSS(themeColorsToP3UnawareCSS(getP3Theme(theme)), P3_MEDIA_QUERIES)
}

function nestCSS(css: CSS, selectors?: Array<string>): CSS {
  let newCSS = css
  if (selectors && selectors.length > 0) {
    for (let i = selectors.length - 1; i >= 0; i--) {
      const selector = selectors[i]!
      newCSS = new Map<string, string | CSS>([[selector, newCSS]])
    }
  }
  return newCSS
}

function getWithoutP3Theme(theme: ColorTheme): ColorTheme {
  const newTheme: ColorTheme = {}
  for (const [key, value] of Object.entries(theme)) {
    if (key === 'p3') {
      continue
    }

    newTheme[key] = isString(value) ? value : getWithoutP3Theme(value)
  }
  return newTheme
}

function getP3Theme(theme: ColorTheme): ColorTheme {
  const newTheme: ColorTheme = {}
  for (const [key, value] of Object.entries(theme)) {
    if (key === 'p3') {
      for (const [p3Key, p3Value] of Object.entries(value)) {
        newTheme[p3Key] = p3Value
      }
    } else if (!isString(value)) {
      const subTheme = getP3Theme(value)
      if (Object.keys(subTheme).length > 0) {
        newTheme[key] = subTheme
      }
    }
  }
  return newTheme
}

function themeColorsToP3UnawareCSS(theme: ColorTheme): CSS {
  const css: CSS = new Map()
  if (Object.keys(theme).length > 0) {
    themeColorsToCSSHelper(['color'], theme, css)
  }
  return css
}

function themeColorsToCSSHelper(keyPath: Array<string>, theme: ColorTheme, css: CSS) {
  for (const [key, value] of Object.entries(theme)) {
    const newKeyPath = [...keyPath, key]
    if (typeof value === 'object') {
      themeColorsToCSSHelper(newKeyPath, value, css)
    } else {
      css.set(transformKeyPathToVarNameAccess(newKeyPath), value)
    }
  }
}

function transformKeyPathToVarNameAccess(keyPath: Array<string>): string {
  return `--${transformKeyPathToVarName(keyPath)}`
}

function transformKeyPathToVarName(keyPath: Array<string>): string {
  return `${keyPath
    .filter((p) => p && p.length > 0)
    .map(kebabCase)
    .join('-')}`
}

function mergeCSSInPlace(css1: CSS, css2: CSS) {
  for (const [key, value] of css2.entries()) {
    const existingValue = css1.get(key)
    if (existingValue) {
      if (isString(existingValue)) {
        if (!isString(value)) {
          value.set('', existingValue)
        }
        css1.set(key, value)
      } else if (isString(value)) {
        existingValue.set('', value)
      } else {
        mergeCSSInPlace(existingValue, value)
      }
    } else {
      css1.set(key, value)
    }
  }
}
