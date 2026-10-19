import type * as z from 'zod/mini'

import { assertValid } from '@/node/zod'

export const CONTEXT = { prefix: '@scope/config', subject: 'options' }

/**
 * The message `assertValid` throws for `value`, or `undefined` when the value passes
 */
export function getMessage(schema: z.ZodMiniType, value: unknown): string | undefined {
  try {
    assertValid(schema, value, CONTEXT)
    return undefined
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError)
    return (error as TypeError).message
  }
}
