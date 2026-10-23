import { brotliDecompressSync } from 'node:zlib'

import { create, type Os2Table, type Font as ParsedFont } from 'fontkitten'

import { describeValue, formatMessage, formatNames, getErrorCode } from '@gpahal/std/errors'

import { markReadAtOpticalSize, OPTICAL_SIZE } from '@/internal/optical-size'
import { PREFIX } from '@/internal/options'
import type { FontMetrics } from '@/internal/types'
import { LATIN_WEIGHTINGS } from '@/internal/weightings'

/**
 * The extension of a font file's path, lowercase
 */
export type FontExtension = 'ttf' | 'otf' | 'woff2'

/**
 * The tables fontkitten parses but doesn't type, and the private fields read. `package.json` pins
 * fontkitten exactly, and `tests/upstream.test.ts` fails if an upgrade moves a private field
 */
type FontTables = {
  head?: { macStyle: { italic: boolean } } | undefined
  /**
   * fontkitten's private `cmap` reader, whose `lookup` gives a code point's glyph id, or 0
   */
  _cmapProcessor?: { lookup: (codePoint: number) => number } | undefined
}

type Font = ParsedFont & FontTables

type Fail = (description: string, cause?: unknown) => Error

/**
 * The signatures read, by their first 4 bytes as latin1
 */
const TRUETYPE = '\0\u{1}\0\0'
const CFF = 'OTTO'
const WOFF2 = 'wOF2'

/**
 * The signatures each extension takes. An `.otf` file can have TrueType outlines
 */
const EXTENSION_SIGNATURES: Readonly<Record<FontExtension, ReadonlyArray<string>>> = {
  ttf: [TRUETYPE],
  otf: [CFF, TRUETYPE],
  woff2: [WOFF2],
}

const SIGNATURE_NAMES: Readonly<Record<string, string>> = {
  [TRUETYPE]: 'a TrueType font',
  [CFF]: 'a CFF font',
  [WOFF2]: 'a WOFF2 font',
}

/**
 * The most tables a font may have. Fonts have about 10 to 30
 */
const MAX_TABLES = 64

/**
 * The tables a font must have
 */
const REQUIRED_TABLES = ['head', 'hhea', 'maxp', 'hmtx', 'cmap', 'name', 'OS/2', 'post'] as const

/**
 * The required tables that must decode, in the order they're decoded: `hmtx` reads `hhea` and
 * `maxp`. fontkitten decodes a table in full, without limits, on its first read, so a table added
 * here must be one whose decoding is bounded by its size. The others are read from their bytes
 * with bounds: `post`, whose version 2 glyph names fontkitten reads to the table's end, `HVAR` and
 * `MVAR`. `name` is never read, and fontkitten decodes it only through `getName`, `fvar` or a
 * collection's `getFont`, so {@link readAxes} reads the axes
 */
const DECODED_TABLES = ['head', 'hhea', 'maxp', 'hmtx', 'cmap', 'OS/2'] as const

/**
 * The tables read from their bytes. `cmap`'s encoding records are checked before fontkitten decodes
 * it
 */
const READ_TABLES: ReadonlySet<string> = new Set([
  'cmap',
  'hmtx',
  'post',
  'fvar',
  'avar',
  'HVAR',
  'MVAR',
])
const METRIC_TABLES: ReadonlySet<string> = new Set([...DECODED_TABLES, ...READ_TABLES])

/**
 * The most variation axes a font may have. Fonts have up to about 15, and each region of an
 * `HVAR` table has a range on every axis
 */
const MAX_AXES = 64

/**
 * The most value records an `MVAR` table may have. About 35 tags are registered
 */
const MAX_MVAR_RECORDS = 64

/**
 * The most encoding records a `cmap` table may have. Fonts have under about 10
 */
const MAX_CMAP_RECORDS = 64

/**
 * The platform and encoding IDs of the Unicode `cmap` subtables fontkitten reads, as
 * `${platformId},${encodingId}`. Without one, it decodes the subtable of every record while it looks
 * for a legacy encoding, which a format 2 subtable makes slow and large
 */
const UNICODE_CMAP_ENCODINGS: ReadonlySet<string> = new Set([
  '3,10',
  '0,6',
  '0,4',
  '3,1',
  '0,3',
  '0,2',
  '0,1',
  '0,0',
])

/**
 * The `MVAR` tags of the ascender, descender and line gap, which vary `hhea`'s and OS/2's typo
 * metrics, and of OS/2's `usWinAscent` and `usWinDescent`
 */
const MVAR_TAGS = ['hasc', 'hdsc', 'hlgp', 'hcla', 'hcld'] as const

type MvarTag = (typeof MVAR_TAGS)[number]

const MVAR_TAGS_BY_NAME: ReadonlyMap<string, MvarTag> = new Map(MVAR_TAGS.map((tag) => [tag, tag]))

/**
 * The registered axes a regular face can vary on, with the default each must have, if any. A
 * variable font is read at its default instance, which must be the regular face, but for `wght`,
 * which is set to {@link REGULAR_WEIGHT}, and `opsz`: see {@link OPTICAL_SIZE}. Other axes, such
 * as Roboto Flex's `XOPQ`, are read at their default, as browsers render them without
 * `font-variation-settings`
 */
const AXIS_DEFAULTS: ReadonlyMap<string, number | undefined> = new Map([
  ['wght', undefined],
  ['wdth', 100],
  ['opsz', undefined],
  ['ital', 0],
  ['slnt', 0],
  ['GRAD', 0],
])

/**
 * The weight of the regular face, which a `wght` axis is set to, and must include
 */
const REGULAR_WEIGHT = 400

/**
 * The axes whose default instance must be the upright face
 */
const UPRIGHT_AXES: ReadonlySet<string> = new Set(['ital', 'slnt'])

/**
 * The most bytes a font may decompress to
 */
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024

