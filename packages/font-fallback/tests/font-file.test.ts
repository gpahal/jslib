import { statSync } from 'node:fs'
import { copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'

import { create } from 'fontkitten'

import {
  assertBuildIsCurrent,
  minCpuMs,
  runNode,
  withTmpProject,
} from '@gpahal/internal/node/testing'

import { getFontFallbacks, type FontFallback } from '@/index'
import { readFontFile } from '@/internal/parse'
import { LATIN_WEIGHTINGS } from '@/internal/weightings'

import {
  ALPHANUMERIC_PATH,
  CFF_PATH,
  CFF_REGULAR_PATH,
  FIGTREE_PATH,
  FIGTREE_WOFF2_PATH,
  HMTX_WOFF2_PATH,
  SEMIBOLD_PATH,
  VARIABLE_PATH,
} from './fixtures'
import {
  createHvarTable,
  createMvarTable,
  createNameTable,
  createPostTable,
  createTransformedGlyf,
  getRejection,
  getTable,
  moveTableToEnd,
  PREFIX,
  readBytes,
  renameTable,
  replaceTable,
  setFirstAxis,
  setTableRecord,
  setUint16,
  setUint32,
  toBase128,
  toWoff2,
  unmapCharacter,
} from './helpers'

async function getArialFallback(font: Uint8Array | URL): Promise<FontFallback> {
  const { fallbacks } = await getFontFallbacks(font, { name: 'Figtree', fallbacks: ['Arial'] })
  const [fallback] = fallbacks
  assert(fallback)
  return fallback
}

async function getFontRejection(bytes: Uint8Array): Promise<Error> {
  return getRejection(getFontFallbacks(bytes, { name: 'Figtree' }))
}

/**
 * Figtree's variable font with its `wght` axis defaulting to `weight`, or of these values
 */
async function readVariableAt(
  weight: number | readonly [number, number, number],
): Promise<Uint8Array> {
  const bytes = await readBytes(VARIABLE_PATH)
  setFirstAxis(bytes, 'wght', typeof weight === 'number' ? [300, weight, 900] : weight)
  return bytes
}

/**
 * Figtree's variable font with `tag` in place of `wght`, and an OS/2 `usWeightClass` of 400
 */
async function readVariableWithAxis(
  tag: string,
  values: readonly [number, number, number],
): Promise<Uint8Array> {
  const bytes = await readBytes(VARIABLE_PATH)
  setFirstAxis(bytes, tag, values)
  setUint16(bytes, 'OS/2', 4, 400)
  return bytes
}

async function copyAs(
  fontPath: string,
  fileName: string,
): Promise<AsyncDisposable & { url: URL; path: string }> {
  const project = await withTmpProject('font-fallback')
  const copyPath = path.join(project.dir, fileName)
  await copyFile(fontPath, copyPath)
  return {
    url: pathToFileURL(copyPath),
    path: copyPath,
    [Symbol.asyncDispose]: async () => project[Symbol.asyncDispose](),
  }
}

const MIB = 1024 * 1024
const TRUETYPE = '\0\u{1}\0\0'

/**
 * The known WOFF2 tag indexes of the tables a font needs, which the directory is checked for
 * before the stream is decompressed
 */
const REQUIRED_TAG_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7]

/**
 * A WOFF2 font whose brotli stream decodes to `size` zeros. `entries` are its directory entries'
 * bytes, by default one `head` table of `size` bytes; an empty entry is added for each other
 * required table
 */
function createWoff2Bomb(
  size: number,
  {
    entries = [[1, ...toBase128(size)]],
    flavor = TRUETYPE,
  }: { entries?: ReadonlyArray<ReadonlyArray<number>>; flavor?: string } = {},
): Uint8Array {
  const stream = brotliCompressSync(Buffer.alloc(size), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 1 },
  })
  const tagIndexes = new Set(entries.map(([flags = 0]) => flags & 0x3f))
  const allEntries = [
    ...entries,
    ...REQUIRED_TAG_INDEXES.filter((index) => !tagIndexes.has(index)).map((index) => [index, 0]),
  ]
  const directory = allEntries.flat()
  const bytes = new Uint8Array(48 + directory.length + stream.length)
  const view = new DataView(bytes.buffer)
  bytes.set(Buffer.from(`wOF2${flavor}`, 'latin1'))
  view.setUint32(8, bytes.length)
  view.setUint16(12, allEntries.length)
  view.setUint32(20, stream.length)
  bytes.set(directory, 48)
  bytes.set(stream, 48 + directory.length)
  return bytes
}

