import fs from 'node:fs'

export const data = JSON.parse(fs.readFileSync('data.json'))
