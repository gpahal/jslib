import fs from 'node:fs/promises'
import path from 'node:path'

import type { FsModule } from '@gpahal/std/fs'

export const FS_MODULE = {
  getBasename: path.basename,
  joinPath: path.join,
  getAbsolutePath: (p) => path.resolve(p),
  isDirectory: async (path: string) => {
    const stat = await fs.stat(path)
    return stat && stat.isDirectory()
  },
  readDirectory: fs.readdir,
  readFile: async (path: string) => {
    const buffer = await fs.readFile(path)
    return buffer.toString()
  },
} satisfies FsModule
