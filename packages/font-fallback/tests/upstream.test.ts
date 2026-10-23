import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { create } from 'fontkitten'

import { FIGTREE_PATH } from './fixtures'
import { readBytes, setTableRecord } from './helpers'

// Upstream behavior that this package's code relies on, which isn't a bug it works around. Each
// test names the code to update when it fails. The canaries of those bugs are in
// `upstream.canary.test.ts`

describe('fontkitten contracts', () => {
  it('still maps code points to glyph ids by its private cmap processor; update readMetrics in parse.ts when this fails', async () => {
    const font = create(Buffer.from(await readBytes(FIGTREE_PATH)))
    assert(!font.isCollection)
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
