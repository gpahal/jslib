/**
 * The eslint-plugin-slop plugin the `antislop` preset registers, with `no-em-dash` reporting at each
 * language's own columns, for a config that doesn't come from `defineConfig`. Needs
 * eslint-plugin-slop
 */

import type { ESLint } from 'eslint'
import eslintPluginSlop from 'eslint-plugin-slop'

import { wrapSlopPlugin } from '@/internal/presets/antislop'

export const slopPlugin: ESLint.Plugin = wrapSlopPlugin(eslintPluginSlop)