/**
 * The share of Latin text, by weight, whose glyphs a font may lack. Capsize measures such
 * characters with `.notdef`. 1% lets through a subset without the accented letters or a few rare
 * symbols, and rejects one without digits (1.6%) or without common punctuation, such as `,` and `.`
 * (1.6%) or the punctuation of an alphanumeric subset (3.1%)
 */
const MAX_MISSING_WEIGHT = 0.01

const MIN_UNITS_PER_EM = 16
const MAX_UNITS_PER_EM = 16_384

/**
 * A font's tables read as bytes, from its file or its decompressed WOFF2 stream
 */
type TableBytes = ReadonlyMap<string, Buffer>

/**
 * Parses a font file, which `label` names in messages, and reads its regular face's metrics. A
 * file's `extension` must match its signature
 *
 * @throws If fontkitten can't parse it, or the font isn't a single upright regular face whose
 *   widths can be read for Latin text (see the README's "Rejected inputs").
 */
export function readFontFile(
  bytes: Uint8Array,
  label: string,
  extension: FontExtension | undefined,
): FontMetrics {
  const fail: Fail = (description, cause) =>
    new FontRejection(
      formatMessage(PREFIX, [label], description),
      cause === undefined ? undefined : { cause },
    )
  try {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const signature = checkSignature(buffer, extension, fail)
    const { tables, sfnt } =
      signature === WOFF2
        ? checkWoff2(buffer, fail)
        : { tables: checkSfntDirectory(buffer, fail), sfnt: buffer }
    checkCmap(tables.get('cmap'), fail)
    const parsed = create(padShortMaxp(sfnt))
    // The signature check rules collections out, but the types need this
    if (parsed.isCollection) {
      throw fail('is a collection. Pass one of its fonts')
    }
    const font: Font = parsed
    checkTables(font, fail)
    const axes = readAxes(tables.get('fvar'), fail)
    checkAvar(tables.get('avar'), fail)
    checkRegularFace(font, tables, axes, fail)
    const metrics = readMetrics(font, tables, axes, label, fail)
    if (axes.some(({ tag }) => tag === 'opsz')) {
      markReadAtOpticalSize(metrics)
    }
    return metrics
  } catch (error) {
    // fontkitten parses tables lazily, so any read of a font can throw
    if (error instanceof FontRejection) {
      throw error
    }
    throw new Error(formatMessage(PREFIX, [label], 'failed to parse'), { cause: error })
  }
}

/**
 * A font's rejection, which isn't wrapped as a failure to parse
 */
class FontRejection extends Error {}

/**
 * The font's signature, which is TrueType, CFF or WOFF2, and matches `extension`
 *
 * @throws If the font is empty, or the signature is another or doesn't match the extension.
 */
function checkSignature(bytes: Buffer, extension: FontExtension | undefined, fail: Fail): string {
  if (bytes.length === 0) {
    throw fail('is empty')
  }
  const signature = bytes.toString('latin1', 0, 4)
  if (signature === 'wOFF') {
    throw fail("is a WOFF font, and WOFF isn't supported. Pass its WOFF2 or TTF")
  }
  if (signature === 'ttcf') {
    throw fail('is a collection. Pass one of its fonts')
  }
  const name = SIGNATURE_NAMES[signature]
  if (name === undefined) {
    throw fail("isn't a TTF, OTF or WOFF2 font")
  }
  if (extension !== undefined && !EXTENSION_SIGNATURES[extension].includes(signature)) {
    throw fail(`is ${name}, which doesn't match its .${extension} extension`)
  }
  return signature
}

function checkTableCount(numTables: number, fail: Fail): void {
  if (numTables < 1 || numTables > MAX_TABLES) {
    throw fail(`expected 1 to ${MAX_TABLES} tables, received ${describeValue(numTables)}`)
  }
}

const MIB = 1024 * 1024

function formatMib(bytes: number): string {
  return `${Math.ceil((bytes / MIB) * 10) / 10} MiB`
}

/**
 * Checks a TTF or OTF font's table directory, and gives its tables: a 12-byte header with the
 * table count at 4, then a 16-byte record for each table, of its tag, checksum, offset and length
 *
 * @throws If it has no or too many tables, the directory or a table runs past the file's end, or
 *   a tag repeats.
 */
function checkSfntDirectory(bytes: Buffer, fail: Fail): TableBytes {
  if (bytes.length < 12) {
    throw fail('is truncated: its header runs past the end of the file')
  }
  const numTables = bytes.readUInt16BE(4)
  checkTableCount(numTables, fail)
  if (12 + numTables * 16 > bytes.length) {
    throw fail('is truncated: its table directory runs past the end of the file')
  }
  const tables = new Map<string, Buffer>()
  for (let index = 0; index < numTables; index++) {
    const record = 12 + index * 16
    const tag = bytes.toString('latin1', record, record + 4)
    if (tables.has(tag)) {
      throw fail(`its table directory repeats the ${formatNames([tag])} table`)
    }
    const offset = bytes.readUInt32BE(record + 8)
    const length = bytes.readUInt32BE(record + 12)
    if (offset + length > bytes.length) {
      throw fail(`is truncated: its ${formatNames([tag])} table runs past the end of the file`)
    }
    tables.set(tag, bytes.subarray(offset, offset + length))
  }
  checkRequiredTables(tables, fail)
  return tables
}

/**
 * Decompresses WOFF2 once, bounded by the sum of its table directory's lengths and
 * {@link MAX_DECOMPRESSED_BYTES}, not by the header's `totalSfntSize`, which the spec treats as
 * informational. Copies only the tables read here, so the full stream can be collected before
 * measurement
 *
 * @throws A rejection for a malformed container, or another `Error` if its table directory or
 *   brotli stream fails to decode.
 */