/**
 * A `cmap` table of `count` encoding records of one platform and encoding, all pointing at one
 * format 2 subtable, whose 256 `subHeaderKeys` fontkitten decodes into an array
 */
function createCmap(
  count: number,
  [platformId, encodingId]: readonly [number, number],
): Uint8Array {
  const subtable = 4 + count * 8
  const table = new Uint8Array(subtable + 6 + 512)
  const view = new DataView(table.buffer)
  view.setUint16(2, count)
  for (let index = 0; index < count; index++) {
    view.setUint16(4 + index * 8, platformId)
    view.setUint16(4 + index * 8 + 2, encodingId)
    view.setUint32(4 + index * 8 + 4, subtable)
  }
  view.setUint16(subtable, 2)
  view.setUint16(subtable + 2, 518)
  return table
}

const FONT_BYTES = 'font bytes'
const WOFF2_SIZE = statSync(FIGTREE_WOFF2_PATH).size

/**
 * Reads a copy of a font with `patch` applied
 */
function patched(fontPath: string, patch: (bytes: Uint8Array) => void): () => Promise<Uint8Array> {
  return async () => {
    const bytes = await readBytes(fontPath)
    patch(bytes)
    return bytes
  }
}

function expectFontError(description: string): Error {
  return new Error(`${PREFIX}: ${FONT_BYTES}: ${description}`)
}

describe('font file metrics', () => {
  it('match the metrics @capsizecss/metrics has for the family, from a URL, bytes or WOFF2', async () => {
    const figtree = await getArialFallback(pathToFileURL(FIGTREE_PATH))
    expect(await getArialFallback(await readBytes(FIGTREE_PATH))).toEqual(figtree)
    expect(await getArialFallback(pathToFileURL(FIGTREE_WOFF2_PATH))).toEqual(figtree)
    const { fallbacks } = await getFontFallbacks('Figtree', { fallbacks: ['Arial'] })
    expect(fallbacks).toEqual([figtree])
  })

  it("reads the vertical metrics from hhea, whatever OS/2's flags say, and a positive descent as below the baseline", async () => {
    const figtree = await getArialFallback(pathToFileURL(FIGTREE_PATH))
    const bytes = await readBytes(FIGTREE_PATH)
    // USE_TYPO_METRICS, bit 7 of `fsSelection` at 62, and `sTypoAscender` at 68
    setUint16(bytes, 'OS/2', 62, 0x80 | 0x40)
    setUint16(bytes, 'OS/2', 68, 1)
    // `hhea` descent at 6
    setUint16(bytes, 'hhea', 6, -readFontFile(bytes, 'font', 'ttf').descent)
    expect(await getArialFallback(bytes)).toEqual(figtree)
  })

  it.each([
    ['an ital axis that defaults to 0', 'ital', [0, 0, 1]],
    ['a wdth axis that defaults to 100', 'wdth', [75, 100, 100]],
    ['an unregistered axis', 'XTRA', [300, 400, 500]],
  ] as const)('reads a variable font with %s at its default instance', async (_, tag, values) => {
    expect(await getArialFallback(await readVariableWithAxis(tag, values))).toEqual(
      await getArialFallback(await readVariableWithAxis('opsz', [8, 8, 8])),
    )
  })
})

