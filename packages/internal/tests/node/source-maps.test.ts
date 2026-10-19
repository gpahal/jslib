import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  dropSources,
  isPublishedFile,
  isSourceMap,
  resolveSourcePath,
  type SourceMap,
} from '@/node/source-maps'

describe('built source maps', () => {
  it.each(['js', 'd.ts'])('keeps published TypeScript sources in the %s map', async (extension) => {
    const entry = new URL(import.meta.resolve('@gpahal/std/arrays'))
    const mapUrl = new URL(`arrays.${extension}.map`, entry)
    const map: unknown = JSON.parse(await fs.readFile(mapUrl, 'utf8'))
    expect(isSourceMap(map)).toBe(true)
    if (!isSourceMap(map)) {
      return
    }
    const source = fileURLToPath(new URL('../src/arrays.ts', entry))
    expect(
      map.sources.map((name) => resolveSourcePath(fileURLToPath(mapUrl), map, name)),
    ).toContain(source)
    expect(map.mappings).not.toBe('')
  })
})

describe('isPublishedFile', () => {
  it('follows the `files` entries, the last matching one winning', () => {
    const files = ['src', '!src/**/*.gen.d.ts', 'build']
    expect(isPublishedFile('src/index.ts', files)).toBe(true)
    expect(isPublishedFile('src/internal/typegen.gen.d.ts', files)).toBe(false)
    expect(isPublishedFile('tests/a.test.ts', files)).toBe(false)
    expect(isPublishedFile('src/a.gen.d.ts', ['src/**/*.gen.d.ts', '!src', 'src/a.gen.d.ts'])).toBe(
      true,
    )
  })

  it('publishes everything without `files`, always the manifest, and dot folders of a listed folder', () => {
    expect(isPublishedFile('tests/a.test.ts', undefined)).toBe(true)
    expect(isPublishedFile('package.json', ['build'])).toBe(true)
    expect(isPublishedFile('src/.generated/a.ts', ['./src/'])).toBe(true)
    expect(isPublishedFile('src/.generated/a.gen.d.ts', ['src', '!src/**/*.gen.d.ts'])).toBe(false)
  })
})

describe('dropSources', () => {
  it('removes the sources and unmaps the segments that pointed at them', () => {
    // Absolute segments. Line 1: [0,0,0,0] [4,1,2,3,0]. Line 2: [0,2,5,0] [6]. Line 3: [2,2,6,1,1]
    const map: SourceMap = {
      sources: ['a.ts', 'b.d.ts', 'c.ts'],
      sourcesContent: ['a', 'b', 'c'],
      names: ['x', 'y'],
      mappings: 'AAAA,ICEGA;ACGH,M;EACCC',
    }
    dropSources(map, (source) => source === 'b.d.ts')
    expect(map.sources).toEqual(['a.ts', 'c.ts'])
    expect(map.sourcesContent).toEqual(['a', 'c'])
    // Line 1: [0,0,0,0] [4]. Line 2: [0,1,5,0] [6]. Line 3: [2,1,6,1,1]
    expect(map.mappings).toBe('AAAA,I;ACKA,M;EACCC')
  })

  it('leaves a map without dropped sources as it was', () => {
    const map: SourceMap = { sources: ['a.ts'], mappings: 'AAAA,IAAI' }
    dropSources(map, () => false)
    expect(map).toEqual({ sources: ['a.ts'], mappings: 'AAAA,IAAI' })
  })
})