function checkWoff2(bytes: Buffer, fail: Fail): { tables: TableBytes; sfnt: Buffer } {
  if (bytes.length < 48) {
    throw fail('is truncated: its header runs past the end of the file')
  }
  const length = bytes.readUInt32BE(8)
  if (length !== bytes.length) {
    throw fail(
      `its header declares ${length} bytes, but it has ${bytes.length}. Pass the complete file`,
    )
  }
  const flavor = bytes.toString('latin1', 4, 8)
  if (flavor === 'ttcf') {
    throw fail('is a collection. Pass one of its fonts')
  }
  if (flavor !== TRUETYPE && flavor !== CFF) {
    throw fail(`expected a WOFF2 flavor of TrueType or CFF, received ${describeValue(flavor)}`)
  }
  const numTables = bytes.readUInt16BE(12)
  checkTableCount(numTables, fail)
  const tooLarge = (received: string, cause?: unknown): Error =>
    fail(
      `expected a font that decompresses to at most ${formatMib(MAX_DECOMPRESSED_BYTES)}, received one that ${received}`,
      cause,
    )
  const { entries, end } = readWoff2Directory(bytes, numTables, fail)
  // The directory is checked before the stream is decompressed, so a font it rejects costs no
  // decompression
  const tags = new Set<string>()
  for (const { tag, transformed } of entries) {
    if (tags.has(tag)) {
      throw fail(`its table directory repeats the ${formatNames([tag])} table`)
    }
    if (transformed && METRIC_TABLES.has(tag)) {
      throw fail(
        `its ${formatNames([tag])} table is transformed, and only untransformed ${tag === 'hmtx' ? 'widths' : 'metric tables'} are read. Pass its TTF`,
      )
    }
    tags.add(tag)
  }
  checkRequiredTables(tags, fail)
  // Tables follow each other in the stream unpadded, so their lengths add up to its size
  const streamLength = entries.reduce((sum, { length }) => sum + length, 0)
  if (streamLength > MAX_DECOMPRESSED_BYTES) {
    throw tooLarge(`declares ${formatMib(streamLength)}`)
  }
  const streamEnd = end + bytes.readUInt32BE(20)
  if (streamEnd > bytes.length) {
    throw fail('is truncated: its compressed stream runs past the end of the file')
  }
  const stream = bytes.subarray(end, streamEnd)
  let decompressed: Buffer
  try {
    decompressed = brotliDecompressSync(stream, { maxOutputLength: Math.max(1, streamLength) })
  } catch (error) {
    if (getErrorCode(error) !== 'ERR_BUFFER_TOO_LARGE') {
      throw error
    }
    throw fail(`decompresses to more than the ${streamLength} bytes its tables declare`, error)
  }
  // As Google's reference decoder requires
  if (decompressed.length !== streamLength) {
    throw fail(
      `is truncated: its tables need ${streamLength} bytes, and its stream decompresses to ${decompressed.length}`,
    )
  }
  const tables = new Map<string, Buffer>()
  let offset = 0
  for (const { tag, length } of entries) {
    if (offset + length > decompressed.length) {
      throw fail(
        `is truncated: its ${formatNames([tag])} table runs past the end of the decompressed stream`,
      )
    }
    tables.set(tag, decompressed.subarray(offset, offset + length))
    offset += length
  }
  return {
    sfnt: createSfnt(flavor, tables),
    tables: new Map(
      [...tables]
        .filter(([tag]) => READ_TABLES.has(tag))
        .map(([tag, table]) => [tag, Buffer.from(table)]),
    ),
  }
}

/**
 * fontkitten's metric getters read only {@link DECODED_TABLES}: `unitsPerEm` reads `head`, the
 * vertical metrics read `hhea`, and `_cmapProcessor` reads `cmap`. It doesn't verify checksums
 */
function createSfnt(flavor: string, tables: TableBytes): Buffer {
  const entries = DECODED_TABLES.toSorted((a, b) => (a < b ? -1 : Number(a > b))).map(
    (tag) => [tag, tables.get(tag) ?? Buffer.alloc(0)] as const,
  )
  const numTables = entries.length
  const paddedSize = (length: number): number => Math.ceil(length / 4) * 4
  let offset = 12 + numTables * 16
  const sfnt = Buffer.alloc(
    offset + entries.reduce((size, [, table]) => size + paddedSize(table.length), 0),
  )
  sfnt.write(flavor, 0, 'latin1')
  sfnt.writeUInt16BE(numTables, 4)
  const entrySelector = Math.floor(Math.log2(numTables))
  const searchRange = 2 ** entrySelector * 16
  sfnt.writeUInt16BE(searchRange, 6)
  sfnt.writeUInt16BE(entrySelector, 8)
  sfnt.writeUInt16BE(numTables * 16 - searchRange, 10)
  for (const [index, [tag, table]] of entries.entries()) {
    const record = 12 + index * 16
    sfnt.write(tag, record, 'latin1')
    sfnt.writeUInt32BE(offset, record + 8)
    sfnt.writeUInt32BE(table.length, record + 12)
    table.copy(sfnt, offset)
    offset += paddedSize(table.length)
  }
  return sfnt
}

/**
 * The bytes fontkitten reads for a `maxp` table, whatever its version
 */
const MAXP_READ_LENGTH = 32

/**
 * An sfnt whose `maxp` table can be decoded: fontkitten reads 32 bytes for CFF's 6-byte version
 * 0.5 table too, so one that ends less than 32 bytes before the end of the file fails to decode.
 * Copies it with zeros after its end to cover the overread, leaving the table's declared length,
 * and so what's validated, unchanged; a table of another length isn't padded, so a truncated one
 * still fails. `sfnt` has a checked directory. tests/upstream.canary.test.ts tracks the overread
 */