describe('CFF fonts', () => {
  async function getCustomFallbacks(bytes: Uint8Array): Promise<Array<FontFallback>> {
    return (await getFontFallbacks(bytes, { name: 'Custom', category: 'serif' })).fallbacks
  }

  it('reads a CFF font whose 6-byte maxp table ends the file, without changing its bytes', async () => {
    const bytes = await readBytes(CFF_REGULAR_PATH)
    expect(readFontFile(bytes, 'font', 'otf')).toEqual(
      readFontFile(await readBytes(FIGTREE_PATH), 'font', 'ttf'),
    )
    const moved = moveTableToEnd(bytes, 'maxp')
    expect(getTable(moved, 'maxp').byteOffset).toBe(moved.length - 6)
    const copy = new Uint8Array(moved)
    const fallbacks = await getCustomFallbacks(bytes)
    await expect(getCustomFallbacks(moved)).resolves.toEqual(fallbacks)
    await expect(getCustomFallbacks(toWoff2(moved))).resolves.toEqual(fallbacks)
    expect(moved).toEqual(copy)
  })

  it('rejects a maxp table at the end of the file that is shorter than 6 bytes', async () => {
    const moved = moveTableToEnd(await readBytes(CFF_REGULAR_PATH), 'maxp')
    const cut = moved.slice(0, -2)
    setTableRecord(cut, 'maxp', { length: 4 })
    await expect(getRejection(getCustomFallbacks(cut))).resolves.toEqual(
      expectFontError('its `maxp` table fails to parse'),
    )
  })
})

describe('rejected files', () => {
  it.each([
    ['wOFF', "is a WOFF font, and WOFF isn't supported. Pass its WOFF2 or TTF"],
    ['ttcf', 'is a collection. Pass one of its fonts'],
    ['true', "isn't a TTF, OTF or WOFF2 font"],
  ])('rejects the signature %j', async (signature, description) => {
    const bytes = await readBytes(FIGTREE_PATH)
    bytes.set(Buffer.from(signature, 'latin1'))
    await expect(getFontRejection(bytes)).resolves.toEqual(expectFontError(description))
  })

  it('rejects empty bytes without a cause, so a log has no `[cause]: undefined`', async () => {
    const error = await getFontRejection(new Uint8Array())
    expect(error.message).toBe(`${PREFIX}: ${FONT_BYTES}: is empty`)
    expect(Object.hasOwn(error, 'cause')).toBe(false)
  })

  it.each([
    [FIGTREE_WOFF2_PATH, 'f.ttf', "is a WOFF2 font, which doesn't match its .ttf extension"],
    [CFF_PATH, 'f.ttf', "is a CFF font, which doesn't match its .ttf extension"],
  ])('rejects %s named %s', async (fontPath, fileName, description) => {
    await using copy = await copyAs(fontPath, fileName)
    await expect(getFontFallbacks(copy.url, { name: 'Figtree' })).rejects.toThrow(
      new Error(`${PREFIX}: font ${copy.path}: ${description}`),
    )
  })

  it.each<[string, () => Promise<Uint8Array>, string]>([
    [
      'a WOFF2 stream past the end',
      patched(FIGTREE_WOFF2_PATH, (bytes) =>
        new DataView(bytes.buffer).setUint32(20, bytes.length),
      ),
      'is truncated: its compressed stream runs past the end of the file',
    ],
    [
      'a TTF table past the end',
      patched(FIGTREE_PATH, (bytes) => setTableRecord(bytes, 'name', { length: bytes.length })),
      'is truncated: its `name` table runs past the end of the file',
    ],
    [
      'a WOFF2 stream shorter than its tables',
      async () => createWoff2Bomb(16, { entries: [[1, ...toBase128(32)]] }),
      'is truncated: its tables need 32 bytes, and its stream decompresses to 16',
    ],
    [
      'a WOFF2 font shorter than its header declares',
      async () => (await readBytes(FIGTREE_WOFF2_PATH)).subarray(0, -10),
      `its header declares ${WOFF2_SIZE} bytes, but it has ${WOFF2_SIZE - 10}. Pass the complete file`,
    ],
    [
      'a repeated table',
      patched(FIGTREE_PATH, (bytes) => renameTable(bytes, 'prep', 'name')),
      'its table directory repeats the `name` table',
    ],
    [
      'a TTF of 65 tables',
      patched(FIGTREE_PATH, (bytes) => new DataView(bytes.buffer).setUint16(4, 65)),
      'expected 1 to 64 tables, received `65`',
    ],
    [
      'a transformed metric table',
      async () => createWoff2Bomb(16, { entries: [[0x41, 16, 16]] }),
      'its `head` table is transformed, and only untransformed metric tables are read. Pass its TTF',
    ],
    [
      'a WOFF2 flavor of true',
      async () => createWoff2Bomb(1024, { flavor: 'true' }),
      'expected a WOFF2 flavor of TrueType or CFF, received `"true"`',
    ],
    [
      'a WOFF2 font that declares over 64 MiB',
      async () => createWoff2Bomb(65 * MIB, { entries: [[1, ...toBase128(65 * MIB)]] }),
      'expected a font that decompresses to at most 64 MiB, received one that declares 65 MiB',
    ],
  ])('rejects %s', async (_, read, description) => {
    await expect(getFontRejection(await read())).resolves.toEqual(expectFontError(description))
  })

  it('rejects a WOFF2 font that decompresses past its tables without decompressing it all', async () => {
    const size = 256 * MIB
    const bytes = createWoff2Bomb(size, { entries: [[1, ...toBase128(16)]] })
    const rss = process.memoryUsage().rss
    const error = await getFontRejection(bytes)
    expect(error.message).toBe(
      `${PREFIX}: ${FONT_BYTES}: decompresses to more than the 16 bytes its tables declare`,
    )
    expect(error.cause).toMatchObject({ code: 'ERR_BUFFER_TOO_LARGE' })
    expect(process.memoryUsage().rss - rss).toBeLessThan(size / 8)
  })

  it('finds the brotli stream of a WOFF2 font by its directory, for a custom tag of glyf', async () => {
    // A `glyf` entry by a custom tag has a transformed length after its length. Taken as the
    // stream's start, its 0x3b is an empty brotli stream, which would hide the bomb after it
    const size = 256 * MIB
    const glyf = Array.from('glyf', (char) => char.codePointAt(0) ?? 0)
    const bytes = createWoff2Bomb(size, {
      entries: [
        [6, 16],
        [0x3f, ...glyf, 1, 0x3b],
      ],
    })
    const rss = process.memoryUsage().rss
    await expect(getFontRejection(bytes)).resolves.toEqual(
      expectFontError('decompresses to more than the 75 bytes its tables declare'),
    )
    expect(process.memoryUsage().rss - rss).toBeLessThan(size / 8)
  })

  it('rejects a WOFF2 font with a UIntBase128 over 5 bytes', async () => {
    const bytes = createWoff2Bomb(1024, { entries: [[1, 0x81, 0x80, 0x80, 0x80, 0x80, 0]] })
    await expect(getFontRejection(bytes)).resolves.toEqual(
      expectFontError('its table directory has a UIntBase128 over 5 bytes'),
    )
  })

  it('rejects a WOFF2 font whose table directory runs past the end of the file', async () => {
    const bytes = createWoff2Bomb(1024).slice(0, 50)
    new DataView(bytes.buffer).setUint32(8, bytes.length)
    await expect(getFontRejection(bytes)).resolves.toEqual(
      expectFontError('is truncated: its table directory runs past the end of the file'),
    )
  })

  it('rejects a WOFF2 font with a transformed hmtx table', async () => {
    await expect(
      getFontFallbacks(pathToFileURL(HMTX_WOFF2_PATH), { name: 'Poppins' }),
    ).rejects.toThrow(
      new Error(
        `${PREFIX}: font ${HMTX_WOFF2_PATH}: its \`hmtx\` table is transformed, and only untransformed widths are read. Pass its TTF`,
      ),
    )
  })
})

