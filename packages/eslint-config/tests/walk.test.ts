import path from 'node:path'

import { IgnoreLayers } from '@/internal/walk'

describe('IgnoreLayers', () => {
  it('gives the layers above a path in order, including one added after a lookup', () => {
    const root = path.resolve('/project')
    const layers = new IgnoreLayers([{ basePath: root, ignores: ['a'] }])
    const file = path.join(root, 'packages', 'p', 'index.ts')
    expect(layers.above(file).map(({ ignores }) => ignores)).toEqual([['a']])
    layers.add({ basePath: path.join(root, 'packages', 'p'), ignores: ['b'] })
    layers.add({ basePath: path.join(root, 'packages'), ignores: ['c'] }, -1)
    expect(layers.above(file).map(({ ignores }) => ignores)).toEqual([['c'], ['a'], ['b']])
  })
})
