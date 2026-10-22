import type * as DefaultProject from '@/internal/default-project'
import { resolveOptions } from '@/internal/resolve'

import { withProject } from './helpers'

const discoveries = vi.hoisted(() => ({ count: 0 }))

// Counts the discoveries, which parse the tsconfigs
vi.mock('@/internal/default-project', async (importOriginal) => {
  const original = await importOriginal<typeof DefaultProject>()
  return {
    ...original,
    discoverProjects: (...args: Parameters<typeof original.discoverProjects>) => {
      discoveries.count++
      return original.discoverProjects(...args)
    },
  }
})

describe('the default project discovery', () => {
  it.each<[string, (() => Array<string>) | Array<string> | undefined, number]>([
    ['the default', undefined, 1],
    ['a function', () => [], 1],
    ['an array', ['vite.config.ts'], 0],
    ['an empty array', [], 0],
  ])('runs for %s', async (_name, allowDefaultProject, count) => {
    await using project = await withProject({
      'tsconfig.json': '{ "include": ["src"] }\n',
      'src/a.ts': 'export const a = 1\n',
      'vite.config.ts': 'export default {}\n',
    })
    discoveries.count = 0
    resolveOptions({
      root: project.dir,
      typeAware: allowDefaultProject === undefined ? true : { allowDefaultProject },
    })
    expect(discoveries.count).toBe(count)
  })
})
