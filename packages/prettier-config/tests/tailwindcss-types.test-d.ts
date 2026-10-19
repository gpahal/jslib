// Compiled by the package's `typecheck`, not run: the Tailwind CSS options of `Config` match the
// ones prettier-plugin-tailwindcss declares, which the config can't import from an optional peer
// dependency

import type { PluginOptions } from 'prettier-plugin-tailwindcss'

import type { TailwindcssPluginOptions } from '@/index'

/**
 * `T` with `undefined` taken out of its properties, which the local types add for
 * `exactOptionalPropertyTypes`
 */
type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> }

type IsEquivalent<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

export const isEquivalent: IsEquivalent<Defined<TailwindcssPluginOptions>, PluginOptions> = true
export const hasSameKeys: IsEquivalent<keyof TailwindcssPluginOptions, keyof PluginOptions> = true