describe('rejected faces', () => {
  it.each([
    ['TTF', 'cmap'],
    ['TTF', 'OS/2'],
    // WOFF2 checks its directory for them before decompressing
    ['WOFF2', 'post'],
  ] as const)('rejects a %s font without a %s table', async (format, tag) => {
    const bytes = await readBytes(FIGTREE_PATH)
    renameTable(bytes, tag, `X${tag.slice(1)}`)
    await expect(getFontRejection(format === 'WOFF2' ? toWoff2(bytes) : bytes)).resolves.toEqual(
      expectFontError(`has no \`${tag}\` table`),
    )
  })

  it.each(['head', 'hmtx', 'OS/2'])('rejects a font whose %s table fails to parse', async (tag) => {
    const bytes = await readBytes(FIGTREE_PATH)
    // hmtx is read lazily, so it fails on no bytes rather than on bytes past the end
    setTableRecord(
      bytes,
      tag,
      tag === 'hmtx' ? { length: 0 } : { offset: bytes.length - 1, length: 1 },
    )
    await expect(getFontRejection(bytes)).resolves.toEqual(
      expectFontError(`its \`${tag}\` table fails to parse`),
    )
  })

  it('rejects a static font of another weight', async () => {
    await expect(getFontRejection(await readBytes(SEMIBOLD_PATH))).resolves.toEqual(
      expectFontError(
        'has weight 600, and only the regular face, of weight 400, is read. Pass the regular font, or the family name',
      ),
    )
  })

  it.each([
    [
      'OS/2 fsSelection italic flag',
      patched(FIGTREE_PATH, (bytes) => setUint16(bytes, 'OS/2', 62, 1)),
    ],
    // -10 as a 16.16 fixed-point number
    [
      'post italicAngle',
      patched(FIGTREE_PATH, (bytes) => setUint32(bytes, 'post', 4, 0xff_f6_00_00)),
    ],
  ])('rejects a font by its %s', async (_, read) => {
    await expect(getFontRejection(await read())).resolves.toEqual(
      expectFontError(
        'is italic or oblique, and only the upright regular face is read. Pass the upright font, or the family name',
      ),
    )
  })

  it.each([
    [
      'ital',
      [0, 1, 1],
      'has a `ital` axis that defaults to 1, and only the regular face is read. Pass a static regular font, or the family name',
    ],
    [
      'wdth',
      [75, 75, 100],
      'has a `wdth` axis that defaults to 75, and only a default of 100 is read. Pass a static regular font, or the family name',
    ],
  ] as const)('rejects a variable font by its %s axis default', async (tag, values, error) => {
    await expect(getFontRejection(await readVariableWithAxis(tag, values))).resolves.toEqual(
      expectFontError(error),
    )
  })

  it('rejects a font without glyphs for over 1% of Latin text', async () => {
    await expect(
      getFontFallbacks(pathToFileURL(ALPHANUMERIC_PATH), { name: 'Figtree' }),
    ).rejects.toThrow(
      new Error(
        `${PREFIX}: font ${ALPHANUMERIC_PATH}: lacks glyphs of a positive width for 3.1% of Latin text (missing: ${JSON.stringify(',\'.]-"()á=[é$:|/%;')}). Pass its latin subset or the full font. Icon fonts aren't supported`,
      ),
    )
  })

  it('measures a character without a glyph by .notdef, as Capsize does', async () => {
    const bytes = await readBytes(FIGTREE_PATH)
    const font = create(Buffer.from(bytes))
    assert(!font.isCollection)
    const notdef = font.getGlyph(0).advanceWidth
    let expected = 0
    for (const [character, weighting] of LATIN_WEIGHTINGS) {
      const glyph =
        character === ',' ? undefined : font.glyphForCodePoint(character.codePointAt(0) ?? 0)
      expected += (glyph?.advanceWidth ?? notdef) * weighting
    }
    unmapCharacter(bytes, ',')
    expect(Math.round(expected)).not.toBe(
      readFontFile(await readBytes(FIGTREE_PATH), 'font', 'ttf').xWidthAvg,
    )
    expect(readFontFile(bytes, 'font', 'ttf').xWidthAvg).toBe(Math.round(expected))
  })

  it.each<[string, () => Promise<Uint8Array>, string]>([
    [
      'a cmap table of over 64 encoding records',
      async () => replaceTable(await readBytes(FIGTREE_PATH), 'cmap', createCmap(65, [3, 1])),
      'its `cmap` table has 65 encoding records, over the limit of 64',
    ],
    [
      'a cmap table without a Unicode encoding record',
      async () => replaceTable(await readBytes(FIGTREE_PATH), 'cmap', createCmap(2, [1, 0])),
      'its `cmap` table has no Unicode encoding record, and only Unicode encodings are read. Pass another font file',
    ],
    [
      'an hhea table that declares no widths',
      patched(FIGTREE_PATH, (bytes) => setUint16(bytes, 'hhea', 34, 0)),
      'its `hhea` table declares no glyph widths, so it or its `hmtx` table looks corrupt. Pass another font file',
    ],
    [
      'a unitsPerEm of 15',
      patched(FIGTREE_PATH, (bytes) => setUint16(bytes, 'head', 18, 15)),
      '`unitsPerEm`: expected an integer from 16 to 16384, received `15`',
    ],
    [
      'a line gap of -1',
      patched(FIGTREE_PATH, (bytes) => setUint16(bytes, 'hhea', 8, -1)),
      '`lineGap`: expected a number of 0 or more, received `-1`',
    ],
  ])('rejects %s', async (_, read, description) => {
    await expect(getFontRejection(await read())).resolves.toEqual(expectFontError(description))
  })
})

