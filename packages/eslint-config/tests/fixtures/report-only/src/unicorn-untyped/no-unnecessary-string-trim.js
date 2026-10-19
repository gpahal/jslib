// A zod schema's `trim()` isn't a string's
import { z } from 'zod/v4'

export const URL_SCHEMA = z.string().trim().startsWith('https://')
