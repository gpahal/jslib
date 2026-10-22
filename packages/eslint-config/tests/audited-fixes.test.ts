import fs from 'node:fs/promises'
import path from 'node:path'

import type { Linter } from 'eslint'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig, type EslintConfigOptions } from '@/index'
import { AUDITED_SAFE_FIXES, UNFIXED_FIXABLE_RULES } from '@/internal/fix-policy'

import { fixFiles, typeCheck } from './fix-helpers'
import { collator, FIXTURES_DIR } from './helpers'

// An audited rule's fixture, `<variant>/<rule ID>` plus extensions or a folder of that name, snapshots
// its fix. An unfixed rule's, in `unfixed`, must report without a fix. A rule the presets turn off
// is turned on by an `eslint` comment. The `@gpahal/*` rules and `NEVER_FIXING_RULES` have none

const FIXTURE_DIR = path.join(FIXTURES_DIR, 'audited-fixes')

const OPTIONS: Partial<EslintConfigOptions> = {
  react: true,
  astro: true,
  html: true,
  node: true,
  vitest: true,
  playwright: true,
  storybook: true,
  pnpm: true,
  packageJson: true,
  tailwindcss: { entryPoint: 'styles.css' },
}

/**
 * The options of each variant folder: `src`, the folders of the rules that an option turns on or
 * gives a fix, and `unfixed`, for the rules of `UNFIXED_FIXABLE_RULES`
 */
const VARIANTS: Record<string, Partial<EslintConfigOptions>> = {
  src: OPTIONS,
  unfixed: OPTIONS,
  'type-stripping': { ...OPTIONS, node: { typeStripping: true } },
  'remove-unused': { ...OPTIONS, imports: { removeUnused: true } },
}

/**
 * Rules of `UNFIXED_FIXABLE_RULES` whose source reports without a fix whatever their options, though
 * `meta.fixable` is set, so no configuration needs a fixture showing that they don't fix. They stay
 * in the list for the guardrail of `report-only.test.ts`. Check a new version's source before
 * keeping one here
 */
const NEVER_FIXING_RULES: ReadonlyArray<string> = [
  // Only suggestions
  '@eslint-react/dom-no-missing-iframe-sandbox',
  '@eslint-react/dom-no-unsafe-target-blank',
  '@eslint-react/jsx-no-children-prop',
  '@eslint-react/jsx-no-children-prop-with-children',
  '@eslint-react/jsx-no-leaked-dollar',
  '@eslint-react/jsx-no-leaked-semicolon',
  '@eslint-react/no-context-provider',
  '@eslint-react/no-forward-ref',
  '@eslint-react/no-use-context',
  'react-hooks/config',
  'react-hooks/error-boundaries',
  'react-hooks/gating',
  'react-hooks/globals',
  'react-hooks/immutability',
  'react-hooks/incompatible-library',
  'react-hooks/preserve-manual-memoization',
  'react-hooks/purity',
  'react-hooks/refs',
  'react-hooks/set-state-in-effect',
  'react-hooks/set-state-in-render',
  'react-hooks/static-components',
  'react-hooks/unsupported-syntax',
  'react-hooks/use-memo',
  'react-hooks/void-use-memo',
  'storybook/no-redundant-story-name',
  'storybook/prefer-pascal-case',
  // Neither fixes nor suggestions
  'better-tailwindcss/no-conflicting-classes',
  'better-tailwindcss/no-unknown-classes',
  'playwright/no-standalone-expect',
  'pnpm/yaml-no-duplicate-catalog-item',
  'pnpm/yaml-no-unused-catalog-item',
  'storybook/use-storybook-expect',
  'vitest/no-identical-title',
  'vitest/no-interpolation-in-snapshots',
]

/**
 * The audited rules with a fixture. Our own rules' tests check their fixes
 */
const FIXTURE_AUDITED_RULES = AUDITED_SAFE_FIXES.filter((ruleId) => !ruleId.startsWith('@gpahal/'))

/**
 * The unfixed rules with a fixture, those that a configuration keeps from fixing
 */
const FIXTURE_UNFIXED_RULES = UNFIXED_FIXABLE_RULES.filter(
  (ruleId) => !NEVER_FIXING_RULES.includes(ruleId),
)

/**
 * Each fixture file by its `/`-separated path in the fixture, sorted
 */
async function listFixtures(): Promise<Array<string>> {
  const files = await Promise.all(
    Object.keys(VARIANTS).map(async (variant) => {
      const entries = await fs.readdir(path.join(FIXTURE_DIR, variant), {
        recursive: true,
        withFileTypes: true,
      })
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) =>
          path
            .relative(FIXTURE_DIR, path.join(entry.parentPath, entry.name))
            .split(path.sep)
            .join('/'),
        )
    }),
  )
  return files.flat().toSorted((a, b) => collator.compare(a, b))
}