/**
 * The Latin text width fontkitten measures with its own glyph objects, which `gvar` varies
 */
function measureWithFontkitten(bytes: Uint8Array, variation: Record<string, number>): number {
  const font = create(Buffer.from(bytes))
  assert(!font.isCollection)
  const instance = font.getVariation(variation)
  let width = 0
  for (const [character, weighting] of LATIN_WEIGHTINGS) {
    width += instance.glyphForCodePoint(character.codePointAt(0) ?? 0).advanceWidth * weighting
  }
  return width
}

/**
 * Figtree's variable font's metrics at weight 400, from fontTools 4: its weighted advances sum to
 * 443.7945 at the default instance, of weight 300, and to 449.1221 at `wght` 400 with the `HVAR`
 * deltas. `instancer`, which rounds each advance it varies by `gvar`, gives 449.2651
 */
const WEIGHT_400_METRICS = {
  unitsPerEm: 1000,
  xWidthAvg: 449,
  ascent: 950,
  descent: -250,
  lineGap: 0,
}

const STATIC_FONT_HINT = 'Pass a static regular font, or the family name'

describe('weight', () => {
  it('reads a variable font whose wght axis defaults to 300 at weight 400', async () => {
    const bytes = await readBytes(VARIABLE_PATH)
    expect(readFontFile(bytes, 'font', 'ttf')).toEqual(WEIGHT_400_METRICS)
    expect(Math.abs(449.2651 - measureWithFontkitten(bytes, { wght: 400 }))).toBeLessThanOrEqual(
      0.5,
    )
    // The static regular font rounds to the same metrics
    expect(await getArialFallback(bytes)).toEqual(
      await getArialFallback(pathToFileURL(FIGTREE_PATH)),
    )
    expect(await getArialFallback(toWoff2(bytes))).toEqual(await getArialFallback(bytes))
  })

  it.each([
    // fontTools 4's instancer gives 443.7945
    ['defaults to 700', [300, 700, 900], 444],
    // 400 normalizes to 0.5 and maps through avar to 0.43, as weight 600 does by default: 457.5207
    ['starts at its default of 100, through a nonlinear avar map', [100, 100, 700], 458],
  ] as const)(
    'reads a variable font whose wght axis %s at weight 400',
    async (_, values, xWidthAvg) => {
      const metrics = readFontFile(await readVariableAt(values), 'font', 'ttf')
      expect(metrics).toEqual({ ...WEIGHT_400_METRICS, xWidthAvg })
    },
  )

  it.each([
    [
      [500, 500, 900],
      `has a \`wght\` axis from 500 to 900, and only the regular face, of weight 400, is read. ${STATIC_FONT_HINT}`,
    ],
    [
      [500, 300, 900],
      "its `fvar` table's `wght` axis has a default of 300 outside its range of 500 to 900",
    ],
  ] as const)('rejects a variable font whose wght axis is %j', async (values, error) => {
    await expect(getFontRejection(await readVariableAt(values))).resolves.toEqual(
      expectFontError(error),
    )
  })
})

