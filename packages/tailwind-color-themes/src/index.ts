import { kebabCase } from "@gpahal/std/string";
import { withOptions } from "tailwindcss/plugin";

import type { PluginAPI } from "tailwindcss/types/config";

export type ColorTheme = { [key: string]: string | ColorTheme };

export type ColorThemeSelection = {
  mediaQuery?: string;
  selector: string;
  theme: ColorTheme;
};

export type ColorThemeConfig = {
  default: ColorTheme;
  defaultDark?: ColorTheme;
  themes?: ColorThemeSelection[];
};

function transformKeyPathToVarName(keyPath: string[]): string {
  return `${keyPath
    .filter((p) => p && p.length > 0)
    .map(kebabCase)
    .join("-")}`;
}

function transformKeyPathToVarNameAccess(keyPath: string[]): string {
  return `--${transformKeyPathToVarName(keyPath)}`;
}

function themeColorsToVarsHelper(keyPath: string[], colorTheme: ColorTheme, acc: ColorTheme) {
  Object.entries(colorTheme).forEach(([key, value]) => {
    const newKeyPath = [...keyPath, key];
    if (typeof value === "object") {
      themeColorsToVarsHelper(newKeyPath, value, acc);
    } else {
      acc[transformKeyPathToVarNameAccess(newKeyPath)] = value;
    }
  });
}

function themeColorsToVars(prefix: string, colorTheme: ColorTheme): ColorTheme {
  const acc = {};
  themeColorsToVarsHelper(prefix ? [prefix] : [], colorTheme, acc);
  return acc;
}

function transformValueToVarUse(prefix: string, keyPath: string[]): string {
  return `var(${transformKeyPathToVarNameAccess(prefix ? [prefix, ...keyPath] : keyPath)})`;
}

function themeColorsToVarThemeHelper(
  prefix: string,
  keyPath: string[],
  colorTheme: ColorTheme,
  acc: ColorTheme,
) {
  Object.entries(colorTheme).forEach(([key, value]) => {
    const newKeyPath = key ? [...keyPath, key] : keyPath;
    if (typeof value === "object") {
      themeColorsToVarThemeHelper(prefix, newKeyPath, value, acc);
    } else {
      acc[transformKeyPathToVarName(newKeyPath)] = transformValueToVarUse(prefix, newKeyPath);
    }
  });
}

function themeColorsToVarThemeColors(prefix: string, colorTheme: ColorTheme): ColorTheme {
  const acc = {};
  themeColorsToVarThemeHelper(prefix, [], colorTheme, acc);
  return acc;
}

function addThemeColorsUtilities(
  addUtilities: PluginAPI["addUtilities"],
  selection: ColorThemeSelection,
) {
  const selectorValues = themeColorsToVars("colors", selection.theme);
  const cssObject = {
    [selection.selector]: selectorValues,
  };
  if (selection.mediaQuery) {
    addUtilities({
      [selection.mediaQuery]: cssObject,
    });
  } else {
    addUtilities(cssObject);
  }
}

export default withOptions(
  (options: ColorThemeConfig) => {
    if (!options) {
      throw new Error("No options provided to @gpahal/tailwind-color-themes plugin");
    }

    return ({ addUtilities }) => {
      addThemeColorsUtilities(addUtilities, { selector: ":root", theme: options.default });
      if (options.defaultDark) {
        addThemeColorsUtilities(addUtilities, {
          mediaQuery: "@media (prefers-color-scheme: dark)",
          selector: ":root",
          theme: options.defaultDark,
        });
      }
      if (options.themes) {
        for (const selection of options.themes) {
          addThemeColorsUtilities(addUtilities, selection);
        }
      }
    };
  },
  (options: ColorThemeConfig) => {
    if (!options) {
      throw new Error("No options provided to @gpahal/tailwind-color-themes plugin");
    }

    return {
      theme: {
        extend: {
          colors: themeColorsToVarThemeColors("colors", options.default),
        },
      },
    };
  },
);
