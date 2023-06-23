import { trim } from "~/string";

export type FsModule = {
  getBasename: (path: string) => string;
  joinPath: (...paths: string[]) => string | Promise<string>;
  resolvePath: (...paths: string[]) => string | Promise<string>;
  isDirectory: (path: string) => boolean | Promise<boolean>;
  readDirectory: (path: string) => string[] | Promise<string[]>;
  readFile: (path: string) => string | Promise<string>;
};

export type FsFileOptions = {
  absolutePath: string;
  relativePath: string;
  name: string;
};

export type WalkOptions<T> = {
  directoryFilter?: (options: FsFileOptions) => boolean;
  fileFilter?: (options: FsFileOptions) => boolean;
  getFileData: (options: FsFileOptions) => Promise<T>;
};

export type FsFileMapDirectoryItem<T> = {
  children: FsFileMap<T>;
};
export type FsFileMapFileItem<T> = {
  data: T;
};
export type FsFileMapItem<T> = FsFileMapDirectoryItem<T> | FsFileMapFileItem<T>;

export function isFsFileMapDirectoryValue<T>(
  item: FsFileMapItem<T>,
): item is FsFileMapDirectoryItem<T> {
  return "children" in item;
}

export function isFsFileMapFileValue<T>(item: FsFileMapItem<T>): item is FsFileMapFileItem<T> {
  return "data" in item;
}

export type FsFileMap<T> = Map<string, FsFileMapItem<T>>;

export async function walkDirectory<T = undefined>(
  fsModule: FsModule,
  directory: string,
  options: WalkOptions<T>,
): Promise<FsFileMap<T> | undefined> {
  const absoluteDirPath = await fsModule.resolvePath(directory.trim());
  const isDirectory = await fsModule.isDirectory(absoluteDirPath);
  if (!isDirectory) {
    return;
  }

  const map = new Map<string, FsFileMapItem<T>>();
  await walkDirectoryInternal(
    fsModule,
    map,
    absoluteDirPath,
    "",
    fsModule.getBasename(absoluteDirPath),
    options,
  );
  return map;
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
    return;
  }

  const files = await fsModule.readDirectory(absoluteDirPath);
  await Promise.all(
    files.map((fileName) =>
      walkFileInternal(fsModule, fsFileMap, absoluteDirPath, relativeDirPath, fileName, options),
    ),
  );
}

async function walkFileInternal<T>(
  fsModule: FsModule,
  fsFileMap: FsFileMap<T>,
  absoluteDirPath: string,
  relativeDirPath: string,
  fileName: string,
  options: WalkOptions<T>,
): Promise<void> {
  const absoluteFilepath = await fsModule.joinPath(absoluteDirPath, fileName);
  const relativeFilepath = await fsModule.joinPath(relativeDirPath, fileName);
  const fileOptions = {
    absolutePath: absoluteFilepath,
    relativePath: relativeFilepath,
    name: fileName,
  };

  const isDirectory = await fsModule.isDirectory(absoluteFilepath);
  if (isDirectory) {
    const children = new Map<string, FsFileMapItem<T>>();
    fsFileMap.set(fileName, { children });
    await walkDirectoryInternal(
      fsModule,
      children,
      absoluteFilepath,
      relativeDirPath,
      fileName,
      options,
    );
  } else if (!options || !options.fileFilter || options.fileFilter(fileOptions)) {
    const data = await options.getFileData(fileOptions);
    fsFileMap.set(fileName, { data });
  }
}

export type FileMapItem<T> = {
  pathParts: string[];
  path: string;
  data: T;

  parent?: FileMapItem<T>;
  children?: FileMap<T>;
};

export type FileMap<T> = Map<string, FileMapItem<T>>;

export type ConvertFsFileMapToFileMapOptions<T> = {
  getIndexFileName: (fileMap: FileMap<T>, parent: FileMapItem<T>) => string | undefined;
  transformDirectoryName?: (directoryName: string) => string;
  transformFileName?: (fileName: string, fsFileMapFileItem: FsFileMapFileItem<T>) => string;
};

export function convertFsFileMapToFileMap<T>(
  fsFileMap: FsFileMap<T>,
  options: ConvertFsFileMapToFileMapOptions<T>,
): FileMap<T> {
  return convertFsFileMapToFileMapInternal(fsFileMap, options);
}