function padShortMaxp(sfnt: Buffer): Buffer {
  const numTables = sfnt.readUInt16BE(4)
  for (let index = 0; index < numTables; index++) {
    const record = 12 + index * 16
    if (sfnt.toString('latin1', record, record + 4) !== 'maxp') {
      continue
    }
    const offset = sfnt.readUInt32BE(record + 8)
    const end = offset + MAXP_READ_LENGTH
    const isShortCff =
      sfnt.readUInt32BE(record + 12) === 6 && sfnt.readUInt32BE(offset) === 0x00_00_50_00
    return isShortCff && end > sfnt.length
      ? Buffer.concat([sfnt, Buffer.alloc(end - sfnt.length)])
      : sfnt
  }
  return sfnt
}

/**
 * A WOFF2 table directory's entry: its tag, and its length in the stream, which is its transformed
 * length if it's transformed
 */
type Woff2Entry = { tag: string; length: number; transformed: boolean }

/**
 * The tags of the tables of WOFF2's known tags, by their index in the flags. Index 63, past the
 * list, marks a custom tag
 */
const WOFF2_KNOWN_TAGS: ReadonlyArray<string> = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
]

/**
 * A WOFF2 font's table directory, which follows its 48-byte header, and the offset after it. Each
 * entry is a flags byte, a tag unless the flags give a known one, the original length, and the
 * transformed length if the table is transformed. As the WOFF2 spec has it, the transform version
 * means what it does by the tag, so a custom tag of `glyf` counts as `glyf`
 */
function readWoff2Directory(
  bytes: Buffer,
  numTables: number,
  fail: Fail,
): { entries: Array<Woff2Entry>; end: number } {
  let offset = 48
  const checkLength = (length: number): void => {
    if (offset + length > bytes.length) {
      throw fail('is truncated: its table directory runs past the end of the file')
    }
  }
  const readByte = (): number => {
    checkLength(1)
    return bytes.readUInt8(offset++)
  }
  const readBase128 = (): number => {
    let value = 0
    for (let index = 0; index < 5; index++) {
      const byte = readByte()
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) {
        return value
      }
    }
    throw fail('its table directory has a UIntBase128 over 5 bytes')
  }
  const entries: Array<Woff2Entry> = []
  for (let index = 0; index < numTables; index++) {
    const flags = readByte()
    let tag = WOFF2_KNOWN_TAGS[flags & 0x3f]
    if (tag === undefined) {
      checkLength(4)
      tag = bytes.toString('latin1', offset, offset + 4)
      offset += 4
    }
    const isGlyfOrLoca = tag === 'glyf' || tag === 'loca'
    let length = readBase128()
    const transformVersion = flags >>> 6
    // `glyf` and `loca` are transformed by version 0, and other tables by other versions
    const transformed = isGlyfOrLoca ? transformVersion === 0 : transformVersion !== 0
    if (transformed) {
      length = readBase128()
    }
    entries.push({ tag, length, transformed })
  }
  return { entries, end: offset }
}

/**
 * @throws If a required table is missing.
 */
function checkRequiredTables(tags: Pick<ReadonlySet<string>, 'has'>, fail: Fail): void {
  const missing = REQUIRED_TABLES.find((tag) => !tags.has(tag))
  if (missing !== undefined) {
    throw fail(`has no ${formatNames([missing])} table`)
  }
}

/**
 * Checks a `cmap` table's encoding records before fontkitten decodes it: a 4-byte header with the
 * record count at 2, then an 8-byte record for each, of its platform ID, encoding ID and offset
 *
 * @throws If it's shorter than its records, has over {@link MAX_CMAP_RECORDS} of them, or none is
 *   of a Unicode encoding fontkitten reads.
 */
function checkCmap(cmap: Buffer | undefined, fail: Fail): void {
  const invalid = (): Error => fail(`its ${formatNames(['cmap'])} table fails to parse`)
  if (cmap === undefined || cmap.length < 4) {
    throw invalid()
  }
  const count = cmap.readUInt16BE(2)
  if (count > MAX_CMAP_RECORDS) {
    throw fail(
      `its ${formatNames(['cmap'])} table has ${count} encoding records, over the limit of ${MAX_CMAP_RECORDS}`,
    )
  }
  if (4 + count * 8 > cmap.length) {
    throw invalid()
  }
  const hasUnicode = Array.from({ length: count }, (_, index) => 4 + index * 8).some((record) =>
    UNICODE_CMAP_ENCODINGS.has(`${cmap.readUInt16BE(record)},${cmap.readUInt16BE(record + 2)}`),
  )
  if (!hasUnicode) {
    throw fail(
      `its ${formatNames(['cmap'])} table has no Unicode encoding record, and only Unicode encodings are read. Pass another font file`,
    )
  }
}

function checkTables(font: Font, fail: Fail): void {
  for (const tag of DECODED_TABLES) {
    // fontkitten gives `undefined` for a table that fails to decode, which
    // `tests/upstream.test.ts` checks
    if (Reflect.get(font, tag) === undefined) {
      throw fail(`its ${formatNames([tag])} table fails to parse`)
    }
  }
}

/**
 * @throws If the font's `wght` axis doesn't include 400, its default instance isn't otherwise the
 *   regular face, a static font's weight isn't 400, or it's italic or oblique.
 */
