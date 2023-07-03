import { trim } from '~/string'

export type FsModule = {
  getBasename: (path: string) => string
  joinPath: (...paths: string[]) => string | Promise<string>
  getAbsolutePath: (path: string) => string | Promise<string>
  isDirectory: (path: string) => boolean | Promise<boolean>
  readDirectory: (path: string) => string[] | Promise<string[]>
  readFile: (path: string) => string | Promise<string>
}

export type FsFileOptions = {
  absolutePath: string
  relativePath: string
  name: string
}

export type WalkOptions<T> = {
  directoryFilter?: (options: FsFileOptions) => boolean
  fileFilter?: (options: FsFileOptions) => boolean
  parseFileContents: (data: string, options: FsFileOptions) => T | Promise<T>
}

export type FsFileMapDirectoryItem<T> = {
  children: FsFileMap<T>
}
export type FsFileMapFileItem<T> = {
  data: T
}
export type FsFileMapItem<T> = FsFileMapDirectoryItem<T> | FsFileMapFileItem<T>

export function isFsFileMapDirectoryValue<T>(item: FsFileMapItem<T>): item is FsFileMapDirectoryItem<T> {
  return 'children' in item
}

export function isFsFileMapFileValue<T>(item: FsFileMapItem<T>): item is FsFileMapFileItem<T> {
  return 'data' in item
}

export type FsFileMap<T> = Map<string, FsFileMapItem<T>>

export async function walkDirectory<T>(
  fsModule: FsModule,
  directory: string,
  options: WalkOptions<T>,
): Promise<FsFileMap<T> | undefined> {
  const absoluteDirPath = await fsModule.getAbsolutePath(directory.trim())
  const isDirectory = await fsModule.isDirectory(absoluteDirPath)
  if (!isDirectory) {
    return
  }

  const map = new Map<string, FsFileMapItem<T>>()
  await walkDirectoryInternal(fsModule, map, absoluteDirPath, '', fsModule.getBasename(absoluteDirPath), options)
  return map
}

async function walkDirectoryInternal<T>(
  fsModule: FsModule,
  fsFileMap: FsFileMap<T>,
  absoluteDirPath: string,
  relativeDirPath: string,
  dirName: string,
  options: WalkOptions<T>,
): Promise<void> {
  if (
    options &&
    options.directoryFilter &&
    !options.directoryFilter({
      absolutePath: absoluteDirPath,
      relativePath: relativeDirPath,
      name: dirName,
    })
  ) {
    return
  }

  const files = await fsModule.readDirectory(absoluteDirPath)
  await Promise.all(
    files.map((fileName) => walkFileInternal(fsModule, fsFileMap, absoluteDirPath, relativeDirPath, fileName, options)),
  )
}

async function walkFileInternal<T>(
  fsModule: FsModule,
  fsFileMap: FsFileMap<T>,
  absoluteDirPath: string,
  relativeDirPath: string,
  fileName: string,
  options: WalkOptions<T>,
): Promise<void> {
  const absoluteFilepath = await fsModule.joinPath(absoluteDirPath, fileName)
  const relativeFilepath = await fsModule.joinPath(relativeDirPath, fileName)
  const fileOptions = {
    absolutePath: absoluteFilepath,
    relativePath: relativeFilepath,
    name: fileName,
  }

  const isDirectory = await fsModule.isDirectory(absoluteFilepath)
  if (isDirectory) {
    const children = new Map<string, FsFileMapItem<T>>()
    fsFileMap.set(fileName, { children })
    await walkDirectoryInternal(fsModule, children, absoluteFilepath, relativeDirPath, fileName, options)
  } else if (!options || !options.fileFilter || options.fileFilter(fileOptions)) {
    const contents = await fsModule.readFile(absoluteFilepath)
    const data = await options.parseFileContents(contents, fileOptions)
    fsFileMap.set(fileName, { data })
  }
}

export type WithOriginalFileName<T> = T & { originalFileName: string }

export type FileMapItem<T> = {
  pathParts: string[]
  path: string
  data: T

  parent?: FileMapItem<T>
  children?: FileMap<T>
}

