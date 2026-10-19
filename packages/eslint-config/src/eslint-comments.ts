/**
 * The eslint-comments plugin the `eslintComments` area registers, with `require-description`
 * reporting at each language's own columns, for a config that doesn't come from `defineConfig`
 */

import type { ESLint } from 'eslint'

import { ESLINT_COMMENTS_PLUGIN } from '@/internal/configs/eslint-comments'

export const eslintCommentsPlugin: ESLint.Plugin = ESLINT_COMMENTS_PLUGIN
