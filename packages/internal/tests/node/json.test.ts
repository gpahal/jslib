import path from 'node:path'

import { readJsonFile } from '@/node/json'
import { withTmpProject } from '@/node/testing'

test('reads a JSON file with or without a leading BOM', async () => {
  await using project = await withTmpProject('internal-json', {
    'bom.json': '\u{FEFF}{"a":1}',
    'plain.json': '{"a":1}',
    'bad.json': '{',
  })
  expect(readJsonFile(path.join(project.dir, 'bom.json'))).toEqual({ a: 1 })
  expect(readJsonFile(path.join(project.dir, 'plain.json'))).toEqual({ a: 1 })
  expect(() => readJsonFile(path.join(project.dir, 'missing.json'))).toThrow(/ENOENT/u)
  expect(() => readJsonFile(path.join(project.dir, 'bad.json'))).toThrow(SyntaxError)
})
