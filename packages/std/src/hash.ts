/*!
 * The FNV-1a hash below is ported from the 52-bit hash of fnv-plus
 * (https://github.com/tjwebb/fnv-plus/blob/master/index.js), simplified to hash bytes. fnv-plus is
 * licensed under the MIT License:
 *
 * Copyright (c) Travis Webb <me@traviswebb.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * Non-cryptographic hashes. Contract: any string. A collision is easy to find, so don't hash
 * untrusted input where one matters
 */

/**
 * Hash a string with 64-bit FNV-1a over its UTF-8 bytes, folded to 52 bits so it fits in a
 * JavaScript number. Not cryptographic. A lone surrogate hashes as its 3-byte WTF-8 encoding rather
 * than as U+FFFD, so strings that differ only in lone surrogates hash differently
 */
export function fnv1a52Hash(s: string): number {
  // The 64-bit hash is kept in four 16-bit words, v0 being the lowest
  let v0 = 0x23_25,
    v1 = 0x84_22,
    v2 = 0x9c_e4,
    v3 = 0xcb_f2

  // Multiply by the FNV prime, 2^40 + 435, after XORing in a byte
  const hashByte = (byte: number): void => {
    v0 ^= byte
    const t0 = v0 * 435
    let t1 = v1 * 435
    let t2 = v2 * 435
    let t3 = v3 * 435
    t2 += v0 << 8
    t3 += v1 << 8
    t1 += t0 >>> 16
    v0 = t0 & 65_535
    t2 += t1 >>> 16
    v1 = t1 & 65_535
    v3 = (t3 + (t2 >>> 16)) & 65_535
    v2 = t2 & 65_535
  }

  // Encodes as WTF-8 rather than with `TextEncoder`, which turns every lone surrogate into U+FFFD
  for (const char of s) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint < 0x80) {
      hashByte(codePoint)
    } else if (codePoint < 0x8_00) {
      hashByte(0xc0 | (codePoint >> 6))
      hashByte(0x80 | (codePoint & 0x3f))
    } else if (codePoint < 0x1_00_00) {
      hashByte(0xe0 | (codePoint >> 12))
      hashByte(0x80 | ((codePoint >> 6) & 0x3f))
      hashByte(0x80 | (codePoint & 0x3f))
    } else {
      hashByte(0xf0 | (codePoint >> 18))
      hashByte(0x80 | ((codePoint >> 12) & 0x3f))
      hashByte(0x80 | ((codePoint >> 6) & 0x3f))
      hashByte(0x80 | (codePoint & 0x3f))
    }
  }

  return (v3 & 15) * 281_474_976_710_656 + v2 * 4_294_967_296 + v1 * 65_536 + (v0 ^ (v3 >> 4))
}

const BASE62_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * Hash a string to {@link fnv1a52Hash} in base 62, 1 to 9 characters long. Not cryptographic. Two
 * hashes can differ only in case, so don't use them where case doesn't count, such as file names on
 * macOS and Windows
 */
export function shortHash(s: string): string {
  let hash = fnv1a52Hash(s)
  let result = ''
  // A `do` loop, so a hash of 0 encodes as `'0'` rather than `''`
  do {
    result = BASE62_DIGITS.charAt(hash % 62) + result
    hash = Math.floor(hash / 62)
  } while (hash > 0)
  return result
}
