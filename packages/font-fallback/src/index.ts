import { formatMessage, formatNames } from '@gpahal/std/errors'

import { renderFontFace, toFontFamilyName } from '@/internal/css'
import {
  checkOverrides,
  checkSizeAdjustOverrides,
  computeOverrides,
} from '@/internal/fallback-metrics'
import {
  EXTRA_LOCAL_NAMES,
  findFamily,
  findRegularFamily,
  getCaseHint,
  getFamilySubject,
} from '@/internal/families'
import { isReadAtOpticalSize, markReadAtOpticalSize } from '@/internal/optical-size'
import { checkOptions, getFamilyKey, PREFIX } from '@/internal/options'
import { linkSignal } from '@/internal/signal'
import { checkSource, loadFamily, loadFontFile } from '@/internal/sources'
import type {
  FontCategory,
  FontFallback,
  FontFallbacks,
  FontFallbacksOptions,
  FontMetrics,
  FontSource,
} from '@/internal/types'

export type {
  FontCategory,
  FontFallback,
  FontFallbacks,
  FontFallbacksOptions,
  FontSource,
} from '@/internal/types'

/**
 * The fallbacks for each category: fonts of macOS and iOS, the system fonts of Windows and
 * Android, and fonts installed nearly everywhere. A default that's the web font, in any case, or
 * too unlike it for a size-adjusted rule, is left out of its list.
 *
 * `-apple-system` isn't a default: its metrics are measured at SF's default optical size, but
 * macOS renders body text at a smaller one, which is 7 to 9% wider.
 */
export const DEFAULT_FALLBACKS: Readonly<Record<FontCategory, ReadonlyArray<string>>> =
  Object.freeze({
    'sans-serif': Object.freeze(['Helvetica Neue', 'Segoe UI', 'Roboto', 'Arial']),
    serif: Object.freeze(['Georgia', 'Times New Roman', 'Noto Serif']),
    monospace: Object.freeze(['Courier New', 'Roboto Mono']),
  })

/**
 * Get size-adjusted local fallbacks for a web font, so text set in a fallback while the web font
 * loads takes the space the web font will.
 *
 * `source` is the web font's regular face: the exact name of a family in `@capsizecss/metrics`, an
 * `https:` URL, a `file:` `URL` or the bytes of a TTF, OTF or WOFF2 font file. A font file needs
 * the `name` option. Fonts are trusted, build-time inputs: don't pass fonts users upload or URLs
 * they supply. An unusual input throws rather than being repaired, but default fallbacks that are
 * the web font or too unlike it are skipped.
 *
 * @example
 * ```ts
 * import { getFontFallbacks } from '@gpahal/font-fallback'
 *
 * const { css, fontFamily } = await getFontFallbacks('Figtree')
 * // fontFamily: "Figtree, 'Figtree fallback Helvetica Neue', 'Figtree fallback Segoe UI', ..."
 * ```
 *
 * @throws TypeError if an option or `source` isn't valid; see the README's "Rejected inputs".
 * @throws The signal's reason, such as an `AbortError`, once it's aborted.
 * @throws If the font file can't be loaded or is rejected, or the overrides of a given fallback, or
 *   of every default fallback, are out of range. The error lists each such fallback.
 */
export async function getFontFallbacks(
  source: FontSource,
  options: FontFallbacksOptions = {},
): Promise<FontFallbacks> {
  const {
    name,
    fallbacks: givenFallbacks,
    category: givenCategory,
    signal: givenSignal,
    fontFaceProperties,
    sizeAdjust,
  } = checkOptions(options)
  // A native signal that follows the one given, which `fetch` and streams take
  const { signal, unlink } = linkSignal(givenSignal)
  try {
    signal?.throwIfAborted()
    return await getFallbacks(source, {
      name,
      givenFallbacks,
      givenCategory,
      signal,
      fontFaceProperties,
      sizeAdjust,
    })
  } finally {
    try {
      // A lookup can settle before this continuation resumes, and an abort in that gap still wins
      signal?.throwIfAborted()
    } finally {
      unlink()
    }
  }
}