function checkRegularFace(
  font: Font,
  tables: TableBytes,
  axes: ReadonlyArray<Axis>,
  fail: Fail,
): void {
  for (const { tag, min, defaultValue, max } of axes) {
    if (tag === 'wght' && (REGULAR_WEIGHT < min || REGULAR_WEIGHT > max)) {
      throw fail(
        `has a ${formatNames([tag])} axis from ${min} to ${max}, and only the regular face, of weight ${REGULAR_WEIGHT}, is read. Pass a static regular font, or the family name`,
      )
    }
    const expectedDefault = AXIS_DEFAULTS.get(tag)
    if (expectedDefault === undefined || defaultValue === expectedDefault) {
      continue
    }
    const readValues = UPRIGHT_AXES.has(tag)
      ? 'only the regular face is read'
      : `only a default of ${expectedDefault} is read`
    throw fail(
      `has a ${formatNames([tag])} axis that defaults to ${defaultValue}, and ${readValues}. Pass a static regular font, or the family name`,
    )
  }
  const os2: Os2Table = font['OS/2']
  if (axes.every(({ tag }) => tag !== 'wght') && os2.usWeightClass !== REGULAR_WEIGHT) {
    throw fail(
      `has weight ${os2.usWeightClass}, and only the regular face, of weight ${REGULAR_WEIGHT}, is read. Pass the regular font, or the family name`,
    )
  }
  if (
    os2.fsSelection.italic ||
    os2.fsSelection.oblique ||
    font.head?.macStyle.italic === true ||
    readItalicAngle(tables.get('post'), fail) !== 0
  ) {
    throw fail(
      'is italic or oblique, and only the upright regular face is read. Pass the upright font, or the family name',
    )
  }
}

/**
 * A `post` table's italic angle, a 16.16 fixed-point number at 4 of its 32-byte header. Read from
 * its bytes, as fontkitten decodes a version 2 table's glyph names to the table's end
 *
 * @throws If the table is shorter than its header.
 */
function readItalicAngle(post: Buffer | undefined, fail: Fail): number {
  if (post === undefined || post.length < 32) {
    throw fail(`its ${formatNames(['post'])} table fails to parse`)
  }
  return post.readInt32BE(4) / 65_536
}

/**
 * The metrics of a font at the instance {@link getInstanceVariation} gives: its widths, and its
 * ascent, descent and line gap from `hhea`, as Capsize reads them, varied by `MVAR`. Widths come
 * from `cmap`, `hmtx` and `HVAR`, never from glyph objects, which decode outlines: a WOFF2 font's
 * transformed `glyf` table decodes every outline on the first glyph
 *
 * @throws If a table it reads is malformed, a metric is out of range, or it lacks widths for over
 *   1% of Latin text.
 */
function readMetrics(
  font: Font,
  tables: TableBytes,
  axes: ReadonlyArray<Axis>,
  label: string,
  fail: Fail,
): FontMetrics {
  const hmtx = tables.get('hmtx')
  const { numberOfMetrics } = font.hhea
  if (hmtx === undefined || hmtx.length < numberOfMetrics * 4) {
    throw fail(`its ${formatNames(['hmtx'])} table fails to parse`)
  }
  if (numberOfMetrics === 0) {
    throw fail(
      `its ${formatNames(['hhea'])} table declares no glyph widths, so it or its ${formatNames(['hmtx'])} table looks corrupt. Pass another font file`,
    )
  }
  const cmap = font._cmapProcessor
  if (cmap === undefined) {
    throw new Error(formatMessage(PREFIX, ['`fontkitten`'], 'has no `_cmapProcessor` to read'))
  }
  const variation = getInstanceVariation(tables, axes, fail)
  // Each of the first `numberOfMetrics` glyphs has an advance and a side bearing of 2 bytes each,
  // and the glyphs after them have the last advance
  const getAdvance = (glyphId: number): number => {
    const advance = hmtx.readUInt16BE(Math.min(glyphId, numberOfMetrics - 1) * 4)
    return variation === undefined ? advance : advance + variation.getAdvanceDelta(glyphId)
  }
  let missing = ''
  let missingCount = 0
  let missingWeight = 0
  let xWidthAvg = 0
  for (const [character, weighting] of LATIN_WEIGHTINGS) {
    // A character without a glyph is measured by `.notdef`, glyph 0, as Capsize does, and a glyph
    // without a positive width adds nothing
    const glyphId = cmap.lookup(character.codePointAt(0) ?? 0)
    const advance = getAdvance(glyphId)
    if (glyphId === 0 || !(advance > 0)) {
      missing += character
      missingCount++
      missingWeight += weighting
    }
    xWidthAvg += Math.max(0, advance) * weighting
  }
  // Without a single Latin glyph, a broken `cmap` or `hmtx` table is likelier than an icon font
  if (missingCount === LATIN_WEIGHTINGS.length) {
    throw fail(
      `has no glyph of a positive width for any character of Latin text, so its ${formatNames(['cmap'])} or ${formatNames(['hmtx'])} table looks corrupt, or it covers only other scripts. Pass the full font`,
    )
  }
  // Rounded to the weightings' 4 decimals, since their float sum can land just over the limit
  if (Math.round(missingWeight * 10_000) / 10_000 > MAX_MISSING_WEIGHT) {
    throw fail(
      `lacks glyphs of a positive width for ${Math.round(missingWeight * 1000) / 10}% of Latin text (missing: ${JSON.stringify(missing)}). Pass its latin subset or the full font. Icon fonts aren't supported`,
    )
  }
  // MVAR's `hasc`, `hdsc` and `hlgp` name OS/2's typo metrics, but FreeType and HarfBuzz, which
  // browsers render with, apply them to whichever metrics they read, `hhea`'s included, even when
  // those differ from OS/2's. Rounded as an instance's `hhea` values are
  const vary = (value: number, tag: MvarTag): number =>
    Math.round(value + (variation?.metricDeltas[tag] ?? 0))
  const metrics: FontMetrics = {
    unitsPerEm: font.unitsPerEm,
    xWidthAvg: Math.round(xWidthAvg),
    ascent: vary(font.ascent, 'hasc'),
    // As for a family, a positive descent is read below the baseline, as Capsize reads it
    descent: -Math.abs(vary(font.descent, 'hdsc')),
    lineGap: vary(font.lineGap, 'hlgp'),
  }
  const checks: ReadonlyArray<
    [Exclude<keyof FontMetrics, 'windowsLineHeightRatio'>, string, (value: number) => boolean]
  > = [
    [
      'unitsPerEm',
      `an integer from ${MIN_UNITS_PER_EM} to ${MAX_UNITS_PER_EM}`,
      (value) =>
        Number.isSafeInteger(value) && value >= MIN_UNITS_PER_EM && value <= MAX_UNITS_PER_EM,
    ],
    ['ascent', 'a number over 0', (value) => value > 0],
    ['lineGap', 'a number of 0 or more', (value) => value >= 0],
    ['xWidthAvg', 'a number over 0', (value) => value > 0],
  ]
  for (const [key, expected, isValid] of checks) {
    const value = metrics[key]
    if (!Number.isFinite(value) || !isValid(value)) {
      throw new FontRejection(
        formatMessage(
          PREFIX,
          [label, `\`${key}\``],
          `expected ${expected}, received ${describeValue(value)}`,
        ),
      )
    }
  }
  const windowsLineHeightRatio = getWindowsLineHeightRatio(font['OS/2'], metrics, vary)
  if (windowsLineHeightRatio !== undefined) {
    metrics.windowsLineHeightRatio = windowsLineHeightRatio
  }
  return metrics
}

