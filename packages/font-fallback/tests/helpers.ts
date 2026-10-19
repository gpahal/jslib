import { readFile } from 'node:fs/promises'
import { brotliCompressSync } from 'node:zlib'

import { getFontFallbacks } from '@/index'

export const PREFIX = '@gpahal/font-fallback'

export async function getFallbackFamilies(
  ...args: Parameters<typeof getFontFallbacks>
): Promise<Array<string>> {
  const { fallbacks } = await getFontFallbacks(...args)
  return fallbacks.map(({ fallbackFamily }) => fallbackFamily)
}

export async function getRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) {
      return error
    }
    throw error
  }
  throw new Error('Expected the promise to reject')
}

/**
 * A font file's bytes, as a copy a test can change
 */
export async function readBytes(fontPath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fontPath))
}

/**
 * The offset of a table's record: a tag, checksum, offset and length, after the 12-byte header
 */
function findRecord(bytes: Uint8Array, tag: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const record = Array.from({ length: view.getUint16(4) }, (_, index) => 12 + index * 16).find(
    (offset) => String.fromCodePoint(...bytes.subarray(offset, offset + 4)) === tag,
  )
  if (record === undefined) {
    throw new Error(`The font has no ${tag} table`)
  }
  return record
}

function findTable(bytes: Uint8Array, tag: string): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(findRecord(bytes, tag) + 8)
}

export function setUint16(bytes: Uint8Array, tag: string, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset).setUint16(findTable(bytes, tag) + offset, value)
}

/**
 * Rewrites the tag, minimum, default and maximum of the first `fvar` axis
 */
export function setFirstAxis(
  bytes: Uint8Array,
  tag: string,
  [min, defaultValue, max]: readonly [number, number, number],
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const fvar = findTable(bytes, 'fvar')
  const axis = fvar + view.getUint16(fvar + 4)
  bytes.set(
    Array.from(tag, (char) => char.codePointAt(0) ?? 0),
    axis,
  )
  for (const [index, value] of [min, defaultValue, max].entries()) {
    view.setInt32(axis + 4 + index * 4, Math.round(value * 65_536))
  }
}

/**
 * Renames a table, such as to drop it with a tag no reader knows
 */
export function renameTable(bytes: Uint8Array, tag: string, newTag: string): void {
  bytes.set(
    Array.from(newTag, (char) => char.codePointAt(0) ?? 0),
    findRecord(bytes, tag),
  )
}

export function setUint32(bytes: Uint8Array, tag: string, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(findTable(bytes, tag) + offset, value)
}

export function setTableRecord(
  bytes: Uint8Array,
  tag: string,
  { offset, length }: { offset?: number; length?: number },
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const record = findRecord(bytes, tag)
  if (offset !== undefined) {
    view.setUint32(record + 8, offset)
  }
  if (length !== undefined) {
    view.setUint32(record + 12, length)
  }
}

/**
 * Maps a character to `.notdef` in a font whose first `cmap` subtable is format 4 and maps the
 * character through its glyph id array
 */
export function unmapCharacter(bytes: Uint8Array, character: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const cmap = findTable(bytes, 'cmap')
  const subtable = cmap + view.getUint32(cmap + 8)
  if (view.getUint16(subtable) !== 4) {
    throw new Error('The font has no format 4 cmap subtable first')
  }
  const codePoint = character.codePointAt(0) ?? 0
  const segCountX2 = view.getUint16(subtable + 6)
  const endCodes = subtable + 14
  const startCodes = endCodes + segCountX2 + 2
  const idRangeOffsets = startCodes + segCountX2 * 2
  for (let segment = 0; segment * 2 < segCountX2; segment++) {
    if (codePoint > view.getUint16(endCodes + segment * 2)) {
      continue
    }
    const start = view.getUint16(startCodes + segment * 2)
    const idRangeOffset = view.getUint16(idRangeOffsets + segment * 2)
    if (idRangeOffset === 0 || codePoint < start) {
      throw new Error(`The font maps ${character} without a glyph id array`)
    }
    // `idRangeOffset` counts from its own position
    view.setUint16(idRangeOffsets + segment * 2 + idRangeOffset + (codePoint - start) * 2, 0)
    return
  }
  throw new Error(`The font doesn't map ${character}`)
}

/**
 * A number as a WOFF2 UIntBase128
 */
export function toBase128(value: number): Array<number> {
  const bytes: Array<number> = []
  for (let rest = value; ; rest = Math.floor(rest / 128)) {
    bytes.unshift((rest % 128) | (bytes.length === 0 ? 0 : 0x80))
    if (rest < 128) {
      return bytes
    }
  }
}

