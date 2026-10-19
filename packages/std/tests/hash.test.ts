import { fnv1a52Hash, shortHash } from '@/hash'

const FNV_OFFSET_BASIS = 0xcb_f2_9c_e4_84_22_23_25n
const FNV_PRIME = 0x1_00_00_00_01_b3n
const MASK_64 = (1n << 64n) - 1n
const MASK_52 = (1n << 52n) - 1n

/**
 * The WTF-8 bytes of a string: `TextEncoder`'s UTF-8 for each code point, and a lone surrogate's
 * 3-byte encoding, which `TextEncoder` would replace with U+FFFD's
 */
function toWtf8(s: string): Array<number> {
  const encoder = new TextEncoder()
  const bytes: Array<number> = []
  for (const char of s) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff) {
      bytes.push(0xed, 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    } else {
      bytes.push(...encoder.encode(char))
    }
  }
  return bytes
}

/**
 * 64-bit FNV-1a with BigInt arithmetic, folded to 52 bits like {@link fnv1a52Hash}
 */
function referenceHash(s: string): number {
  let hash = FNV_OFFSET_BASIS
  for (const byte of toWtf8(s)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64
  }
  return Number((hash & MASK_52) ^ (hash >> 52n))
}

/**
 * A seeded generator of numbers in `[0, 1)`, so a failure can be reproduced (xorshift32)
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 4_294_967_296
  }
}

/**
 * Code points of each UTF-8 length, and both kinds of lone surrogate
 */
const SAMPLE_CHARS = ['a', '\0', 'é', 'ह', '\u{FFFD}', '😀', '\u{10FFFF}', '\u{D800}', '\u{DFFF}']

describe('fnv1a52Hash', () => {
  it('is 64-bit FNV-1a folded to 52 bits', () => {
    // FNV-1a 64 of 'a' is 0xaf63dc4c8601ec8c, and 0xaf6 XORed into the low 52 bits gives this
    expect(fnv1a52Hash('a')).toBe(0x3_dc_4c_86_01_e6_7a)
  })

  it('matches a BigInt implementation over random strings', () => {
    const random = createRandom(52)
    for (let i = 0; i < 500; i++) {
      const length = Math.floor(random() * 20)
      const s = Array.from({ length }, () => {
        const index = Math.floor(random() * (SAMPLE_CHARS.length + 1))
        // Otherwise any code unit, which may pair with its neighbour or be a lone surrogate
        return SAMPLE_CHARS[index] ?? String.fromCodePoint(Math.floor(random() * 0x1_00_00))
      }).join('')
      expect(fnv1a52Hash(s), JSON.stringify(s)).toBe(referenceHash(s))
    }
  })
})

describe('shortHash', () => {
  it('matches golden values, including for a 4-byte character and a lone surrogate', () => {
    // fnv1a52Hash in base 62, with digits, then lowercase, then uppercase letters
    expect(shortHash('')).toBe('3mQ6jB69c')
    expect(shortHash('😀')).toBe('jnaDUPicL')
    expect(shortHash('a\u{D800}')).toBe('3IzCt1xGf')
  })
})