/**
 * How far the line box DirectWrite gives may differ from `hhea`'s, as a share of it, before the
 * ratio is reported
 */
const MAX_WINDOWS_LINE_HEIGHT_DIFFERENCE = 0.01

/**
 * The height of the line box DirectWrite, which Chrome, Edge and Firefox on Windows render with,
 * gives the font, over that of `metrics`, from `hhea`, when the two differ by over 1%. DirectWrite
 * reads OS/2's typo metrics when `USE_TYPO_METRICS` is set. When it isn't, it reads `usWinAscent`
 * plus `usWinDescent`, and adds a line gap that makes the box at least the `hhea` one, as GDI's
 * external leading does. `undefined` for a box that can't be read, as of a truncated version 0
 * OS/2 table
 */
function getWindowsLineHeightRatio(
  os2: Os2Table,
  metrics: FontMetrics,
  vary: (value: number, tag: MvarTag) => number,
): number | undefined {
  const hheaLineHeight = metrics.ascent - metrics.descent + metrics.lineGap
  const windowsLineHeight = os2.fsSelection.useTypoMetrics
    ? vary(os2.typoAscender, 'hasc') +
      Math.abs(vary(os2.typoDescender, 'hdsc')) +
      vary(os2.typoLineGap, 'hlgp')
    : Math.max(vary(os2.winAscent, 'hcla') + vary(os2.winDescent, 'hcld'), hheaLineHeight)
  const ratio = windowsLineHeight / hheaLineHeight
  return Number.isFinite(ratio) &&
    ratio > 0 &&
    Math.abs(ratio - 1) > MAX_WINDOWS_LINE_HEIGHT_DIFFERENCE
    ? ratio
    : undefined
}

/**
 * A font's variation from its default instance
 */
type Variation = {
  /**
   * The change to a glyph's advance, by its id
   */
  getAdvanceDelta: (glyphId: number) => number
  /**
   * The changes to the metrics of {@link MVAR_TAGS} by `MVAR`
   */
  metricDeltas: Readonly<Record<MvarTag, number>>
}

type Axis = { tag: string; min: number; defaultValue: number; max: number }

/**
 * The value an axis is read at: {@link REGULAR_WEIGHT} for `wght`, which {@link checkRegularFace}
 * checks the axis includes, {@link OPTICAL_SIZE} clamped to the axis for `opsz`, and the default
 * for the others: {@link checkRegularFace} checks those of registered axes are the regular face's
 */
function getReadValue({ tag, min, defaultValue, max }: Axis): number {
  if (tag === 'wght') {
    return REGULAR_WEIGHT
  }
  return tag === 'opsz' ? Math.min(Math.max(OPTICAL_SIZE, min), max) : defaultValue
}

/**
 * The variation that sets every axis to its {@link getReadValue}, in one normalized coordinate for
 * each axis, mapped through `avar`. `undefined` when that's the default instance
 *
 * @throws If it has to be varied without an `HVAR` table: a TrueType font's widths would then vary
 *   by its `gvar` outlines. If the `HVAR` or `MVAR` region list's axis count isn't `fvar`'s, or the
 *   `MVAR` table is malformed.
 */
function getInstanceVariation(
  tables: TableBytes,
  axes: ReadonlyArray<Axis>,
  fail: Fail,
): Variation | undefined {
  const values = axes.map((axis) => getReadValue(axis))
  const varied = axes.flatMap((axis, index) =>
    values[index] === axis.defaultValue ? [] : { ...axis, value: values[index] ?? 0 },
  )
  if (varied.length === 0) {
    return undefined
  }
  const hvar = tables.get('HVAR')
  if (hvar === undefined) {
    const settings = varied.map(({ tag, value }) => `${formatNames([tag])} ${value}`).join(' and ')
    const defaults = varied.map(({ defaultValue }) => defaultValue).join(' and ')
    throw fail(
      `is read at ${settings}, away from its ${varied.length === 1 ? 'default' : 'defaults'} of ${defaults}, and has no ${formatNames(['HVAR'])} table to vary its widths by. Pass a static regular font, or the family name`,
    )
  }
  // Normalized to -1 at the axis's minimum, 0 at its default and 1 at its maximum. An axis at its
  // default is 0 even when a bound is its default too
  const coords = axes.map(({ min, defaultValue, max }, index) => {
    const value = values[index] ?? defaultValue
    if (value === defaultValue) {
      return 0
    }
    return value < defaultValue
      ? (value - defaultValue) / (defaultValue - min)
      : (value - defaultValue) / (max - defaultValue)
  })
  applyAvar(tables.get('avar'), coords)
  const store = hvar.subarray(hvar.readUInt32BE(4))
  const scalars = getStoreScalars('HVAR', store, coords, fail)
  return {
    getAdvanceDelta: (glyphId) => readHvarDelta(hvar, store, glyphId, scalars),
    metricDeltas: readMvarDeltas(tables.get('MVAR'), coords, fail),
  }
}