function convertFsFileMapToFileMapInternal<T>(
  fsFileMap: FsFileMap<T>,
  options: ConvertFsFileMapToFileMapOptions<T>,
  parent?: FileMapItem<T>,
): FileMap<T> {
  const fileMap = new Map<string, FileMapItem<T>>();
  for (const [fileName, fsFileMapItem] of fsFileMap.entries()) {
    const fileMapItem = convertFsFileMapItemToFileMapItemInternal(
      fsFileMapItem,
      fileName,
      options,
      parent,
    );
    fileMap.set(
      fileMapItem.pathParts[fileMapItem.pathParts.length - 1]!,
      convertFsFileMapItemToFileMapItemInternal(fsFileMapItem, fileName, options, parent),
    );
  }
  if (parent) {
    const indexFileName = options.getIndexFileName(fileMap, parent);
    if (indexFileName == null) {
      throw new Error(`Directory '${parent.path}' doesn't have an index file`);
    }

    const indexFileMapItem = fileMap.get(indexFileName);
    if (!indexFileMapItem) {
      throw new Error(`Index file '${indexFileName}' not found in directory '${parent.path}'`);
    } else if (indexFileMapItem.children && indexFileMapItem.children.size > 0) {
      throw new Error(`Index file '${indexFileName}' in directory '${parent.path} is not a file`);
    }

    fileMap.delete(indexFileName);
    fileMap.forEach((item) => {
      item.parent = parent;
    });

    parent.data = indexFileMapItem.data;
    parent.children = fileMap;
  }
  return fileMap;
}

function convertFsFileMapItemToFileMapItemInternal<T>(
  fsFileMapItem: FsFileMapItem<T>,
  fileName: string,
  options: ConvertFsFileMapToFileMapOptions<T>,
  parent?: FileMapItem<T>,
): FileMapItem<T> {
  const finalFileName = isFsFileMapDirectoryValue(fsFileMapItem)
    ? options.transformDirectoryName
      ? options.transformDirectoryName(fileName)
      : fileName
    : options.transformFileName
    ? options.transformFileName(fileName, fsFileMapItem)
    : fileName;
  const pathParts = parent ? [...parent.pathParts, finalFileName] : [finalFileName];
  const path = parent ? joinPathParts(parent.path, finalFileName) : finalFileName;
  if (isFsFileMapFileValue(fsFileMapItem)) {
    return {
      pathParts,
      path,
      data: fsFileMapItem.data,
      parent,
    };
  } else {
    const fileMapItem = {
      pathParts,
      path,
      data: undefined as unknown as T,
      parent,
    };
    convertFsFileMapToFileMapInternal(fsFileMapItem.children, options, fileMapItem);
    return fileMapItem;
  }
}

export function mapFileMap<T, U>(fileMap: FileMap<T>, fn: (_: T) => U): FileMap<U> {
  return mapFileMapInternal(fileMap, fn);
}

function mapFileMapInternal<T, U>(
  fileMap: FileMap<T>,
  fn: (_: T) => U,
  parent?: FileMapItem<U>,
): FileMap<U> {
  const newFileMap: FileMap<U> = new Map();
  for (const [key, fileMapItem] of fileMap) {
    newFileMap.set(key, mapFileMapItem(fileMapItem, fn, parent));
  }
  return newFileMap;
}

function mapFileMapItem<T, U>(
  fileMapItem: FileMapItem<T>,
  fn: (_: T) => U,
  parent?: FileMapItem<U>,
): FileMapItem<U> {
  const curr: FileMapItem<U> = {
    ...fileMapItem,
    data: fn(fileMapItem.data),
    parent,
    children: undefined,
  };
  curr.children = fileMapItem.children
    ? mapFileMapInternal(fileMapItem.children, fn, curr)
    : undefined;
  return curr;
}

export function findFileMap<T>(fileMap: FileMap<T>, fn: (_: T) => boolean): T | undefined {
  for (const fileMapItem of fileMap.values()) {
    const result = findFileMapItem(fileMapItem, fn);
    if (result != null) {
      return result;
    }
  }
  return undefined;
}

function findFileMapItem<T>(fileMapItem: FileMapItem<T>, fn: (_: T) => boolean): T | undefined {
  return fn(fileMapItem.data)
    ? fileMapItem.data
    : fileMapItem.children != null
    ? findFileMap(fileMapItem.children, fn)
    : undefined;
}

export function someFileMap<T>(fileMap: FileMap<T>, fn: (_: T) => boolean): boolean {
  return findFileMap(fileMap, fn) != null;
}

function joinPathParts(...parts: string[]): string {
  return parts.join("/");
}

export type FlattenedFileMapItem<T> = {
  pathParts: string[];
  path: string;
  data: T;

  index: number;
  parentIndex?: number;
  childrenIndices?: number[];
};

export type FlattenedFileMap<T> = FlattenedFileMapItem<T>[];

export function flattenFileMap<T>(
  fileMap: FileMap<T>,
  compareFn?: (a: FileMapItem<T>, b: FileMapItem<T>) => number,
): FlattenedFileMap<T> {
  return flattenFileMapInternal(fileMap, compareFn);
}