/**
 * The variant and rule of a fixture file: the longest rule ID that its path in the variant folder
 * starts with, followed by `.` or `/`, of `UNFIXED_FIXABLE_RULES` in `unfixed` and of
 * `AUDITED_SAFE_FIXES` elsewhere
 */
function caseOf(file: string): { variant: string; ruleId: string | undefined } {
  const [variant = '', ...rest] = file.split('/')
  const name = rest.join('/')
  const ruleIds = variant === 'unfixed' ? UNFIXED_FIXABLE_RULES : AUDITED_SAFE_FIXES
  const ruleId = ruleIds
    .filter((id) => name.startsWith(`${id}.`) || name.startsWith(`${id}/`))
    .toSorted((a, b) => b.length - a.length)[0]
  return { variant, ruleId }
}

describe('audited fixes', () => {
  let dir: string
  let dispose: () => Promise<void>
  let fixtures: Array<string>
  const configs = new Map<string, Promise<Array<Linter.Config>>>()
  // The fixed output of each fixture that a test below fixed
  const outputs = new Map<string, string>()

  async function configsOf(variant: string): Promise<Array<Linter.Config>> {
    let variantConfigs = configs.get(variant)
    if (variantConfigs === undefined) {
      variantConfigs = Promise.resolve(
        defineConfig({ root: dir, isInEditor: false, gitignore: false, ...VARIANTS[variant] }),
      )
      configs.set(variant, variantConfigs)
    }
    return variantConfigs
  }

  beforeAll(async () => {
    const project = await withTmpProject('eslint-config')
    dir = project.dir
    dispose = async () => project[Symbol.asyncDispose]()
    await fs.cp(FIXTURE_DIR, dir, { recursive: true })
    await fs.symlink(
      path.join(import.meta.dirname, '..', 'node_modules'),
      path.join(dir, 'node_modules'),
    )
    fixtures = await listFixtures()
  })
  afterAll(async () => dispose())

  it('has a fixture for every audited and unfixed rule, and a rule for every fixture', () => {
    const shown = new Set(fixtures.map((file) => caseOf(file).ruleId))
    // Add a fixture that the rule's fix changes, as the comment above says
    expect(FIXTURE_AUDITED_RULES.filter((ruleId) => !shown.has(ruleId))).toEqual([])
    expect(FIXTURE_UNFIXED_RULES.filter((ruleId) => !shown.has(ruleId))).toEqual([])
    expect(
      fixtures.filter((file) => {
        const { variant, ruleId } = caseOf(file)
        const ruleIds = variant === 'unfixed' ? FIXTURE_UNFIXED_RULES : FIXTURE_AUDITED_RULES
        return ruleId === undefined || !ruleIds.includes(ruleId)
      }),
    ).toEqual([])
    expect(NEVER_FIXING_RULES.filter((ruleId) => !UNFIXED_FIXABLE_RULES.includes(ruleId))).toEqual(
      [],
    )
  })

  it.for(FIXTURE_AUDITED_RULES)('fixes the fixture of %s', async (ruleId, { expect }) => {
    const files = fixtures.filter((file) => caseOf(file).ruleId === ruleId)
    const results: Record<string, string | undefined> = {}
    const variants = new Set(files.map((file) => caseOf(file).variant))
    for (const variant of variants) {
      const variantFiles = files.filter((file) => caseOf(file).variant === variant)
      const fixed = await fixFiles({
        dir,
        configs: await configsOf(variant),
        files: variantFiles,
        ruleIds: [ruleId],
      })
      for (const file of variantFiles) {
        results[file] = fixed[file]?.output
      }
    }
    expect(Object.values(results).some((output) => output !== undefined)).toBe(true)
    for (const [file, output] of Object.entries(results)) {
      if (output !== undefined) {
        outputs.set(file, output)
      }
    }
    expect(results).toMatchSnapshot()
  })

  it.for(FIXTURE_UNFIXED_RULES)(
    'reports the fixture of %s without fixing it',
    async (ruleId, { expect }) => {
      const files = fixtures.filter((file) => caseOf(file).ruleId === ruleId)
      const results = await fixFiles({
        dir,
        configs: await configsOf('unfixed'),
        files,
        ruleIds: [ruleId],
      })
      expect(files.filter((file) => results[file]?.output !== undefined)).toEqual([])
      // A fixture needs a file that the rule reports
      expect(files.some((file) => results[file]?.rules.includes(ruleId))).toBe(true)
    },
  )

  it('leaves the fixed TypeScript fixtures compiling', async () => {
    for (const [file, output] of outputs) {
      await fs.writeFile(path.join(dir, file), output)
    }
    expect(typeCheck(dir)).toEqual([])
  })
})
