import { checkOverrides, computeOverrides } from '@/internal/fallback-metrics'
import type { FontMetrics } from '@/internal/types'

import { PREFIX } from './helpers'

const METRICS: FontMetrics = {
  unitsPerEm: 1000,
  xWidthAvg: 500,
  ascent: 800,
  descent: -200,
  lineGap: 0,
}

const OVERRIDES = computeOverrides(METRICS, METRICS)

describe('computeOverrides', () => {
  it('repairs nothing: a negative ascent, positive descent and negative line gap stay as they are', () => {
    expect(
      computeOverrides({ ...METRICS, ascent: -100, descent: 300, lineGap: -50 }, METRICS),
    ).toStrictEqual({
      sizeAdjust: 1,
      ascentOverride: -0.1,
      descentOverride: -0.3,
      lineGapOverride: -0.05,
    })
  })

  it('gives a size of NaN or infinity without an average width', () => {
    expect(computeOverrides(METRICS, { ...METRICS, xWidthAvg: 0 }).sizeAdjust).toBe(Infinity)
    expect(
      computeOverrides({ ...METRICS, xWidthAvg: 0 }, { ...METRICS, xWidthAvg: 0 }).sizeAdjust,
    ).toBeNaN()
  })
})

describe('checkOverrides', () => {
  it('takes overrides at the ends of their ranges', () => {
    for (const overrides of [
      { sizeAdjust: 0.5, ascentOverride: 2, descentOverride: 1.5, lineGapOverride: 1 },
      { sizeAdjust: 2, ascentOverride: 0.01, descentOverride: 0, lineGapOverride: 0 },
    ]) {
      expect(() => {
        checkOverrides('font bytes', [{ fallbackFamily: 'Arial', overrides }], false)
      }).not.toThrow()
    }
  })

  it('leaves out the default fallbacks out of range, keeping the order of the rest', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((fallbackFamily, index) => ({
      fallbackFamily,
      overrides: { ...OVERRIDES, sizeAdjust: index % 2 === 0 ? 1 : 3 },
    }))
    assert(a && b && c && d)
    expect(checkOverrides('font bytes', [a, b, c, d], true)).toEqual([a, c])
    expect(() => checkOverrides('font bytes', [a, b, c, d], false)).toThrow(/: 2 issues\n/)
    expect(() => checkOverrides('font bytes', [b, d], true)).toThrow(
      /^[^\n]*: font bytes: 2 issues\. Every default fallback is out of range\. Set `fallbacks`\n(?: {2}fallback `[BD]`: [^\n]+(?:\n|$)){2}$/u,
    )
    expect(() => checkOverrides('font bytes', [b], true)).toThrow(
      /: font bytes: fallback `B`: [^\n]+\. Every default fallback is out of range\. Set `fallbacks`$/u,
    )
  })

  it.each([
    ['sizeAdjust', 0.49, 'a `sizeAdjust` from 0.5 to 2, received `0.49`'],
    ['sizeAdjust', 2.123456, 'a `sizeAdjust` from 0.5 to 2, received `2.1235`'],
    ['ascentOverride', -0.00001, 'an `ascentOverride` over 0 and at most 2, received `-0.00001`'],
    ['sizeAdjust', NaN, 'a `sizeAdjust` from 0.5 to 2, received `NaN`'],
    ['lineGapOverride', Infinity, 'a `lineGapOverride` from 0 to 1, received `Infinity`'],
  ])('rejects a %s of %d', (key, value, expected) => {
    expect(() => {
      checkOverrides(
        'font bytes',
        [{ fallbackFamily: 'Arial', overrides: { ...OVERRIDES, [key]: value } }],
        false,
      )
    }).toThrow(
      new Error(
        `${PREFIX}: font bytes: fallback \`Arial\`: expected ${expected}. This font is too unlike \`Arial\` for a size-adjusted fallback`,
      ),
    )
  })
})
