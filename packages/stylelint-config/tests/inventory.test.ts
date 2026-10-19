import path from 'node:path'
import process from 'node:process'

import stylelint, { type Config } from 'stylelint'

import { defineConfig } from '@/index'

// The rules on for each kind of file, so a change to the preset or an upgrade of a config it
// extends shows up as a snapshot diff. Update it with `vitest -u` after checking the diff

const collator = new Intl.Collator('en')

/**
 * The kinds of file, linted from the package's folder, which needn't hold them
 */
const FILES = ['a.css', 'a.module.css', 'a.astro', 'a.html', 'a.md']

/**
 * The kind of file the others are snapshotted against
 */
const REFERENCE_FILE = 'a.css'

/**
 * Each rule that is on, with its setting on one line. Regular expressions are written as text, and
 * functions, whose text depends on the build, as `<function>`
 */
async function inventoryOf(config: Config, file: string): Promise<Map<string, string>> {
  const resolved = await stylelint.resolveConfig(path.join(import.meta.dirname, '..', file), {
    config,
  })
  const entries = Object.entries(resolved?.rules ?? {}).flatMap(([rule, setting]) => {
    if (setting == null || (Array.isArray(setting) && setting[0] == null)) {
      return []
    }
    const formatted = JSON.stringify(setting, (_key, value: unknown) => {
      if (value instanceof RegExp) {
        return String(value)
      }
      return typeof value === 'function' ? '<function>' : value
    })
    return [[rule, formatted] as const]
  })
  return new Map(entries.toSorted(([a], [b]) => collator.compare(a, b)))
}

/**
 * Every rule of `inventory` as `rule: setting`
 */
function listOf(inventory: Map<string, string>): Array<string> {
  return Array.from(inventory, ([rule, setting]) => `${rule}: ${setting}`)
}

/**
 * The rules of `inventory` that differ from `reference`: `+ rule: setting` for one only `inventory`
 * has on, `- rule` for one only `reference` has on, and `~ rule: setting` for one with another
 * setting
 */
function diffOf(reference: Map<string, string>, inventory: Map<string, string>): Array<string> {
  const lines: Array<string> = []
  const rules = new Set([...reference.keys(), ...inventory.keys()])
  for (const rule of rules) {
    const before = reference.get(rule)
    const after = inventory.get(rule)
    if (after === undefined) {
      lines.push(`- ${rule}`)
    } else if (before === undefined) {
      lines.push(`+ ${rule}: ${after}`)
    } else if (before !== after) {
      lines.push(`~ ${rule}: ${after}`)
    }
  }
  return lines.toSorted((a, b) => collator.compare(a.slice(2), b.slice(2)))
}

describe.each([
  ['the default options', await defineConfig({ root: process.cwd() })],
  ['tailwindcss', await defineConfig({ root: process.cwd(), tailwindcss: true })],
  // Reference files turn on the theme checks, and `validateApply` the class checks
  [
    'tailwindcss, reference files and validateApply',
    await defineConfig({
      root: process.cwd(),
      referenceFiles: path.join(import.meta.dirname, '../node_modules/tailwindcss/theme.css'),
      tailwindcss: { validateApply: true },
    }),
  ],
])('with %s', (_name, config) => {
  it(`the rules on for ${REFERENCE_FILE}`, async () => {
    expect(listOf(await inventoryOf(config, REFERENCE_FILE))).toMatchSnapshot()
  })

  it.each(FILES.filter((file) => file !== REFERENCE_FILE))(
    `the rules on for %s, as a difference from ${REFERENCE_FILE}`,
    async (file) => {
      expect(
        diffOf(await inventoryOf(config, REFERENCE_FILE), await inventoryOf(config, file)),
      ).toMatchSnapshot()
    },
  )
})