/**
 * How much each region of an item variation store of the `tag` table applies at `coords`
 *
 * @throws If the store's region list's axis count isn't `fvar`'s.
 */
function getStoreScalars(
  tag: string,
  store: Buffer,
  coords: ReadonlyArray<number>,
  fail: Fail,
): Array<number> {
  const regions = store.subarray(store.readUInt32BE(2))
  const axisCount = regions.readUInt16BE(0)
  if (axisCount !== coords.length) {
    throw fail(
      `its ${formatNames([tag])} table's region list has ${axisCount} axes, and ${formatNames(['fvar'])} has ${coords.length}`,
    )
  }
  return getRegionScalars(regions, coords)
}

function getZeroDeltas(): Record<MvarTag, number> {
  return { hasc: 0, hdsc: 0, hlgp: 0, hcla: 0, hcld: 0 }
}

/**
 * The changes to the metrics of {@link MVAR_TAGS} by an `MVAR` table at `coords`, 0 for
 * each it has no record of. Its 12-byte header holds the version, the record size at 6, the record
 * count at 8 and the item variation store's offset at 10, which is 0 without one. Each record,
 * sorted by tag, starts with a tag, then the outer and inner indexes of its delta in the store
 *
 * @throws If the table is malformed or has over {@link MAX_MVAR_RECORDS} records, or the store's
 *   region list's axis count isn't `fvar`'s.
 */
function readMvarDeltas(
  mvar: Buffer | undefined,
  coords: ReadonlyArray<number>,
  fail: Fail,
): Record<MvarTag, number> {
  if (mvar === undefined) {
    return getZeroDeltas()
  }
  const invalid = (cause?: unknown): Error =>
    fail(`its ${formatNames(['MVAR'])} table fails to parse`, cause)
  if (mvar.length < 12) {
    throw invalid()
  }
  const recordSize = mvar.readUInt16BE(6)
  const recordCount = mvar.readUInt16BE(8)
  if (recordCount > MAX_MVAR_RECORDS) {
    throw fail(
      `its ${formatNames(['MVAR'])} table has ${recordCount} value records, over the limit of ${MAX_MVAR_RECORDS}`,
    )
  }
  const storeOffset = mvar.readUInt16BE(10)
  if (
    mvar.readUInt16BE(0) !== 1 ||
    (recordCount > 0 && recordSize < 8) ||
    12 + recordCount * recordSize > mvar.length ||
    storeOffset > mvar.length
  ) {
    throw invalid()
  }
  const deltas = getZeroDeltas()
  if (storeOffset === 0) {
    return deltas
  }
  const store = mvar.subarray(storeOffset)
  try {
    const scalars = getStoreScalars('MVAR', store, coords, fail)
    for (let index = 0; index < recordCount; index++) {
      const record = 12 + index * recordSize
      const tag = MVAR_TAGS_BY_NAME.get(mvar.toString('latin1', record, record + 4))
      if (tag === undefined) {
        continue
      }
      const outer = mvar.readUInt16BE(record + 4)
      const inner = mvar.readUInt16BE(record + 6)
      deltas[tag] = readItemDelta(store, outer, inner, scalars)
    }
  } catch (error) {
    // A read past the store's end
    if (error instanceof RangeError) {
      throw invalid(error)
    }
    throw error
  }
  return deltas
}

/**
 * An `fvar` table's axes: its axes' offset is at 4, their count at 8 and their size at 10, and
 * each axis is a tag, then its minimum, default and maximum as 16.16 fixed-point numbers
 *
 * @throws If it has over {@link MAX_AXES} axes, or an axis's default is outside its range.
 */
function readAxes(fvar: Buffer | undefined, fail: Fail): Array<Axis> {
  if (fvar === undefined) {
    return []
  }
  const count = fvar.readUInt16BE(8)
  if (count > MAX_AXES) {
    throw fail(`has ${count} variation axes, over the limit of ${MAX_AXES}`)
  }
  const offset = fvar.readUInt16BE(4)
  const size = fvar.readUInt16BE(10)
  return Array.from({ length: count }, (_, index) => {
    const axis = offset + index * size
    const tag = fvar.toString('latin1', axis, axis + 4).trimEnd()
    const min = fvar.readInt32BE(axis + 4) / 65_536
    const defaultValue = fvar.readInt32BE(axis + 8) / 65_536
    const max = fvar.readInt32BE(axis + 12) / 65_536
    if (min > defaultValue || defaultValue > max) {
      throw fail(
        `its ${formatNames(['fvar'])} table's ${formatNames([tag])} axis has a default of ${defaultValue} outside its range of ${min} to ${max}`,
      )
    }
    return { tag, min, defaultValue, max }
  })
}

/**
 * A 2.14 fixed-point number
 */
function readF2Dot14(bytes: Buffer, offset: number): number {
  return bytes.readInt16BE(offset) / 16_384
}

/**
 * Validates every segment map, even when the default instance needs no coordinate mapping
 */
function checkAvar(avar: Buffer | undefined, fail: Fail): void {
  if (avar === undefined) {
    return
  }
  const invalid = (): Error => fail(`its ${formatNames(['avar'])} table fails to parse`)
  if (avar.length < 8) {
    throw invalid()
  }
  const majorVersion = avar.readUInt16BE(0)
  if (majorVersion !== 1) {
    throw fail(
      `has an ${formatNames(['avar'])} table of version ${majorVersion}, which isn't read. Pass a static regular font, or the family name`,
    )
  }
  let offset = 8
  const axisCount = avar.readUInt16BE(6)
  for (let axis = 0; axis < axisCount; axis++) {
    if (offset + 2 > avar.length) {
      throw invalid()
    }
    offset += 2 + avar.readUInt16BE(offset) * 4
    if (offset > avar.length) {
      throw invalid()
    }
  }
}

