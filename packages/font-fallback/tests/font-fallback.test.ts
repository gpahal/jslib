import { createFontStack } from '@capsizecss/core'
import { entireMetricsCollection } from '@capsizecss/metrics/entireMetricsCollection'

import { describeValue } from '@gpahal/std/errors'

import { DEFAULT_FALLBACKS, getFontFallbacks, type FontFallback } from '@/index'
import { renderFontFace, toFontFamilyName, toPercentage } from '@/internal/css'

import { FIGTREE_PATH } from './fixtures'
import { getFallbackFamilies, getRejection, PREFIX, readBytes } from './helpers'

async function getOnlyFallback(
  fallbackFamily: string,
  options: { name?: string } = {},
): Promise<FontFallback> {
  const { fallbacks } = await getFontFallbacks('Figtree', {
    ...options,
    fallbacks: [fallbackFamily],
  })
  const [fallback, ...rest] = fallbacks
  if (!fallback || rest.length > 0) {
    throw new Error(`Expected one fallback for ${fallbackFamily}`)
  }
  return fallback
}

const OPTIONS = '`getFontFallbacks` options'
const DESCRIPTORS =
  '`font-display`, `font-feature-settings`, `font-language-override`, `font-named-instance`, `font-stretch`, `font-style`, `font-variation-settings`, `font-weight`, `font-width` or `unicode-range`'
const DESCRIPTOR_VALUE_RULE =
  'a CSS value without surrounding whitespace, control, format, line separator or paragraph separator characters, `;`, `{`, `}`, `<`, `>`, `&`, `"`, `\\`, `!` or comments, whose single quotes, parentheses and brackets are closed and whose `url()` arguments are quoted'
const NAME_RULE =
  'a font-family name of letters, digits, underscores, periods, single spaces and hyphens, up to 64 characters'
type FontStackMetrics = Parameters<typeof createFontStack>[0][number]

const OVERRIDE_KEYS = [
  'sizeAdjust',
  'ascentOverride',
  'descentOverride',
  'lineGapOverride',
] as const

function sizeAdjustIssue(fallback: string, received: string): string {
  return `  fallback \`${fallback}\`: expected a \`sizeAdjust\` from 0.5 to 2, received \`${received}\`. This font is too unlike \`${fallback}\` for a size-adjusted fallback`
}