function flattenFileMapInternal<T>(
  fileMap: FileMap<T>,
  compareFn?: (a: FileMapItem<T>, b: FileMapItem<T>) => number,
  parentIndex?: number,
): FlattenedFileMap<T> {
  const flattenedFileMap: FlattenedFileMap<T> = [];
  const fileMapItems = Array.from(fileMap.values());
  if (fileMapItems.length === 0) {
    return flattenedFileMap;
  }

  fileMapItems.sort(compareFn || compareFileMapItem);
  for (const fileMapItem of fileMapItems) {
    const curr: FlattenedFileMapItem<T> = {
      pathParts: fileMapItem.pathParts,
      path: fileMapItem.path,
      data: fileMapItem.data,
      index: flattenedFileMap.length,
      parentIndex,
      childrenIndices: undefined,
    };
    const currChildren = fileMapItem.children
      ? flattenFileMapInternal(fileMapItem.children, compareFn, curr.index)
      : undefined;
    flattenedFileMap.push(curr);
    const startIndex = flattenedFileMap.length;
    if (currChildren) {
      flattenedFileMap.push(...currChildren);
      const childrenIndices: number[] = [];
      currChildren.forEach((_, index) => {
        childrenIndices.push(startIndex + index);
      });
      curr.childrenIndices = childrenIndices;
    }
  }
  return flattenedFileMap;
}

export function unflattenFlattenedFileMap<T>(flattenedFileMap: FlattenedFileMap<T>): FileMap<T> {
  const indices = flattenedFileMap
    .map((item, index) => (item.parentIndex == null ? index : -1))
    .filter((index) => index >= 0);
  return unflattenFlattenedFileMapInternal(flattenedFileMap, indices);
}

function unflattenFlattenedFileMapInternal<T>(
  flattenedFileMap: FlattenedFileMap<T>,
  indices: number[],
  parent?: FileMapItem<T>,
): FileMap<T> {
  const fileMap = new Map<string, FileMapItem<T>>();
  for (const index of indices) {
    const curr = flattenedFileMap[index]!;
    const currItem: FileMapItem<T> = {
      ...curr,
      parent,
      children: undefined,
    };
    if (curr.childrenIndices) {
      currItem.children = unflattenFlattenedFileMapInternal(
        flattenedFileMap,
        curr.childrenIndices,
        currItem,
      );
    }
    fileMap.set(curr.path, currItem);
  }
  return fileMap;
}

export function sortFlattenedFileMap<T>(
  flattenedFileMap: FlattenedFileMap<T>,
  compareFn?: (a: FileMapItem<T>, b: FileMapItem<T>) => number,
): FlattenedFileMap<T> {
  const fileMap = unflattenFlattenedFileMap(flattenedFileMap);
  return flattenFileMap(fileMap, compareFn);
}

export type FileMapPathIndexItem<T> = {
  pathParts: string[];
  path: string;
  data: T;

  index: number;
  parent?: FileMapPathIndexItem<T>;
  children?: FileMapPathIndexItem<T>[];
};

export type FileMapPathIndex<T> = Map<string, FileMapPathIndexItem<T>>;

export function createFileMapIndex<T>(flattenedFileMap: FlattenedFileMap<T>): FileMapPathIndex<T> {
  const flattenedFilePathMap = new Map<string, FlattenedFileMapItem<T>>();
  flattenedFileMap.forEach((item) => {
    flattenedFilePathMap.set(item.path, item);
  });

  const fileMap = unflattenFlattenedFileMap(flattenedFileMap);
  const fileMapPathIndex = new Map<string, FileMapPathIndexItem<T>>();
  fileMap.forEach((fileMapItem) => {
    createFileMapIndexItemInternal(fileMapPathIndex, flattenedFilePathMap, fileMapItem);
  });
  return fileMapPathIndex;
}

export function createFileMapIndexItemInternal<T>(
  fileMapPathIndex: FileMapPathIndex<T>,
  flattenedFilePathMap: Map<string, FlattenedFileMapItem<T>>,
  fileMapItem: FileMapItem<T>,
  parent?: FileMapPathIndexItem<T>,
): FileMapPathIndexItem<T> {
  const flattenedFileMapItem = flattenedFilePathMap.get(fileMapItem.path)!;
  const fileMapPathIndexItem: FileMapPathIndexItem<T> = {
    pathParts: fileMapItem.pathParts,
    path: fileMapItem.path,
    data: fileMapItem.data,
    index: flattenedFileMapItem.index,
    parent,
    children: undefined,
  };

  fileMapPathIndex.set(fileMapItem.path, fileMapPathIndexItem);
  if (fileMapItem.children) {
    const children: FileMapPathIndexItem<T>[] = [];
    fileMapItem.children.forEach((child) => {
      children.push(
        createFileMapIndexItemInternal(
          fileMapPathIndex,
          flattenedFilePathMap,
          child,
          fileMapPathIndexItem,
        ),
      );
    });
    fileMapPathIndexItem.children = children;
  }
  return fileMapPathIndexItem;
}

function compareFileMapItem<T>(a: FileMapItem<T>, b: FileMapItem<T>): number {
  if (a.path < b.path) {
    return -1;
  } else if (a.path > b.path) {
    return 1;
  } else {
    return 0;
  }
}

export function pathPartsToPath(parts: string[]): string {
  return parts
    .map((s) => trim(s))
    .filter((s) => s !== "")
    .join("/");
}

export function pathToPathParts(path: string): string[] {
  return trim(trim(path), "/")
    .split("/")
    .map((s) => trim(s))
    .filter((s) => s !== "");
}

export function sanitizePathParts(parts: string[]): string[] {
  return parts.map((s) => trim(s)).filter((s) => s !== "");
}
