import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { entireMetricsCollection } from '@capsizecss/metrics/entireMetricsCollection'
import { create, type Font } from 'fontkitten'

import { CFF_PATH, FIGTREE_PATH } from './fixtures'
import { getTable, readBytes, replaceTable, setTableRecord } from './helpers'

async function readFont(name: string): Promise<Font> {
  const font = create(await readFile(new URL(`fixtures/${name}`, import.meta.url)))
  if (font.isCollection) {
    throw new Error('Expected a font, not a collection')
  }
  return font
}

describe('fontkitten workarounds', () => {
  it('still overreads CFF maxp tables; remove padShortMaxp in parse.ts, which pads direct and WOFF2 input, when fixed', async () => {
    const bytes = await readBytes(CFF_PATH)
    const maxp = getTable(bytes, 'maxp')
    expect(maxp).toHaveLength(6)
    const font = create(Buffer.from(replaceTable(bytes, 'maxp', maxp)))
    assert(!font.isCollection)
    expect(Reflect.get(font, 'maxp')).toBeUndefined()
  })

  it('still maps code points to glyph ids by its private cmap processor; update readMetrics in parse.ts when this fails', async () => {
    const font = await readFont('figtree-regular.ttf')
    const cmap: unknown = Reflect.get(font, '_cmapProcessor')
    expect(cmap).toHaveProperty('lookup', expect.any(Function))
    const { lookup } = cmap as { lookup: (codePoint: number) => number }
    expect(lookup.call(cmap, 97)).toBe(font.glyphForCodePoint(97).id)
  })

  it('still gives undefined for a table that fails to decode; update the table checks in parse.ts when this fails', async () => {
    const bytes = await readBytes(FIGTREE_PATH)
    setTableRecord(bytes, 'post', { offset: bytes.length - 1, length: 1 })
    const font = create(Buffer.from(bytes))
    assert(!font.isCollection)
    expect(Reflect.get(font, 'post')).toBeUndefined()
    expect(Reflect.get(font, 'head')).toBeDefined()
  })
})

describe('@capsizecss/metrics workarounds', () => {
  it('still gives Coiny and Revalia a positive descent; remove the Math.abs in families.ts when fixed', () => {
    expect(entireMetricsCollection.coiny.variants.regular).toMatchObject({ descent: 250 })
    expect(entireMetricsCollection.revalia.variants.regular).toMatchObject({ descent: 382 })
  })

  it('still types a descent of 0 as missing; remove the default descent in families.ts when fixed', () => {
    const face = entireMetricsCollection.allkin.variants.regular
    expect(face).toMatchObject({ descent: 0 })
    // @ts-expect-error - the types leave out a descent of 0
    expect(face.descent).toBe(0)
  })
})

describe("Node's fetch (undici)", () => {
  it("still rejects a redirect with the cause 'unexpected redirect'; update the redirect check in sources.ts when this fails", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(302, { location: '/final' }).end()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const { port } = server.address() as AddressInfo
      await expect(
        fetch(`http://127.0.0.1:${port}/font.ttf`, { redirect: 'error' }),
      ).rejects.toThrow(
        expect.objectContaining({
          name: 'TypeError',
          cause: expect.objectContaining({ message: 'unexpected redirect' }) as unknown,
        }),
      )
    } finally {
      server.close()
    }
  })
})
