import fs from 'node:fs'

export const read = (file) => fs.readFileSync(file, 'UTF-8')
