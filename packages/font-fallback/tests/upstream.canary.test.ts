import { entireMetricsCollection } from '@capsizecss/metrics/entireMetricsCollection'
import { create } from 'fontkitten'

import { CFF_PATH } from './fixtures'
import { getTable, readBytes, replaceTable } from './helpers'

// Canaries for the upstream bugs this package works around, which fail once a bug is fixed and
// name the workaround to remove. The upstream behavior it relies on is in `upstream.test.ts`

describe('fontkitten workarounds', () => {
  it('still overreads CFF maxp tables; remove padShortMaxp in parse.ts, which pads direct and WOFF2 input, when fixed', async () => {
    const bytes = await readBytes(CFF_PATH)
    const maxp = getTable(bytes, 'maxp')
    expect(maxp).toHaveLength(6)
    const font = create(Buffer.from(replaceTable(bytes, 'maxp', maxp)))
    assert(!font.isCollection)
    expect(Reflect.get(font, 'maxp')).toBeUndefined()
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
