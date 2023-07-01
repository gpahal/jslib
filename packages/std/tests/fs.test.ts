import {
  createFileMap,
  createFileMapIndex,
  createFlattenedFileMapIndex,
  FsModule,
  transformFileMapNames,
  unflattenFlattenedFileMapIndex,
  walkDirectory,
} from '../src/fs'

const fs = {
  dir: {
    a: {
      index: 'a',
      a: 'a.a',
    },
    b: {
      index: 'b',
    },
    c: 'c',
    d: {
      index: 'd',
      a: {
        index: 'd.a',
        a: 'd.a.a',
        b: 'd.a.b',
        c: {
          index: 'd.a.c',
        },
        d: 'd.a.d',
        e: {
          index: 'd.a.e',
          a: 'd.a.e.a',
        },
      },
      b: 'd.b',
    },
  },
}

const fsModule = createMemoryFsModule(fs)

test('file-map', async () => {
  const fsFileMap = await walkDirectory(fsModule, 'dir', {
    parseFileContents: (c) => c,
  })
  expect(fsFileMap).toBeTruthy()

  const fileMap = createFileMap(fsFileMap!, () => 'index')
  expect(fileMap).toBeTruthy()

  const flattenedFileMapIndex = createFlattenedFileMapIndex(fileMap)
  expect(flattenedFileMapIndex).toBeTruthy()
  expect(flattenedFileMapIndex.length).toBe(13)

  const fileMapIndex = createFileMapIndex(flattenedFileMapIndex)
  expect(fileMapIndex).toBeTruthy()

  const fileMap2 = unflattenFlattenedFileMapIndex(flattenedFileMapIndex)
  expect(fileMap2).toBeTruthy()

  transformFileMapNames(fileMap2, (n) => n + 'New')
  expect(fileMap2).toBeTruthy()
})

function createMemoryFsModule(fs: Record<string, unknown>): FsModule {
  return {
    getBasename: (p) => p.split('/').pop() || '',
    joinPath: (...ps) => ps.join('/').replace(/\/+/g, '/'),
    getAbsolutePath: (p) => p,
    isDirectory: (path: string) => {
      const o = getObjectPath(fs, path)
      return typeof o === 'object'
    },
    readDirectory: (path: string) => {
      const o = getObjectPath(fs, path)
      return typeof o === 'object' && o ? Object.keys(o) : []
    },
    readFile: (path: string) => {
      const o = getObjectPath(fs, path)
      return typeof o === 'string' ? o : ''
    },
  }
}

function getObjectPath(o: Record<string, unknown>, path: string): unknown {
  return getObjectPathParts(o, path.split('/'))
}

function getObjectPathParts(o: Record<string, unknown>, pathParts: string[]): unknown {
  if (!o) {
    return ''
  } else if (pathParts.length === 0) {
    return o
  }

  const [part, ...rest] = pathParts
  const newO = o[part!] as Record<string, unknown>
  return getObjectPathParts(newO, rest)
}