/**
 * A TTF font as WOFF2, with every table by a custom tag and untransformed (transform version 3 for
 * `glyf` and `loca`). With `transformedGlyf`, `glyf` is that transformed table and `loca` is empty
 */
export function toWoff2(
  bytes: Uint8Array,
  { transformedGlyf }: { transformedGlyf?: Uint8Array } = {},
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numTables = view.getUint16(4)
  const directory: Array<number> = []
  const tables: Array<Uint8Array> = []
  for (let index = 0; index < numTables; index++) {
    const record = 12 + index * 16
    const tag = bytes.subarray(record, record + 4)
    const offset = view.getUint32(record + 8)
    const length = view.getUint32(record + 12)
    const tagName = String.fromCodePoint(...tag)
    const table = bytes.subarray(offset, offset + length)
    if (transformedGlyf && (tagName === 'glyf' || tagName === 'loca')) {
      const transformed = tagName === 'glyf' ? transformedGlyf : new Uint8Array()
      directory.push(0x3f, ...tag, ...toBase128(length), ...toBase128(transformed.length))
      tables.push(transformed)
      continue
    }
    const isGlyfOrLoca = tagName === 'glyf' || tagName === 'loca'
    directory.push(isGlyfOrLoca ? 0xff : 0x3f, ...tag, ...toBase128(length))
    tables.push(table)
  }
  const sfnt = Buffer.concat(tables)
  const stream = brotliCompressSync(sfnt)
  const woff2 = new Uint8Array(48 + directory.length + stream.length)
  const woff2View = new DataView(woff2.buffer)
  woff2.set([0x77, 0x4f, 0x46, 0x32])
  woff2View.setUint32(4, view.getUint32(0))
  woff2View.setUint32(8, woff2.length)
  woff2View.setUint16(12, numTables)
  woff2View.setUint32(16, 12 + numTables * 16 + sfnt.length)
  woff2View.setUint32(20, stream.length)
  woff2.set(directory, 48)
  woff2.set(stream, 48 + directory.length)
  return woff2
}

/**
 * A copy of a font with `table` appended as the table of `tag`
 */
export function replaceTable(bytes: Uint8Array, tag: string, table: Uint8Array): Uint8Array {
  // Tables start on a 4-byte boundary
  const offset = Math.ceil(bytes.length / 4) * 4
  const copy = new Uint8Array(offset + table.length)
  copy.set(bytes)
  copy.set(table, offset)
  setTableRecord(copy, tag, { offset, length: table.length })
  return copy
}

export function getTable(bytes: Uint8Array, tag: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const record = findRecord(bytes, tag)
  const offset = view.getUint32(record + 8)
  return bytes.subarray(offset, offset + view.getUint32(record + 12))
}

/**
 * A version 2 `post` table of no glyphs and `padding` zeros, which a parser that reads glyph names
 * to the table's end reads as names
 */
export function createPostTable(bytes: Uint8Array, padding: number): Uint8Array {
  const table = new Uint8Array(34 + padding)
  table.set(getTable(bytes, 'post').subarray(0, 32))
  new DataView(table.buffer).setUint32(0, 0x00_02_00_00)
  return table
}

/**
 * An `HVAR` table without an advance mapping and with `itemCount` rows of 1-byte deltas for
 * `regionCount` regions, each peaking at 1 on all `axisCount` axes. The deltas alternate between 1
 * and -1, so an even region count varies no width
 */
export function createHvarTable({
  axisCount,
  regionCount,
  itemCount,
}: {
  axisCount: number
  regionCount: number
  itemCount: number
}): Uint8Array {
  const store = 20
  const regions = store + 12
  const data = regions + 4 + regionCount * axisCount * 6
  const rows = data + 6 + regionCount * 2
  const table = new Uint8Array(rows + itemCount * regionCount)
  const view = new DataView(table.buffer)
  view.setUint16(0, 1)
  view.setUint32(4, store)
  view.setUint16(store, 1)
  view.setUint32(store + 2, regions - store)
  view.setUint16(store + 6, 1)
  view.setUint32(store + 8, data - store)
  view.setUint16(regions, axisCount)
  view.setUint16(regions + 2, regionCount)
  for (let index = 0; index < regionCount * axisCount; index++) {
    // A start of 0, then a peak and an end of 1 as 2.14 numbers
    view.setInt16(regions + 4 + index * 6 + 2, 16_384)
    view.setInt16(regions + 4 + index * 6 + 4, 16_384)
  }
  view.setUint16(data, itemCount)
  view.setUint16(data + 4, regionCount)
  for (let index = 0; index < regionCount; index++) {
    view.setUint16(data + 6 + index * 2, index)
  }
  for (let item = 0; item < itemCount; item++) {
    for (let index = 0; index < regionCount; index++) {
      view.setInt8(rows + item * regionCount + index, index % 2 === 0 ? 1 : -1)
    }
  }
  return table
}

