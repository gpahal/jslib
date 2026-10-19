import fs from 'node:fs'
import path from 'path'

export const mode = process.env.MODE
export const env = globalThis.process.env
export const isFound = fs.existsSync(path.join('a', 'b'))