async function getFallbacks(
  source: FontSource,
  {
    name,
    givenFallbacks,
    givenCategory,
    signal,
    fontFaceProperties,
    sizeAdjust,
  }: {
    name: string | undefined
    givenFallbacks: ReadonlyArray<string> | undefined
    givenCategory: FontCategory | undefined
    signal: AbortSignal | undefined
    fontFaceProperties: Readonly<Record<string, string>> | undefined
    sizeAdjust: number | undefined
  },
): Promise<FontFallbacks> {
  const checked = checkSource(source)
  const { subject } = checked
  let webFontName: string
  let category: FontCategory | undefined
  // Loads the metrics once the options are checked against the font
  let loadMetrics: () => Promise<FontMetrics>
  if (checked.kind === 'family') {
    const { face, category: familyCategory } = await withAbortReason(loadFamily(checked), signal)
    webFontName = name ?? checked.familyName
    category = familyCategory
    loadMetrics = async () => face
  } else {
    if (name === undefined) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [subject],
          'a font file needs the `name` option: the `font-family` name of your `@font-face`',
        ),
      )
    }
    webFontName = name
    category = (await withAbortReason(findFamily(name), signal))?.category
    loadMetrics = async () => loadFontFile(checked, signal)
    if (category === undefined && givenCategory === undefined && givenFallbacks === undefined) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [subject],
          `\`name\` ${formatNames([name])} isn't a family in @capsizecss/metrics, so set \`category\` or \`fallbacks\`${await withAbortReason(getCaseHint(name), signal)}`,
        ),
      )
    }
  }
  const webFontKeys = new Set(
    [webFontName, checked.kind === 'family' ? checked.familyName : undefined]
      .filter((familyName) => familyName !== undefined)
      .map(getFamilyKey),
  )
  const isWebFont = (familyName: string): boolean => webFontKeys.has(getFamilyKey(familyName))
  let fallbackFamilies: ReadonlyArray<string>
  if (givenFallbacks === undefined) {
    const defaultCategory = givenCategory ?? category ?? 'sans-serif'
    fallbackFamilies = DEFAULT_FALLBACKS[defaultCategory].filter(
      (fallbackFamily) => !isWebFont(fallbackFamily),
    )
    if (fallbackFamilies.length === 0) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [subject],
          `every default \`${defaultCategory}\` fallback is the web font. Set \`fallbacks\``,
        ),
      )
    }
  } else {
    fallbackFamilies = givenFallbacks
    const webFontFallback = givenFallbacks.find(isWebFont)
    if (webFontFallback !== undefined) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [getFamilySubject('fallback', webFontFallback)],
          'is the web font, as family names match in any case. Pass another fallback',
        ),
      )
    }
  }
  // Fallbacks are looked up before the font file is loaded, so an unknown one throws without a
  // read or fetch
  const fallbackFaces = await withAbortReason(
    Promise.all(
      fallbackFamilies.map(
        async (fallbackFamily) =>
          (
            await findRegularFamily(
              fallbackFamily,
              getFamilySubject('fallback', fallbackFamily),
              'Pass another fallback',
            )
          ).face,
      ),
    ),
    signal,
  )
  const metrics = await withAbortReason(loadMetrics(), signal)
  const entries = fallbackFaces.map((face) => ({
    face,
    fallbackFamily: face.familyName,
    overrides: computeOverrides(
      metrics,
      face,
      sizeAdjust === undefined ? undefined : sizeAdjust / 100,
    ),
  }))
  const [firstEntry] = entries
  if (sizeAdjust !== undefined && firstEntry !== undefined) {
    checkSizeAdjustOverrides(subject, firstEntry.overrides, sizeAdjust)
  }
  const validEntries = checkOverrides(subject, entries, givenFallbacks === undefined)
  const fallbacks = validEntries.map(({ face, overrides }): FontFallback => {
    // Every face of @capsizecss/metrics has a full or PostScript name; the default only satisfies
    // the type
    const [firstLocalName = face.familyName, ...otherLocalNames] = new Set(
      [
        face.fullName,
        face.postscriptName,
        ...(EXTRA_LOCAL_NAMES[face.postscriptName] ?? [])
          .filter(({ familyName }) => !isWebFont(familyName))
          .flatMap(({ names }) => names),
      ].filter(Boolean),
    )
    const rule = {
      familyName: `${webFontName} fallback ${face.familyName}`,
      fallbackFamily: face.familyName,
      localNames: [firstLocalName, ...otherLocalNames] as const,
      ...overrides,
    }
    return { ...rule, css: renderFontFace(rule, fontFaceProperties) }
  })
  const result: FontFallbacks = {
    css: fallbacks.map((fallback) => fallback.css).join('\n'),
    fontFamily: [webFontName, ...fallbacks.map((fallback) => fallback.familyName)]
      .map(toFontFamilyName)
      .join(', '),
    fallbacks,
  }
  if (metrics.windowsLineHeightRatio !== undefined) {
    result.windowsLineHeightRatio = metrics.windowsLineHeightRatio
  }
  if (isReadAtOpticalSize(metrics)) {
    markReadAtOpticalSize(result)
  }
  return result
}

/**
 * An abort takes precedence over either outcome of a lookup
 */
async function withAbortReason<T>(lookup: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  try {
    return await lookup
  } finally {
    signal?.throwIfAborted()
  }
}