/**
 * Figtree's variable font with its `wght` axis of `values`, no `avar` map, and `mvar` in place of
 * its `STAT` table
 */
async function readVariableWithMvar(
  values: readonly [number, number, number],
  mvar: Uint8Array,
): Promise<Uint8Array> {
  const bytes = await readVariableAt(values)
  renameTable(bytes, 'avar', 'XVAR')
  renameTable(bytes, 'STAT', 'MVAR')
  return replaceTable(bytes, 'MVAR', mvar)
}

const MVAR_DELTAS = [
  ['hasc', 100],
  ['hdsc', -40],
  ['hlgp', 31],
  ['xhgt', 500],
] as const

describe('MVAR', () => {
  it('varies the ascent, descent and line gap at weight 400', async () => {
    const bytes = await readVariableWithMvar(
      [100, 100, 700],
      createMvarTable({ deltas: MVAR_DELTAS }),
    )
    // 400 normalizes to 0.5, so half of each delta applies. xhgt is ignored
    expect(readFontFile(bytes, 'font', 'ttf')).toEqual({
      ...WEIGHT_400_METRICS,
      xWidthAvg: 460,
      ascent: 1000,
      descent: -270,
      lineGap: 16,
    })
    expect(readFontFile(toWoff2(bytes), 'font', 'woff2')).toEqual(
      readFontFile(bytes, 'font', 'ttf'),
    )
  })
})