/**
 * Maps normalized coordinates through an `avar` table's segment maps: its axis count is at 6, and
 * each axis's map is a count, then pairs of 2.14 numbers from and to which it maps piecewise
 * linearly
 */
function applyAvar(avar: Buffer | undefined, coords: Array<number>): void {
  if (avar === undefined) {
    return
  }
  let offset = 8
  const axisCount = Math.min(avar.readUInt16BE(6), coords.length)
  for (let axis = 0; axis < axisCount; axis++) {
    const count = avar.readUInt16BE(offset)
    // eslint-disable-next-line no-loop-func -- `Array.from` calls it before `offset` changes
    const pairs = Array.from({ length: count }, (_, index) => ({
      from: readF2Dot14(avar, offset + 2 + index * 4),
      to: readF2Dot14(avar, offset + 4 + index * 4),
    }))
    offset += 2 + count * 4
    const value = coords[axis] ?? 0
    const nextIndex = pairs.findIndex(({ from }) => value < from)
    const next = pairs[nextIndex]
    const previous = pairs[nextIndex - 1]
    if (next && previous) {
      coords[axis] =
        previous.to +
        ((value - previous.from) * (next.to - previous.to)) / (next.from - previous.from)
    } else {
      // At or past an end of the map
      const end = next ?? pairs.at(-1)
      coords[axis] = end ? end.to + (value - end.from) : value
    }
  }
}

/**
 * The change to a glyph's advance by an `HVAR` table, of its item variation store, where `scalars`
 * gives how much each of the store's regions applies: the store's offset is at 4 and the advance
 * mapping's at 8. Without a mapping, a glyph's id is its inner index, of outer index 0. A mapping's
 * format and entry format are bytes, then its count, of 2 bytes for format 0 and 4 for format 1,
 * then the entries, of the size and inner index bits its entry format gives
 */
function readHvarDelta(
  hvar: Buffer,
  store: Buffer,
  glyphId: number,
  scalars: ReadonlyArray<number>,
): number {
  const mapOffset = hvar.readUInt32BE(8)
  let outer = 0
  let inner = glyphId
  if (mapOffset !== 0) {
    const format = hvar.readUInt8(mapOffset)
    const entryFormat = hvar.readUInt8(mapOffset + 1)
    const count = format === 1 ? hvar.readUInt32BE(mapOffset + 2) : hvar.readUInt16BE(mapOffset + 2)
    if (count === 0) {
      return 0
    }
    const entrySize = ((entryFormat & 0x30) >> 4) + 1
    const innerBits = (entryFormat & 0x0f) + 1
    const entry = hvar.readUIntBE(
      mapOffset + (format === 1 ? 6 : 4) + Math.min(glyphId, count - 1) * entrySize,
      entrySize,
    )
    outer = Math.floor(entry / 2 ** innerBits)
    inner = entry % 2 ** innerBits
  }
  return readItemDelta(store, outer, inner, scalars)
}

/**
 * A delta of an item variation store, where `scalars` gives how much each region applies: its data
 * count is at 6 and the data's offsets from 8. Each data has an item count, a word count, whose top
 * bit makes words 4 bytes and the rest 2, and a region count, then the regions' indexes, then a
 * row of deltas for each item, words first
 */
function readItemDelta(
  store: Buffer,
  outer: number,
  inner: number,
  scalars: ReadonlyArray<number>,
): number {
  if (outer >= store.readUInt16BE(6)) {
    return 0
  }
  const data = store.subarray(store.readUInt32BE(8 + outer * 4))
  const wordDeltaCount = data.readUInt16BE(2)
  const regionCount = data.readUInt16BE(4)
  if (inner >= data.readUInt16BE(0)) {
    return 0
  }
  const isLong = (wordDeltaCount & 0x80_00) !== 0
  const wordCount = Math.min(wordDeltaCount & 0x7f_ff, regionCount)
  const [wordSize, shortSize] = isLong ? [4, 2] : [2, 1]
  const rowSize = wordCount * wordSize + (regionCount - wordCount) * shortSize
  let offset = 6 + regionCount * 2 + inner * rowSize
  let delta = 0
  for (let index = 0; index < regionCount; index++) {
    const size = index < wordCount ? wordSize : shortSize
    const value = data.readIntBE(offset, size)
    offset += size
    if (value !== 0) {
      delta += value * (scalars[data.readUInt16BE(6 + index * 2)] ?? 0)
    }
  }
  return delta
}

/**
 * How much each region of a variation region list applies at `coords`, from 0 to 1, computed once
 * as `coords` are fixed. The list has an axis count and a region count, then each region's start,
 * peak and end on each axis, as 2.14 numbers
 */
function getRegionScalars(regions: Buffer, coords: ReadonlyArray<number>): Array<number> {
  const axisCount = regions.readUInt16BE(0)
  return Array.from({ length: regions.readUInt16BE(2) }, (_, region) => {
    let scalar = 1
    for (let axis = 0; axis < axisCount; axis++) {
      const offset = 4 + (region * axisCount + axis) * 6
      const start = readF2Dot14(regions, offset)
      const peak = readF2Dot14(regions, offset + 2)
      const end = readF2Dot14(regions, offset + 4)
      // An axis the region doesn't vary on, or an invalid range, which the specification ignores
      if (peak === 0 || start > peak || peak > end || (start < 0 && end > 0)) {
        continue
      }
      const value = coords[axis] ?? 0
      if (value < start || value > end) {
        return 0
      }
      if (value !== peak) {
        scalar *= value < peak ? (value - start) / (peak - start) : (end - value) / (end - peak)
      }
    }
    return scalar
  })
}