export type FileMap<T> = Map<string, FileMapItem<T>>

export type CreateFileMapOptions<T> = {
  transformFileName?: (fileName: string, fileMapItem: FileMapItem<T>) => string
}

export function createFileMap<T>(
  fsFileMap: FsFileMap<T>,
  getIndexFileName: (directoryName: string, fsFileMap: FsFileMap<T>) => string | undefined,
  options?: CreateFileMapOptions<T>,
): FileMap<T> {
  const fileMap = createFileMapInternal(fsFileMap, getIndexFileName)
  if (options?.transformFileName) {
    transformFileMapNames(fileMap, options.transformFileName)
  }
  return fileMap
}

export function transformFileMapNames<T>(
  fileMap: FileMap<T>,
  transformFileName: (fileName: string, fileMapItem: FileMapItem<T>) => string,
): void {
  const entries = Array.from(fileMap.entries())
  fileMap.clear()
  for (const [fileName, fileMapItem] of entries) {
    const newFileName = transformFileName(fileName, fileMapItem)
    fileMapItem.pathParts = fileMapItem.parent ? [...fileMapItem.parent.pathParts, newFileName] : [newFileName]
    fileMapItem.path = fileMapItem.parent ? joinPathParts(fileMapItem.parent.path, newFileName) : newFileName
    fileMap.set(newFileName, fileMapItem)
    if (fileMapItem.children) {
      transformFileMapNames(fileMapItem.children, transformFileName)
    }
  }
}

export function createFileMapInternal<T>(
  fsFileMap: FsFileMap<T>,
  getIndexFileName: (directoryName: string, fsFileMap: FsFileMap<T>) => string | undefined,
  parent?: FileMapItem<T>,
  indexFileName?: string,
): FileMap<T> {
  const fileMap = new Map<string, FileMapItem<T>>()
  for (const [fileName, fsFileMapItem] of fsFileMap.entries()) {
    if (fileName === indexFileName) {
      continue
    }

    const fileMapItem = createFileMapItemInternal(fileName, fsFileMapItem, getIndexFileName, parent)
    fileMap.set(fileName, fileMapItem)
  }
  return fileMap
}

function createFileMapItemInternal<T>(
  originalFileName: string,
  fsFileMapItem: FsFileMapItem<T>,
  getIndexFileName: (directoryName: string, fsFileMap: FsFileMap<T>) => string | undefined,
  parent?: FileMapItem<T>,
): FileMapItem<T> {
  return isFsFileMapDirectoryValue(fsFileMapItem)
    ? convertFsFileMapDirectoryItemToFileMapItemInternal(originalFileName, fsFileMapItem, getIndexFileName, parent)
    : convertFsFileMapFileItemToFileMapItemInternal(originalFileName, fsFileMapItem, parent)
}

function convertFsFileMapDirectoryItemToFileMapItemInternal<T>(
  directoryName: string,
  fsFileMapDirectoryItem: FsFileMapDirectoryItem<T>,
  getIndexFileName: (directoryName: string, fsFileMap: FsFileMap<T>) => string | undefined,
  parent?: FileMapItem<T>,
): FileMapItem<T> {
  const indexFileName = getIndexFileName(directoryName, fsFileMapDirectoryItem.children)
  if (indexFileName == null) {
    throw new Error(`Directory '${directoryName}' doesn't have an index file`)
  }

  const fsFileMapFileItem = fsFileMapDirectoryItem.children.get(indexFileName)
  if (!fsFileMapFileItem) {
    throw new Error(`Index file '${indexFileName}' not found in directory '${directoryName}'`)
  } else if (isFsFileMapDirectoryValue(fsFileMapFileItem)) {
    throw new Error(`Index file '${indexFileName}' in directory '${directoryName} is not a file`)
  }

  const fileMapItem = convertFsFileMapFileItemToFileMapItemInternal(directoryName, fsFileMapFileItem, parent)
  fileMapItem.children = createFileMapInternal(
    fsFileMapDirectoryItem.children,
    getIndexFileName,
    fileMapItem,
    indexFileName,
  )
  return fileMapItem
}