/**
 * A `name` table whose `count` records all point at the same `length` bytes of its
 * `storageLength` zeros of storage
 */
export function createNameTable({
  count,
  length,
  offset = 0,
  storageLength,
}: {
  count: number
  length: number
  offset?: number
  storageLength: number
}): Uint8Array {
  const storageOffset = 6 + count * 12
  const table = new Uint8Array(storageOffset + storageLength)
  const view = new DataView(table.buffer)
  view.setUint16(2, count)
  view.setUint16(4, storageOffset)
  for (let index = 0; index < count; index++) {
    const record = 6 + index * 12
    // Windows, Unicode BMP, US English, the family name
    view.setUint16(record, 3)
    view.setUint16(record + 2, 1)
    view.setUint16(record + 4, 0x4_09)
    view.setUint16(record + 6, 1)
    view.setUint16(record + 8, length)
    view.setUint16(record + 10, offset)
  }
  return table
}

/**
 * A WOFF2 transformed `glyf` table of one glyph of `contours` contours of 65,535 points each. It's
 * mostly zeros, which brotli compresses to almost nothing
 */
export function createTransformedGlyf(contours: number): Uint8Array {
  const pointsPerContour = 65_535
  const points = contours * pointsPerContour
  // A contour count of 2 bytes, and each contour's point count as a 255UInt16: 253, then 2 bytes
  const nContours = [contours >> 8, contours & 0xff]
  const nPoints = Array.from({ length: contours }, () => [253, 0xff, 0xff]).flat()
  // The glyph stream ends with the instruction length, a 255UInt16 of 0
  const streamSizes = [nContours.length, nPoints.length, points, points + 1, 0, 0, 0]
  const table = new Uint8Array(36 + streamSizes.reduce((sum, size) => sum + size, 0))
  const view = new DataView(table.buffer)
  view.setUint16(4, 1)
  for (const [index, size] of streamSizes.entries()) {
    view.setUint32(8 + index * 4, size)
  }
  table.set(nContours, 36)
  table.set(nPoints, 36 + nContours.length)
  return table
}

/**
 * A copy of a font with a table moved to its unpadded end, and `head.checkSumAdjustment`
 * recomputed so the file's checksum stays valid
 */
export function moveTableToEnd(bytes: Uint8Array, tag: string): Uint8Array {
  const moved = replaceTable(bytes, tag, getTable(bytes, tag))
  setUint32(moved, 'head', 8, 0)
  const padded = new Uint8Array(Math.ceil(moved.length / 4) * 4)
  padded.set(moved)
  const view = new DataView(padded.buffer)
  let sum = 0
  for (let offset = 0; offset < padded.length; offset += 4) {
    sum = (sum + view.getUint32(offset)) >>> 0
  }
  setUint32(moved, 'head', 8, (0xb1_b0_af_ba - sum) >>> 0)
  return moved
}

/**
 * An `MVAR` table of a value record for each of `deltas`, sorted by tag, and one region that peaks
 * at 1 on all `axisCount` axes
 */
export function createMvarTable({
  axisCount = 1,
  deltas,
}: {
  axisCount?: number
  deltas: ReadonlyArray<readonly [string, number]>
}): Uint8Array {
  const store = 12 + deltas.length * 8
  const regions = store + 12
  const data = regions + 4 + axisCount * 6
  const rows = data + 8
  const table = new Uint8Array(rows + deltas.length * 2)
  const view = new DataView(table.buffer)
  view.setUint16(0, 1)
  view.setUint16(6, 8)
  view.setUint16(8, deltas.length)
  view.setUint16(10, store)
  for (const [index, [tag, delta]] of deltas.entries()) {
    table.set(
      Array.from(tag, (char) => char.codePointAt(0) ?? 0),
      12 + index * 8,
    )
    view.setUint16(12 + index * 8 + 6, index)
    view.setInt16(rows + index * 2, delta)
  }
  view.setUint16(store, 1)
  view.setUint32(store + 2, regions - store)
  view.setUint16(store + 6, 1)
  view.setUint32(store + 8, data - store)
  view.setUint16(regions, axisCount)
  view.setUint16(regions + 2, 1)
  for (let axis = 0; axis < axisCount; axis++) {
    // A start of 0, then a peak and an end of 1 as 2.14 numbers
    view.setInt16(regions + 4 + axis * 6 + 2, 16_384)
    view.setInt16(regions + 4 + axis * 6 + 4, 16_384)
  }
  // One item for each record, one word delta, and one region, of index 0
  view.setUint16(data, deltas.length)
  view.setUint16(data + 2, 1)
  view.setUint16(data + 4, 1)
  return table
}