describe('rules', () => {
  it('computes the overrides Capsize does for every family with a regular face', async () => {
    const { arial } = entireMetricsCollection
    const faces = Object.values(entireMetricsCollection).flatMap((family) => {
      // The types leave out a descent of 0 (see `tests/upstream.test.ts`)
      const variants: {
        readonly [variant: string]: unknown
        regular?: Omit<FontStackMetrics, 'descent'> & { descent?: number }
      } = family.variants
      const { regular } = variants
      return regular ? { ...regular, descent: regular.descent ?? 0 } : []
    })
    expect(faces.length).toBeGreaterThan(1000)
    const rejected: Array<string> = []
    const rejections: Array<string> = []
    // Arial can't fall back to itself, and the system UI font and icon and emoji fonts are rejected
    const otherFaces = faces.filter(
      ({ familyName }) =>
        !['Arial', '-apple-system', 'BlinkMacSystemFont'].includes(familyName) &&
        !/^Material (?:Icons|Symbols)/u.test(familyName) &&
        !/(?:^| )Emoji(?: |$)/u.test(familyName),
    )
    for (const face of otherFaces) {
      const capsize = createFontStack([face, arial], { fontFaceFormat: 'styleObject' })
        .fontFaces[0]?.['@font-face']
      let fallbacks: Array<FontFallback>
      try {
        ;({ fallbacks } = await getFontFallbacks(face.familyName, { fallbacks: ['Arial'] }))
      } catch (error) {
        rejections.push(String(error))
        rejected.push(face.familyName)
        continue
      }
      const [fallback] = fallbacks
      assert(fallback)
      // Capsize rounds to 4 decimals. It leaves out a size-adjust of 100%, and an override that's
      // 0 or the fallback's own
      const keys = OVERRIDE_KEYS.filter(
        (key) => key === 'sizeAdjust' || capsize?.[key] !== undefined,
      )
      for (const key of keys) {
        expect(fallback[key], `${face.familyName}: ${key}`).toBeCloseTo(
          Number.parseFloat(capsize?.[key] ?? '100%') / 100,
          5,
        )
      }
    }
    // Extreme fonts, such as barcodes and very wide or narrow display fonts. The bound, about twice
    // the 20 measured on 2026-10-08, leaves room for new metrics data
    for (const rejection of rejections) {
      expect(rejection).toMatch(
        /: fallback `Arial`: expected an? `\w+` .*\. This font is too unlike `Arial` for a size-adjusted fallback$/,
      )
    }
    expect(rejected.length).toBeLessThan(40)
    expect(rejected).toEqual(expect.arrayContaining(['Diplomata', 'Dorsa', 'Six Caps']))
  })

  it('returns a regular rule for each fallback, and the font family stack', async () => {
    const { css, fontFamily, fallbacks } = await getFontFallbacks('Figtree')
    expect(fontFamily).toBe(
      "Figtree, 'Figtree fallback Helvetica Neue', 'Figtree fallback Segoe UI', 'Figtree fallback Roboto', 'Figtree fallback Arial'",
    )
    expect(css).toBe(fallbacks.map((fallback) => fallback.css).join('\n'))
    const arial = fallbacks.at(-1)
    expect(arial?.sizeAdjust).toBeCloseTo(1.007176, 6)
    expect(arial?.ascentOverride).toBeCloseTo(0.943231, 6)
    expect(arial?.descentOverride).toBeCloseTo(0.248219, 6)
    expect(arial).toMatchObject({
      familyName: 'Figtree fallback Arial',
      fallbackFamily: 'Arial',
      // Capsize's local names, then the Linux fonts with Arial's metrics
      localNames: [
        'Arial',
        'ArialMT',
        'Liberation Sans',
        'LiberationSans',
        'Arimo Regular',
        'Arimo-Regular',
      ],
      lineGapOverride: 0,
      css: `/* fallback Arial */
@font-face {
  font-family: 'Figtree fallback Arial';
  src: local('Arial'), local('ArialMT'), local('Liberation Sans'), local('LiberationSans'), local('Arimo Regular'), local('Arimo-Regular');
  size-adjust: 100.717634%;
  ascent-override: 94.323105%;
  descent-override: 24.82187%;
  line-gap-override: 0%;
}`,
    })
  })

  it("leaves the web font out of a fallback's local names, as it can't fall back to itself", async () => {
    const { fallbacks } = await getFontFallbacks('Arimo', { fallbacks: ['Arial'] })
    expect(fallbacks[0]?.localNames).toEqual([
      'Arial',
      'ArialMT',
      'Liberation Sans',
      'LiberationSans',
    ])
  })

  // `-apple-system` renders 7 to 9% wider than its metrics at body sizes on macOS, so Helvetica
  // Neue, which matches its metrics there, takes its place
  it('falls back to Helvetica Neue first, not -apple-system, which takes its own local names', async () => {
    expect(DEFAULT_FALLBACKS['sans-serif']).toEqual([
      'Helvetica Neue',
      'Segoe UI',
      'Roboto',
      'Arial',
    ])
    const appleSystem = await getOnlyFallback('-apple-system')
    expect(appleSystem.css).toContain(
      "  src: local('System Font'), local('.SFNS-Regular'), local('System Font Regular');\n",
    )
  })

  it("picks the default fallbacks by the family's category", async () => {
    expect(await getFallbackFamilies('Merriweather')).toEqual(DEFAULT_FALLBACKS.serif)
    expect(await getFallbackFamilies('Fira Code')).toEqual(DEFAULT_FALLBACKS.monospace)
    // Lobster is a display font
    expect(await getFallbackFamilies('Lobster')).toEqual(DEFAULT_FALLBACKS['sans-serif'])
    expect(await getFallbackFamilies('Merriweather', { category: 'monospace' })).toEqual(
      DEFAULT_FALLBACKS.monospace,
    )
    expect(
      await getFallbackFamilies('Figtree', { fallbacks: ['Segoe UI', 'Arial', 'Roboto'] }),
    ).toEqual(['Segoe UI', 'Arial', 'Roboto'])
  })

  it("picks a font file's default fallbacks by the category of the family `name` names exactly", async () => {
    const bytes = await readBytes(FIGTREE_PATH)
    expect(await getFallbackFamilies(bytes, { name: 'Merriweather' })).toEqual(
      DEFAULT_FALLBACKS.serif,
    )
    await expect(getFontFallbacks(bytes, { name: 'merriweather' })).rejects.toThrow(
      new TypeError(
        `${PREFIX}: font bytes: \`name\` \`merriweather\` isn't a family in @capsizecss/metrics, so set \`category\` or \`fallbacks\`. Did you mean \`Merriweather\`?`,
      ),
    )
    expect(await getFallbackFamilies(bytes, { name: 'Satoshi', category: 'serif' })).toEqual(
      DEFAULT_FALLBACKS.serif,
    )
  })

  it('rejects a fallback that is the web font, in any case', async () => {
    await expect(
      getFontFallbacks('Figtree', { name: 'Inter', fallbacks: ['inter'] }),
    ).rejects.toThrow(
      new TypeError(
        `${PREFIX}: fallback \`inter\`: is the web font, as family names match in any case. Pass another fallback`,
      ),
    )
  })

  it('leaves out a default fallback that is the web font Georgia, in any case', async () => {
    expect(await getFallbackFamilies('Georgia')).toEqual(['Times New Roman', 'Noto Serif'])
  })

  it('rejects a web font that every default fallback is', async () => {
    await expect(getFontFallbacks('Roboto Mono', { name: 'Courier New' })).rejects.toThrow(
      new TypeError(
        `${PREFIX}: family \`Roboto Mono\`: every default \`monospace\` fallback is the web font. Set \`fallbacks\``,
      ),
    )
  })

  it('skips the default fallbacks that are out of range, keeping the others in order', async () => {
    const { fontFamily } = await getFontFallbacks('Amiri Quran')
    expect(fontFamily).toBe(
      "'Amiri Quran', 'Amiri Quran fallback Georgia', 'Amiri Quran fallback Times New Roman'",
    )
  })

  it('lists every default fallback in one error when every one is out of range', async () => {
    await expect(getFontFallbacks('Six Caps')).rejects.toThrow(
      new Error(
        [
          `${PREFIX}: family \`Six Caps\`: 4 issues. Every default fallback is out of range. Set \`fallbacks\``,
          sizeAdjustIssue('Helvetica Neue', '0.4427'),
          sizeAdjustIssue('Segoe UI', '0.4493'),
          sizeAdjustIssue('Roboto', '0.4479'),
          sizeAdjustIssue('Arial', '0.4469'),
        ].join('\n'),
      ),
    )
  })

  it('rejects an out-of-range fallback that is given', async () => {
    await expect(
      getFontFallbacks('Amiri Quran', { fallbacks: ['Georgia', 'Noto Serif'] }),
    ).rejects.toThrow(
      new Error(
        `${PREFIX}: family \`Amiri Quran\`: fallback \`Noto Serif\`: expected an \`ascentOverride\` over 0 and at most 2, received \`2.1503\`. This font is too unlike \`Noto Serif\` for a size-adjusted fallback`,
      ),
    )
  })

  it('looks up the fallbacks before loading the font file', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        getFontFallbacks('https://fonts.example/f.ttf', {
          name: 'Figtree',
          fallbacks: ['Arial', 'Unknown Family'],
        }),
      ).rejects.toThrow(
        new TypeError(
          `${PREFIX}: fallback \`Unknown Family\`: @capsizecss/metrics has no such family`,
        ),
      )
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    // UnifrakturCook's only face is bold
    ['UnifrakturCook', 'has no regular face in @capsizecss/metrics. Pass another fallback'],
    ['arial', '@capsizecss/metrics has no such family. Did you mean `Arial`?'],
    ['Material Symbols Outlined', "is an icon font, and icon fonts aren't supported"],
  ])('rejects the fallback %s with a TypeError', async (fallback, description) => {
    const error = await getRejection(getFontFallbacks('Figtree', { fallbacks: [fallback] }))
    expect(error).toBeInstanceOf(TypeError)
    expect(error.message).toBe(`${PREFIX}: fallback \`${fallback}\`: ${description}`)
  })

  it('rejects an icon or emoji font as the web font', async () => {
    await expect(getFontFallbacks('Noto Color Emoji', { fallbacks: ['Arial'] })).rejects.toThrow(
      new TypeError(
        `${PREFIX}: family \`Noto Color Emoji\`: is an emoji font, and emoji fonts aren't supported`,
      ),
    )
  })

  it.each([
    ['Inter', 'Inter'],
    ['Open Sans', "'Open Sans'"],
  ])('writes the name %s in the stack as %s', async (name, expected) => {
    const { fontFamily } = await getFontFallbacks('Figtree', { fallbacks: ['Arial'], name })
    expect(fontFamily).toBe(`${expected}, '${name} fallback Arial'`)
  })

  // A name that fails the name rule never gets here, but the CSS is escaped anyway
  it('escapes quotes, backslashes, controls and format characters in names', async () => {
    const fallback = await getOnlyFallback('Arial')
    const css = renderFontFace({
      ...fallback,
      familyName: `${String.raw`O'Brien \ Sans`}\n\u{0}\u{7F}\u{1}9\u{202E}\u{D800} fallback Arial`,
    })
    expect(css).toContain(
      String.raw`  font-family: 'O\'Brien \\ Sans\A ${'\u{FFFD}'}\7F \1 9\202E \D800  fallback Arial';`,
    )
    expect(css).not.toMatch(/\p{Cf}|\p{Cs}/u)
  })

  it('keeps a name from ending the style element, an attribute or the string', async () => {
    const fallback = await getOnlyFallback('Arial')
    for (const name of ['Evil</style><script>', 'a" onmouseover="x']) {
      const css = renderFontFace({ ...fallback, familyName: name, localNames: [name] })
      expect(`${css}\n${toFontFamilyName(name)}`).not.toMatch(/[<>"]/)
    }
    const css = renderFontFace({
      ...fallback,
      familyName: "x */ body { color: red } /*'; } body { color: red } @font-face { font-family: '",
    })
    // Outside the comment and the strings, only the rule's own braces are left
    const code = css.replace(/^\/\*.*\*\/\n/, '').replaceAll(/'(?:[^'\\]|\\.)*'/g, "''")
    expect(code.match(/[{}]/g)).toEqual(['{', '}'])
    expect(code).not.toContain('color')
  })

  it('drops control and format characters from the fallback family in the comment', async () => {
    const fallback = await getOnlyFallback('Arial')
    const css = renderFontFace({ ...fallback, fallbackFamily: 'A\u{202E}r\u{7}ial' })
    expect(css).toMatch(/^\/\* fallback Arial \*\/\n/)
  })
})