function convertFsFileMapFileItemToFileMapItemInternal<T>(
  fileName: string,
  fsFileMapFileItem: FsFileMapFileItem<T>,
  parent?: FileMapItem<T>,
): FileMapItem<T> {
  return {
    pathParts: parent ? [...parent.pathParts, fileName] : [fileName],
    path: parent ? joinPathParts(parent.path, fileName) : fileName,
    data: fsFileMapFileItem.data,
    parent,
  }
}

export function mapFileMap<T, U>(fileMap: FileMap<T>, fn: (_: T) => U): FileMap<U> {
  return mapFileMapInternal(fileMap, fn)
}

function mapFileMapInternal<T, U>(fileMap: FileMap<T>, fn: (_: T) => U, parent?: FileMapItem<U>): FileMap<U> {
  const newFileMap: FileMap<U> = new Map()
  for (const [key, fileMapItem] of fileMap) {
    newFileMap.set(key, mapFileMapItem(fileMapItem, fn, parent))
  }
  return newFileMap
}

function mapFileMapItem<T, U>(fileMapItem: FileMapItem<T>, fn: (_: T) => U, parent?: FileMapItem<U>): FileMapItem<U> {
  const curr: FileMapItem<U> = {
    ...fileMapItem,
    data: fn(fileMapItem.data),
    parent,
    children: undefined,
  }
  curr.children = fileMapItem.children ? mapFileMapInternal(fileMapItem.children, fn, curr) : undefined
  return curr
}

export function findFileMap<T>(fileMap: FileMap<T>, fn: (_: T) => boolean): T | undefined {
  for (const fileMapItem of fileMap.values()) {
    const result = findFileMapItem(fileMapItem, fn)
    if (result != null) {
      return result
    }
  }
  return undefined
}

function findFileMapItem<T>(fileMapItem: FileMapItem<T>, fn: (_: T) => boolean): T | undefined {
  return fn(fileMapItem.data)
    ? fileMapItem.data
    : fileMapItem.children != null
    ? findFileMap(fileMapItem.children, fn)
    : undefined
}

export function someFileMap<T>(fileMap: FileMap<T>, fn: (_: T) => boolean): boolean {
  return findFileMap(fileMap, fn) != null
}

function joinPathParts(...parts: string[]): string {
  return parts.join('/')
}

export type FlattenedFileMapIndexItem<T> = {
  pathParts: string[]
  path: string
  data: T

  index: number
  parentIndex?: number
  childrenIndices?: number[]
}

export type FlattenedFileMapIndex<T> = FlattenedFileMapIndexItem<T>[]

export function createFlattenedFileMapIndex<T>(
  fileMap: FileMap<T>,
  compareFn?: (a: FileMapItem<T>, b: FileMapItem<T>) => number,
): FlattenedFileMapIndex<T> {
  const flattenedFileMapIndex: FlattenedFileMapIndex<T> = []
  updateFlattenedFileMapIndexInternal(flattenedFileMapIndex, fileMap, compareFn)
  return flattenedFileMapIndex
}

function updateFlattenedFileMapIndexInternal<T>(
  flattenedFileMapIndex: FlattenedFileMapIndex<T>,
  fileMap: FileMap<T>,
  compareFn?: (a: FileMapItem<T>, b: FileMapItem<T>) => number,
  parent?: FlattenedFileMapIndexItem<T>,
): void {
  const fileMapItems = Array.from(fileMap.values())
  if (fileMapItems.length === 0) {
    return
  }

  fileMapItems.sort(compareFn || compareFileMapItem)
  for (const fileMapItem of fileMapItems) {
    const curr: FlattenedFileMapIndexItem<T> = {
      pathParts: fileMapItem.pathParts,
      path: fileMapItem.path,
      data: fileMapItem.data,
      index: flattenedFileMapIndex.length,
      parentIndex: parent ? parent.index : undefined,
      childrenIndices: undefined,
    }
    flattenedFileMapIndex.push(curr)
    if (fileMapItem.children) {
      updateFlattenedFileMapIndexInternal(flattenedFileMapIndex, fileMapItem.children, compareFn, curr)
    }
    if (parent) {
      parent.childrenIndices = parent.childrenIndices || []
      parent.childrenIndices.push(curr.index)
    }
  }
}

