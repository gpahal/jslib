import { formatMessage, formatNames } from '@gpahal/std/errors'

import { getFamilyKey, PREFIX } from '@/internal/options'
import type { FontCategory, FontMetrics } from '@/internal/types'

/**
 * A face of `@capsizecss/metrics`, with the names a fallback's `src: local()` uses
 */
export type FamilyFace = FontMetrics & {
  familyName: string
  fullName: string
  postscriptName: string
}

/**
 * More `src: local()` names of a face, by its PostScript name, with the family each name is of.
 * Chromium on macOS doesn't match the system font by `System Font` or `.SFNS-Regular`, but does by
 * `System Font Regular`. The Linux fonts are metric-compatible with the Microsoft fonts they
 * follow: their `hhea` metrics, `unitsPerEm` and average widths are the same, so one rule's
 * overrides fit both. A name of the web font's own family is left out, as it would fall back to
 * itself
 */
export const EXTRA_LOCAL_NAMES: Readonly<
  Record<string, ReadonlyArray<{ familyName: string; names: ReadonlyArray<string> }>>
> = {
  '.SFNS-Regular': [{ familyName: 'System Font', names: ['System Font Regular'] }],
  ArialMT: [
    { familyName: 'Liberation Sans', names: ['Liberation Sans', 'LiberationSans'] },
    { familyName: 'Arimo', names: ['Arimo Regular', 'Arimo-Regular'] },
  ],
  TimesNewRomanPSMT: [
    { familyName: 'Liberation Serif', names: ['Liberation Serif', 'LiberationSerif'] },
    { familyName: 'Tinos', names: ['Tinos Regular', 'Tinos-Regular'] },
  ],
  CourierNewPSMT: [
    { familyName: 'Liberation Mono', names: ['Liberation Mono', 'LiberationMono'] },
    { familyName: 'Cousine', names: ['Cousine Regular', 'Cousine-Regular'] },
  ],
}

/**
 * A family of `@capsizecss/metrics`, as its typed collection has it. Its types leave out a
 * `descent` of 0, which its data has, so `tests/upstream.test.ts` fails once they don't
 */
type Family = {
  familyName: string
  category: string
  variants: {
    readonly [variant: string]: unknown
    regular?: Omit<FamilyFace, 'descent'> & { descent?: number }
  }
}

type Families = {
  /**
   * By exact name
   */
  byName: ReadonlyMap<string, Family>
  /**
   * The names by their {@link getFamilyKey}, for the hint of a lookup in the wrong case
   */
  namesByKey: ReadonlyMap<string, string>
}

/**
 * The families of `@capsizecss/metrics`, once loaded
 */
const cache: { families?: Promise<Families> } = {}

/**
 * The families of `@capsizecss/metrics`. The collection is a 4 MB module, so it's imported on the
 * first lookup. Node caches a failed import too
 */
async function getFamilies(): Promise<Families> {
  cache.families ??= importFamilies()
  return cache.families
}

async function importFamilies(): Promise<Families> {
  const { entireMetricsCollection } = await import('@capsizecss/metrics/entireMetricsCollection')
  const collection: Readonly<Record<string, Family>> = entireMetricsCollection
  const families = Object.values(collection)
  return {
    byName: new Map(families.map((family) => [family.familyName, family])),
    namesByKey: new Map(families.map(({ familyName }) => [getFamilyKey(familyName), familyName])),
  }
}

/**
 * The subject of errors about a family, such as ``family `Inter` ``, with its control characters
 * escaped
 */
export function getFamilySubject(kind: 'family' | 'fallback', familyName: string): string {
  return `${kind} ${formatNames([familyName])}`
}

/**
 * A family's regular face and default category, display and handwriting fonts being
 * `sans-serif`, by its exact name. `undefined` for an unknown family, and `face` is `undefined`
 * for a family without a regular face
 */
export async function findFamily(
  familyName: string,
): Promise<{ face: FamilyFace | undefined; category: FontCategory } | undefined> {
  const family = (await getFamilies()).byName.get(familyName)
  if (!family) {
    return undefined
  }
  const { category, variants } = family
  return {
    // Capsize's data gives a few families, such as Coiny and Revalia, a positive descent, so its
    // sign is dropped, as Capsize's `createFontStack` does. A descent is below the baseline
    face: variants.regular && {
      ...variants.regular,
      descent: -Math.abs(variants.regular.descent ?? 0),
    },
    category: category === 'serif' || category === 'monospace' ? category : 'sans-serif',
  }
}

/**
 * The hint for a family name that {@link findFamily} doesn't find, such as
 * ``. Did you mean `Inter`?`` when it names a family in another case, or else `''`
 */
export async function getCaseHint(familyName: string): Promise<string> {
  const match = (await getFamilies()).namesByKey.get(getFamilyKey(familyName))
  return match === undefined || match === familyName
    ? ''
    : `. Did you mean ${formatNames([match])}?`
}

/**
 * Icon font families of `@capsizecss/metrics`, whose glyphs aren't text, so no local font can
 * stand in for them
 */
const ICON_FAMILY_REGEX = /^Material (?:Icons|Symbols)(?: |$)/u

/**
 * Emoji families of `@capsizecss/metrics`, such as `Noto Color Emoji`, whose glyphs are pictures
 * that no text font can stand in for
 */
const EMOJI_FAMILY_REGEX = /(?:^| )Emoji(?: |$)/u

/**
 * {@link findFamily}'s family, which has a regular face. `subject` names the family in errors, and
 * `noFace` follows the error for a family without a regular face
 *
 * @throws TypeError when the family is unknown, with the name in the right case if it's one in
 *   another, is an icon or emoji font, or has no regular face.
 */
export async function findRegularFamily(
  familyName: string,
  subject: string,
  noFace: string,
): Promise<{ face: FamilyFace; category: FontCategory }> {
  const family = await findFamily(familyName)
  if (!family) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [subject],
        `@capsizecss/metrics has no such family${await getCaseHint(familyName)}`,
      ),
    )
  }
  if (ICON_FAMILY_REGEX.test(familyName)) {
    throw new TypeError(
      formatMessage(PREFIX, [subject], "is an icon font, and icon fonts aren't supported"),
    )
  }
  if (EMOJI_FAMILY_REGEX.test(familyName)) {
    throw new TypeError(
      formatMessage(PREFIX, [subject], "is an emoji font, and emoji fonts aren't supported"),
    )
  }
  const { face, category } = family
  if (!face) {
    throw new TypeError(
      formatMessage(PREFIX, [subject], `has no regular face in @capsizecss/metrics. ${noFace}`),
    )
  }
  return { face, category }
}