describe('options', () => {
  it.each([
    [
      { maxBytes: 1 },
      '`maxBytes`: unknown option. Known options: `category`, `fallbacks`, `fontFaceProperties`, `name`, `signal`, `sizeAdjust`',
    ],
    [
      { signal: new AbortController() },
      '`signal`: expected an `AbortSignal`, received an instance of `AbortController`',
    ],
    [{ fallbacks: 'Arial' }, '`fallbacks`: expected an array, received `"Arial"`'],
    [
      { fallbacks: [] },
      "`fallbacks`: expected at least one family, received an array. Leave the option out for the category's defaults",
    ],
    [
      { category: 'display' },
      '`category`: expected `sans-serif`, `serif` or `monospace`, received `"display"`',
    ],
    [
      { fallbacks: ['Arial', ''] },
      '`fallbacks[1]`: expected a family name of letters, digits, single spaces and hyphens, up to 64 characters, received `""`',
    ],
    [
      { fallbacks: ['Arial', 'Segoe UI', 'ARIAL'] },
      '`fallbacks[2]`: repeats `fallbacks[0]`, as family names match in any case. Drop one',
    ],
    [
      { category: 'serif', fallbacks: ['Arial'] },
      "`category` and `fallbacks`: can't be combined. Drop one",
    ],
    [{ name: "O'Brien" }, `\`name\`: expected ${NAME_RULE}, received \`"O'Brien"\``],
    [
      { fontFaceProperties: JSON.parse('{"font-display": "swap", "__proto__": {}}') as unknown },
      `\`fontFaceProperties\`: expected an @font-face descriptor of ${DESCRIPTORS}, received \`"__proto__"\``,
    ],
    [
      { fontFaceProperties: { src: "local('Arial')" } },
      '`fontFaceProperties`: `src` is written by the package. Drop it',
    ],
    [
      { fontFaceProperties: { 'font-display': 1 } },
      '`fontFaceProperties["font-display"]`: expected a string, received `1`',
    ],
    ...['swap;color:red', "'liga 1"].map((value): [unknown, string] => [
      { fontFaceProperties: { 'font-display': value } },
      `\`fontFaceProperties["font-display"]\`: expected ${DESCRIPTOR_VALUE_RULE}, received ${describeValue(value)}`,
    ]),
    ...['105%', 200.1].map((sizeAdjust): [unknown, string] => [
      { sizeAdjust },
      `\`sizeAdjust\`: expected a percentage from 50 to 200, such as 105 for 105%, received ${describeValue(sizeAdjust)}`,
    ]),
  ])('rejects the options %o with a TypeError', async (options, message) => {
    // @ts-expect-error - each option is invalid
    const error = await getRejection(getFontFallbacks('Inter', options))
    expect(error).toBeInstanceOf(TypeError)
    expect(error.message).toBe(`${PREFIX}: ${OPTIONS}: ${message}`)
  })

  it('takes a name with underscores and periods, which a family name may not have', async () => {
    const name = '__Inter_d65c.78'
    const { fontFamily } = await getFontFallbacks(await readBytes(FIGTREE_PATH), {
      name,
      fallbacks: ['Arial'],
    })
    expect(fontFamily).toBe(`'${name}', '${name} fallback Arial'`)
  })

  it('ignores an option inherited from a polluted `Object.prototype`', async () => {
    Reflect.set(Object.prototype, 'name', 'Polluted')
    try {
      const { fontFamily } = await getFontFallbacks('Figtree', { fallbacks: ['Arial'] })
      expect(fontFamily).toBe("Figtree, 'Figtree fallback Arial'")
    } finally {
      Reflect.deleteProperty(Object.prototype, 'name')
    }
  })

  it('takes an undefined option as not set', async () => {
    const { fallbacks } = await getFontFallbacks('Figtree', {
      fallbacks: undefined,
      category: undefined,
      fontFaceProperties: undefined,
      name: undefined,
      signal: undefined,
      sizeAdjust: undefined,
    })
    expect(fallbacks).toHaveLength(4)
  })
})

