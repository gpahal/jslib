/**
 * Loading the Tailwind CSS installed next to a `theme.css`, for the `--tw-*` property names of
 * `tailwindcss.entryPoint` and the design system of `tailwindcss.validateApply`
 */

import { createRequire } from 'node:module'
import path from 'node:path'

import { resolveFromNodeModules } from '@gpahal/internal/node/resolve'
import { formatNames, getErrorReason } from '@gpahal/std/errors'

import { PREFIX } from '@/internal/options'

/**
 * Tailwind's `compile()`, as much of it as the package uses
 */
export type TailwindCompile = (
  css: string,
  options: {
    base: string
    loadStylesheet: (
      id: string,
      base: string,
    ) => Promise<{ path: string; base: string; content: string }>
    loadModule?: (
      id: string,
      base: string,
      resourceHint: 'plugin' | 'config',
    ) => Promise<{ path: string; base: string; module: unknown }>
  },
) => Promise<{ build: (candidates: Array<string>) => string }>

/**
 * The path of the `tailwindcss` module installed at the folder of `theme`, its `theme.css`. `fail`
 * throws the caller's error with a description and a cause
 */
export function tailwindModulePath(
  theme: string,
  fail: (description: string, cause?: unknown) => never,
): string {
  let modulePath: string | undefined
  try {
    modulePath = resolveFromNodeModules('tailwindcss', theme, { prefix: PREFIX })?.path
  } catch (error) {
    return fail(`loading Tailwind CSS failed: ${getErrorReason(error)}`, error)
  }
  return (
    modulePath ??
    fail(
      `Tailwind CSS isn't installed at ${formatNames([path.dirname(theme)])}. Install Tailwind CSS v4.3 or later`,
    )
  )
}

/**
 * The `compile()` of the Tailwind module at `modulePath`. `fail` throws the caller's error with a
 * description
 */
export function tailwindCompileOf(
  modulePath: string,
  fail: (description: string) => never,
): TailwindCompile {
  // `require`, since Node finds no named exports in Tailwind's CommonJS build through `import`,
  // and `require` of an ES module works too
  const tailwind: unknown = createRequire(modulePath)(modulePath)
  // Tailwind's CommonJS exports are a function with the exports as its properties
  const compile: unknown =
    typeof tailwind === 'function' || (typeof tailwind === 'object' && tailwind !== null)
      ? Reflect.get(tailwind, 'compile')
      : undefined
  if (typeof compile !== 'function') {
    return fail(
      `${formatNames([modulePath])} has no \`compile()\`. Install Tailwind CSS v4.3 or later`,
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Tailwind's `compile`, whose types the package doesn't import
  return compile as TailwindCompile
}

/**
 * The path of Tailwind's own stylesheet `id`, `tailwindcss` for its `index.css` or
 * `tailwindcss/<name>`, in its package folder `packageDir`, or `undefined` for another `id`
 */
export function tailwindStylesheetPath(id: string, packageDir: string): string | undefined {
  if (id === 'tailwindcss') {
    return path.join(packageDir, 'index.css')
  }
  if (!id.startsWith('tailwindcss/')) {
    return undefined
  }
  const name = id.slice('tailwindcss/'.length)
  return path.join(packageDir, name.endsWith('.css') ? name : `${name}.css`)
}
