import * as z from 'zod/mini'

import { listOption } from '@gpahal/internal/node/options'
import type { ListOption } from '@gpahal/internal/node/options'
import { expectedError } from '@gpahal/internal/node/zod'

export const GLOBS: z.ZodMiniType<Array<string>, Array<string>> = z.array(z.string(), {
  error: expectedError('an array of globs'),
})

/**
 * A list option of globs: an array that replaces the defaults, or a function of them
 */
export const GLOB_LIST: z.ZodMiniType<ListOption, ListOption> = listOption(z.string(), 'globs')