describe('optical size', () => {
  it('measures the widths of a variable font at opsz 16, as fontkitten does', async () => {
    const bytes = await readVariableWithAxis('opsz', [8, 12, 20])
    const atDefault = readFontFile(await readVariableWithAxis('opsz', [8, 16, 144]), 'font', 'ttf')
    const metrics = readFontFile(bytes, 'font', 'ttf')
    expect(metrics.xWidthAvg).not.toBe(atDefault.xWidthAvg)
    expect(
      Math.abs(metrics.xWidthAvg - measureWithFontkitten(bytes, { opsz: 16 })),
    ).toBeLessThanOrEqual(1)
    // Vertical metrics come from hhea, which doesn't vary
    expect(metrics).toMatchObject({
      ascent: atDefault.ascent,
      descent: atDefault.descent,
      lineGap: atDefault.lineGap,
    })
  })

  it('rejects a variable font whose HVAR region list has another axis count than fvar', async () => {
    const bytes = await readVariableWithAxis('opsz', [8, 12, 20])
    const hvar = new Uint8Array(getTable(bytes, 'HVAR'))
    const view = new DataView(hvar.buffer, hvar.byteOffset, hvar.byteLength)
    // The region list's axis count is at its start: the store's offset at 4, then the region
    // list's offset at 2 of the store
    const store = view.getUint32(4)
    view.setUint16(store + view.getUint32(store + 2), 2)
    await expect(getFontRejection(replaceTable(bytes, 'HVAR', hvar))).resolves.toEqual(
      expectFontError("its `HVAR` table's region list has 2 axes, and `fvar` has 1"),
    )
  })

  it('measures a variable font with a large HVAR region list in under a second', async () => {
    const bytes = await readVariableWithAxis('opsz', [8, 12, 20])
    const font = create(Buffer.from(bytes))
    assert(!font.isCollection)
    const hvar = createHvarTable({ axisCount: 1, regionCount: 16_384, itemCount: font.numGlyphs })
    const withHvar = replaceTable(bytes, 'HVAR', hvar)
    const [ms] = minCpuMs([() => readFontFile(withHvar, 'font', 'ttf')], 1)
    expect(ms).toBeLessThan(1000)
    // The deltas cancel out, so the widths are the default instance's
    const atDefault = readFontFile(await readVariableWithAxis('opsz', [8, 16, 20]), 'font', 'ttf')
    expect(readFontFile(withHvar, 'font', 'ttf').xWidthAvg).toBe(atDefault.xWidthAvg)
  })
})