describe('fontFaceProperties and sizeAdjust', () => {
  it('writes the descriptors into each rule, after the computed ones', async () => {
    const fontFaceProperties = {
      'font-display': 'swap',
      'font-feature-settings': "'liga' 0, 'kern'",
      'font-weight': 'calc(300 + (2 * 50)) calc(900 + 0 * var(--x, 0))',
    }
    const plain = await getOnlyFallback('Arial')
    const { fallbacks } = await getFontFallbacks('Figtree', {
      fallbacks: ['Arial'],
      fontFaceProperties,
    })
    expect(fallbacks[0]?.css).toBe(
      `${plain.css.slice(0, -1)}  font-display: swap;\n  font-feature-settings: 'liga' 0, 'kern';\n  font-weight: calc(300 + (2 * 50)) calc(900 + 0 * var(--x, 0));\n}`,
    )
  })

  it('replaces the computed size-adjust, and computes the other overrides from it', async () => {
    const computed = await getOnlyFallback('Arial')
    const { fallbacks } = await getFontFallbacks('Figtree', {
      fallbacks: ['Arial'],
      sizeAdjust: 110,
    })
    const [fallback] = fallbacks
    assert(fallback)
    expect(fallback.sizeAdjust).toBe(1.1)
    // The overrides scale the web font's metrics by the em the size-adjust gives, so their products
    // with it are the metrics, as for the computed size-adjust
    for (const key of ['ascentOverride', 'descentOverride', 'lineGapOverride'] as const) {
      expect(fallback[key] * fallback.sizeAdjust).toBeCloseTo(
        computed[key] * computed.sizeAdjust,
        12,
      )
    }
    expect(fallback.css).toContain('  size-adjust: 110%;\n')
    expect(fallback.css).toContain(`  ascent-override: ${toPercentage(fallback.ascentOverride)};\n`)
  })

  it('rejects a sizeAdjust whose overrides are out of range', async () => {
    // Noto Sans's ascent of 1069 over an em of 1000 scaled by 0.5 is an ascent override of 2.138,
    // whatever the fallback
    await expect(getFontFallbacks('Noto Sans', { sizeAdjust: 50 })).rejects.toThrow(
      new Error(
        `${PREFIX}: family \`Noto Sans\`: \`sizeAdjust\`: expected a value that gives an \`ascentOverride\` over 0 and at most 2, received \`50\`, which gives \`2.138\`. Set another \`sizeAdjust\`, or drop it`,
      ),
    )
  })
})