export function unflattenFlattenedFileMapIndex<T>(flattenedFileMap: FlattenedFileMapIndex<T>): FileMap<T> {
  const indices = flattenedFileMap
    .map((item, index) => (item.parentIndex == null ? index : -1))
    .filter((index) => index >= 0)
  return unflattenFlattenedFileMapIndexInternal(flattenedFileMap, indices)
}

function unflattenFlattenedFileMapIndexInternal<T>(
  flattenedFileMap: FlattenedFileMapIndex<T>,
  indices: number[],
  parent?: FileMapItem<T>,
): FileMap<T> {
  const fileMap = new Map<string, FileMapItem<T>>()
  for (const index of indices) {
    const curr = flattenedFileMap[index]!
    const currItem: FileMapItem<T> = {
      ...curr,
      parent,
      children: undefined,
    }
    if (curr.childrenIndices) {
      currItem.children = unflattenFlattenedFileMapIndexInternal(flattenedFileMap, curr.childrenIndices, currItem)
    }
    fileMap.set(curr.pathParts[curr.pathParts.length - 1]!, currItem)
  }
  return fileMap
}

export function sortFlattenedFileMapIndex<T>(
  flattenedFileMap: FlattenedFileMapIndex<T>,
  compareFn?: (a: FileMapItem<T>, b: FileMapItem<T>) => number,
): FlattenedFileMapIndex<T> {
  const fileMap = unflattenFlattenedFileMapIndex(flattenedFileMap)
  return createFlattenedFileMapIndex(fileMap, compareFn)
}

export type FileMapIndexItem<T> = {
  pathParts: string[]
  path: string
  data: T

  index: number
  parent?: FileMapIndexItem<T>
  children?: FileMapIndex<T>
}

export type FileMapIndex<T> = FileMapIndexItem<T>[]

export function createFileMapIndex<T>(flattenedFileMapIndex: FlattenedFileMapIndex<T>): FileMapIndex<T> {
  return flattenedFileMapIndex
    .filter((flattenedFileMapIndexItem) => flattenedFileMapIndexItem.parentIndex == null)
    .map((flattenedFileMapIndexItem) =>
      createFileMapIndexItemInternal(flattenedFileMapIndex, flattenedFileMapIndexItem),
    )
}

export function createFileMapIndexItemInternal<T>(
  flattenedFileMapIndex: FlattenedFileMapIndex<T>,
  flattenedFileMapIndexItem: FlattenedFileMapIndexItem<T>,
  parent?: FileMapIndexItem<T>,
): FileMapIndexItem<T> {
  const fileMapIndexItem: FileMapIndexItem<T> = {
    pathParts: flattenedFileMapIndexItem.pathParts,
    path: flattenedFileMapIndexItem.path,
    data: flattenedFileMapIndexItem.data,
    index: flattenedFileMapIndexItem.index,
    parent,
    children: undefined,
  }

  if (flattenedFileMapIndexItem.childrenIndices) {
    const children = flattenedFileMapIndexItem.childrenIndices.map((childIndex) => flattenedFileMapIndex[childIndex]!)
    fileMapIndexItem.children = children.map((child) =>
      createFileMapIndexItemInternal(flattenedFileMapIndex, child, fileMapIndexItem),
    )
  }
  return fileMapIndexItem
}

function compareFileMapItem<T>(a: FileMapItem<T>, b: FileMapItem<T>): number {
  if (a.path < b.path) {
    return -1
  } else if (a.path > b.path) {
    return 1
  } else {
    return 0
  }
}

export function pathPartsToPath(parts: string[]): string {
  return parts
    .map((s) => trim(s))
    .filter((s) => s !== '')
    .join('/')
}

export function pathToPathParts(path: string): string[] {
  return trim(trim(path), '/')
    .split('/')
    .map((s) => trim(s))
    .filter((s) => s !== '')
}

export function sanitizePathParts(parts: string[]): string[] {
  return parts.map((s) => trim(s)).filter((s) => s !== '')
}