describe('hostile fonts', () => {
  const BUILD_DIR = path.join(import.meta.dirname, '..', 'build')
  // Prints the Arial fallback's `sizeAdjust` or the error message of each file, and the CPU
  // milliseconds taken, which unlike wall-clock time leave out other processes
  const MEASURE_SCRIPT = `
import { readFileSync } from 'node:fs'
const [indexUrl, ...files] = process.argv.slice(1)
const { getFontFallbacks } = await import(indexUrl)
const start = process.cpuUsage()
const results = []
for (const file of files) {
  try {
    const { fallbacks } = await getFontFallbacks(new Uint8Array(readFileSync(file)), {
      name: 'Figtree',
      fallbacks: ['Arial'],
    })
    results.push({ sizeAdjust: fallbacks[0].sizeAdjust })
  } catch (error) {
    results.push({ message: error.message })
  }
}
const { user, system } = process.cpuUsage(start)
process.stdout.write(JSON.stringify({ results, ms: (user + system) / 1000 }))
`

  beforeAll(async () => assertBuildIsCurrent(BUILD_DIR))

  // Each font would exhaust the heap or take seconds with a parser that decodes what it skips. The
  // child process has 256 MiB of heap, so a font that exhausts it crashes the child, not the runner
  it('measures or rejects hostile fonts within the heap limit, without decoding what it skips', async () => {
    const figtree = await readBytes(FIGTREE_PATH)
    // fontkitten would decode the subtable of each Macintosh record: about 270 MB of heap
    const cmapBomb = toWoff2(replaceTable(figtree, 'cmap', createCmap(65_535, [1, 0])))
    // 18,311 records of the same 65,534 bytes would decode to 1.2 GB of strings
    const nameBomb = replaceTable(
      figtree,
      'name',
      createNameTable({ count: 18_311, length: 65_534, storageLength: 65_536 }),
    )
    // A parser that reads names to the table's end would read 16 MiB of empty names
    const postBomb = replaceTable(figtree, 'post', createPostTable(figtree, 16 * MIB))
    // 128 contours of 65,535 points would decode to over 8 million point objects
    const glyfBomb = toWoff2(figtree, { transformedGlyf: createTransformedGlyf(128) })

    await using project = await withTmpProject('font-fallback')
    const files = await Promise.all(
      [toWoff2(figtree), cmapBomb, nameBomb, postBomb, glyfBomb].map(async (bytes, index) => {
        const file = path.join(project.dir, `font-${index}`)
        await writeFile(file, bytes)
        return file
      }),
    )
    const { status, stdout, stderr } = await runNode([
      '--max-old-space-size=256',
      '--input-type=module',
      '--eval',
      MEASURE_SCRIPT,
      pathToFileURL(path.join(BUILD_DIR, 'index.js')).href,
      ...files,
    ])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    const { results, ms } = JSON.parse(stdout) as {
      results: Array<{ sizeAdjust?: number; message?: string }>
      ms: number
    }
    const { sizeAdjust } = await getArialFallback(pathToFileURL(FIGTREE_PATH))
    expect(results).toEqual([
      { sizeAdjust },
      {
        message: `${PREFIX}: ${FONT_BYTES}: its \`cmap\` table has 65535 encoding records, over the limit of 64`,
      },
      { sizeAdjust },
      { sizeAdjust },
      { sizeAdjust },
    ])
    expect(ms).toBeLessThan(10_000)
  })
})

/**
 * Figtree with OS/2 `fsSelection` (at 62) setting USE_TYPO_METRICS as given, and `usWinAscent` and
 * `usWinDescent` (at 74 and 76) of `win`
 */
async function readWithWindowsMetrics(
  useTypoMetrics: boolean,
  win?: readonly [number, number],
): Promise<Uint8Array> {
  const bytes = await readBytes(FIGTREE_PATH)
  setUint16(bytes, 'OS/2', 62, useTypoMetrics ? 0x80 | 0x40 : 0x40)
  if (win !== undefined) {
    setUint16(bytes, 'OS/2', 74, win[0])
    setUint16(bytes, 'OS/2', 76, win[1])
  }
  return bytes
}

describe('Windows line height', () => {
  it('reports the win box without USE_TYPO_METRICS, with the overrides still from hhea', async () => {
    // Roboto's win box is 2.4% taller than its hhea box: 973 + 256 = 1229 over 1200 here
    const bytes = await readWithWindowsMetrics(false, [973, 256])
    const result = await getFontFallbacks(bytes, { name: 'Figtree', fallbacks: ['Arial'] })
    expect(result.windowsLineHeightRatio).toBeCloseTo(1229 / 1200, 10)
    expect(result.fallbacks).toEqual([await getArialFallback(pathToFileURL(FIGTREE_PATH))])
  })

  it('reports the typo box with USE_TYPO_METRICS, line gap included', async () => {
    const bytes = await readWithWindowsMetrics(true, [900, 200])
    // sTypoLineGap at 72
    setUint16(bytes, 'OS/2', 72, 100)
    expect(readFontFile(bytes, 'font', 'ttf').windowsLineHeightRatio).toBeCloseTo(1300 / 1200, 10)
  })
})
