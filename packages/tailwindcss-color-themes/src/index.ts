import { withOptions } from 'tailwindcss/plugin'
import type { CSSRuleObject, PluginAPI } from 'tailwindcss/types/config'

import { isString, kebabCase } from '@gpahal/std/string'

type ColorTheme = {
  [key: string | number]: string | ColorTheme
}

export type ColorThemeSelection = {
  mediaQuery?: string
  selector: string
  theme: ColorTheme
}

export type ColorThemeConfig = {
  default: ColorTheme
  defaultDark?: ColorTheme
  selections?: Array<ColorThemeSelection>
}

function transformKeyPathToVarName(keyPath: Array<string>): string {
  return `${keyPath
    .filter((p) => p && p.length > 0)
    .map(kebabCase)
    .join('-')}`
}

function transformKeyPathToVarNameAccess(keyPath: Array<string>): string {
  return `--${transformKeyPathToVarName(keyPath)}`
}

function transformValueToVarUse(prefix: string, keyPath: Array<string>): string {
  return `var(${transformKeyPathToVarNameAccess(prefix ? [prefix, ...keyPath] : keyPath)})`
}

function themeColorsToVarThemeHelper(prefix: string, keyPath: Array<string>, theme: ColorTheme, acc: ColorTheme) {
  for (const [key, value] of Object.entries(theme)) {
    const newKeyPath = key ? [...keyPath, key] : keyPath
    if (typeof value === 'object') {
      themeColorsToVarThemeHelper(prefix, newKeyPath, value, acc)
    } else {
      acc[transformKeyPathToVarName(newKeyPath)] = transformValueToVarUse(prefix, newKeyPath)
    }
  }
}

function themeColorsToVarThemeColors(prefix: string, theme: ColorTheme): ColorTheme {
  const acc = {}
  themeColorsToVarThemeHelper(prefix, [], theme, acc)
  return acc
}

function themeColorsToVarsHelper(keyPath: Array<string>, theme: ColorTheme, acc: ColorTheme) {
  for (const [key, value] of Object.entries(theme)) {
    const newKeyPath = [...keyPath, key]
    if (typeof value === 'object') {
      themeColorsToVarsHelper(newKeyPath, value, acc)
    } else {
      acc[transformKeyPathToVarNameAccess(newKeyPath)] = value
    }
  }
}

function themeColorsToVars(prefix: string, theme: ColorTheme): ColorTheme {
  const acc = {}
  themeColorsToVarsHelper(prefix ? [prefix] : [], theme, acc)
  return acc
}

function addThemeColorsUtilitiesHelper(
  addUtilities: PluginAPI['addUtilities'],
  theme: ColorTheme,
  selector: string,
  mediaQueries?: Array<string>,
) {
  const selectorValues = themeColorsToVars('colors', theme)
  const cssObject = {
    [selector]: selectorValues,
  }
  if (mediaQueries && mediaQueries.length > 0) {
    let finalCssObject = { [mediaQueries.at(-1)!]: cssObject } as CSSRuleObject
    for (let i = mediaQueries.length - 2; i >= 0; i--) {
      const mediaQuery = mediaQueries[i]!
      finalCssObject = { [mediaQuery]: finalCssObject }
    }

    addUtilities(finalCssObject)
  } else {
    addUtilities(cssObject)
  }
}

const P3_MEDIA_QUERIES = ['@supports (color: color(display-p3 1 1 1))', '@media (color-gamut: p3)']

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

function addThemeColorsUtilities(
  addUtilities: PluginAPI['addUtilities'],
  theme: ColorTheme,
  selector: string,
  mediaQueries?: Array<string>,
) {
  const withoutP3Theme = getWithoutP3Theme(theme)
  addThemeColorsUtilitiesHelper(addUtilities, withoutP3Theme, selector, mediaQueries)

  const p3Theme = getP3Theme(theme)
  addThemeColorsUtilitiesHelper(
    addUtilities,
    p3Theme,
    selector,
    mediaQueries ? [...mediaQueries, ...P3_MEDIA_QUERIES] : P3_MEDIA_QUERIES,
  )
}

export const colorThemesPlugin = withOptions(
  (options: ColorThemeConfig) => {
    if (!options) {
      throw new Error('No options provided to @gpahal/tailwindcss-color-themes plugin')
    }

    return ({ addUtilities }) => {
      addThemeColorsUtilities(addUtilities, options.default, ':root')
      if (options.defaultDark) {
        addThemeColorsUtilities(addUtilities, options.defaultDark, ':root', ['@media (prefers-color-scheme: dark)'])
      }

      for (const selection of options.selections || []) {
        addThemeColorsUtilities(
          addUtilities,
          selection.theme,
          selection.selector,
          selection.mediaQuery ? [selection.mediaQuery] : undefined,
        )
      }
    }
  },
  (options: ColorThemeConfig) => {
    if (!options) {
      throw new Error('No options provided to @gpahal/tailwindcss-color-themes plugin')
    }

    return {
      theme: {
        extend: {
          colors: themeColorsToVarThemeColors('colors', options.default),
        },
      },
    }
  },
)
