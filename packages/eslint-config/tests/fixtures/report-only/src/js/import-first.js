// Moving the import above the assignment changes the order under CommonJS output
globalThis.mode = 'test'
import { label } from './prefer-template.js'

export const text = label(1)
