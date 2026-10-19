import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { Rule } from 'eslint'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import { compileRule } from 'eslint-typegen/core'

import { assertBuildIsCurrent } from '@gpahal/internal/node/testing'
import { isRecord } from '@gpahal/std/objects'

import { defineConfig, type EslintConfigOptions } from '@/index'
import { AREAS } from '@/internal/areas'
import { GITIGNORE_CONFIG_NAMES } from '@/internal/names'
import { resolveOptions } from '@/internal/resolve'

import {
  ALL_ON_OPTIONS,
  AREA_RULES,
  CONFIG_NAMES_PATH,
  generateTypegen,
  getConfigNames,
  isResolvedConfigName,
  patchRule,
  TYPEGEN_PATH,
  withAdditionalProperties,
  withInlinedDefinitions,
} from '../scripts/typegen'
import { BUILD_DIR } from './helpers'

beforeAll(async () => assertBuildIsCurrent(BUILD_DIR))

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

test('the rule and config name types and the config names are up to date', async () => {
  const emitWarning = vi.spyOn(process, 'emitWarning')
  let warnings: Array<unknown> = []
  const [typegen, configNames, generated] = await Promise.all([
    fs.readFile(TYPEGEN_PATH, 'utf8'),
    fs.readFile(CONFIG_NAMES_PATH, 'utf8'),
    generateTypegen(),
  ]).finally(() => {
    warnings = emitWarning.mock.calls.map(([, options]) => options)
    emitWarning.mockRestore()
  })
  // The fixtures' setup warnings say nothing about the types
  expect(
    warnings.filter(
      (options) =>
        isRecord(options) && Reflect.get(options, 'code') === 'GPAHAL_DEFAULT_PROJECT_NODE_TYPES',
    ),
  ).toEqual([])
  // A hash, so a stale file fails with one line instead of a diff of the whole file
  expect(sha256(typegen), 'run `pnpm --filter @gpahal/eslint-config gen`').toBe(
    sha256(generated.typegen),
  )
  expect(configNames, 'run `pnpm --filter @gpahal/eslint-config gen`').toBe(generated.configNames)
})

test('patches rule schemas so the compiler writes declarations that type-check', () => {
  expect(
    withAdditionalProperties([
      {
        type: 'object',
        properties: { a: { type: 'object', properties: {}, additionalProperties: false } },
        patternProperties: { '^x': { type: 'number' } },
      },
    ]),
  ).toEqual([
    {
      type: 'object',
      properties: { a: { type: 'object', properties: {}, additionalProperties: false } },
      patternProperties: { '^x': { type: 'number' } },
      additionalProperties: true,
    },
  ])
  const node = { type: 'object', properties: { next: { $ref: '#/definitions/node' } } }
  expect(
    withInlinedDefinitions({
      type: 'object',
      properties: {
        a: { $ref: '#/definitions/flags', description: 'A' },
        b: { $ref: '#/definitions/node' },
      },
      definitions: { flags: { type: 'object', additionalProperties: { type: 'boolean' } }, node },
    }),
  ).toMatchObject({
    properties: {
      a: { type: 'object', additionalProperties: { type: 'boolean' }, description: 'A' },
      // A recursive `$ref` stays
      b: { type: 'object', properties: { next: { $ref: '#/definitions/node' } } },
    },
  })
  expect(
    withInlinedDefinitions({
      type: 'object',
      properties: { a: { $ref: '#/$defs/flags' } },
      $defs: { flags: { type: 'object', additionalProperties: { type: 'boolean' } } },
    }),
  ).toMatchObject({
    properties: { a: { type: 'object', additionalProperties: { type: 'boolean' } } },
  })
})

describe('a rule whose schema the compiler would declare a name twice for', () => {
  const rule = eslintPluginUnicorn.rules?.['name-replacements']
  const schema = JSON.stringify(rule?.meta?.schema)

  /**
   * The type declarations of `rule` with `text` as its schema, as `patchRule` patches it
   */
  async function declarationsOf(name: string, text: string): Promise<Array<string>> {
    const patched = await patchRule(name, {
      create: () => ({}),
      ...rule,
      meta: { ...rule?.meta, schema: JSON.parse(text) as Rule.RuleMetaData['schema'] },
    })
    return (await compileRule(name, patched)).typeDeclarations
  }

  it('throws when inlining leaves a name declared twice', async () => {
    const { definitions, items, ...rest } = JSON.parse(schema) as Record<string, unknown>
    const first: unknown = Array.isArray(items) ? items[0] : undefined
    const nested = JSON.stringify({
      ...rest,
      items: [{ ...(isRecord(first) && first), definitions }],
    }).replaceAll('#/definitions/', '#/items/0/definitions/')
    await expect(declarationsOf('x/nested', nested)).rejects.toThrow(
      '@gpahal/eslint-config: typegen: `x/nested`: declares a type name twice',
    )
  })
})

test("publishes every source the build's declaration map points to, for go-to-definition", async () => {
  const packageDir = path.join(import.meta.dirname, '..')
  const { files } = JSON.parse(
    await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'),
  ) as { files: Array<string> }
  const { sources } = JSON.parse(
    await fs.readFile(path.join(packageDir, 'build/index.d.ts.map'), 'utf8'),
  ) as { sources: Array<string> }
  const isPublished = (file: string) =>
    files.some((entry) => file === entry || file.startsWith(`${entry}/`)) &&
    files.every((entry) => !(entry.startsWith('!') && entry.slice(1) === file))
  // `@gpahal/internal`'s declarations are bundled but not published. TypeScript follows a map only
  // to a source that exists, so go-to-definition stays in the bundled declarations for them
  const internalDir = path.join('..', 'internal')
  const unpublished = sources
    .map((source) => path.relative(packageDir, path.resolve(packageDir, 'build', source)))
    .filter((file) => !isPublished(file) && !file.startsWith(`${internalDir}${path.sep}`))
  expect(unpublished).toEqual([])
})

test('the generator names a rule of every area, and turns every area on', () => {
  const areaRules = new Map<string, string>(Object.entries(AREA_RULES))
  for (const [area, { prefixes }] of Object.entries(AREAS)) {
    const rule = areaRules.get(area) ?? ''
    expect(
      prefixes.some((prefix) => (prefix === '' ? !rule.includes('/') : rule.startsWith(prefix))),
      area,
    ).toBe(true)
  }
  expect(areaRules.size).toBe(Object.keys(AREAS).length)
  const { isOn } = resolveOptions(ALL_ON_OPTIONS)
  expect(Object.entries(isOn).filter(([, on]) => !on)).toEqual([])
})

test("names the git ignore configs whatever the checkout's ignore files are", () => {
  // A fresh clone has no `info/exclude` patterns, and no `.gitignore` under `root`
  const configSets = [[{ name: 'gpahal/setup' }, { name: 'gpahal/ignores/defaults' }]]
  expect(getConfigNames(configSets)).toEqual([
    'gpahal/setup',
    ...GITIGNORE_CONFIG_NAMES,
    'gpahal/ignores/defaults',
  ])
  expect(
    getConfigNames([
      [
        { name: 'gpahal/setup' },
        { name: 'gpahal/ignores/gitignore' },
        { name: 'gpahal/ignores/gitignore' },
        { name: 'gpahal/ignores/defaults' },
      ],
    ]),
  ).toEqual(getConfigNames(configSets))
})

/**
 * Option sets that add configs in other combinations than the one `pnpm gen` names them from
 */
const OPTION_SETS: Array<Partial<EslintConfigOptions>> = [
  {},
  { typeAware: false, react: true, astro: true, vitest: true },
  { isInEditor: true, antislop: { slop: false }, nextjs: true, markdown: true, node: true },
  // Rules that also run in Markdown and data files, so their areas add `user-rules` configs there
  {
    markdown: true,
    antislop: { rules: { 'slop/no-em-dash': 'off' } },
    eslintComments: { rules: { '@eslint-community/eslint-comments/require-description': 'off' } },
  },
]

test.each(OPTION_SETS)(
  'names every config of %j in the generated types, but the ones the composer cannot reach',
  async (options) => {
    const typegen = await fs.readFile(TYPEGEN_PATH, 'utf8')
    const typedNames = new Set(
      typegen
        .slice(typegen.indexOf('export type ConfigNames'))
        .matchAll(/^ {2}\| '([^']+)'$/gm)
        .map(([, name]) => name),
    )
    const configs = await defineConfig({
      root: path.join(import.meta.dirname, 'fixtures'),
      isInEditor: false,
      ...options,
    })
    const untyped = configs
      .map((config) => config.name)
      .filter(
        (name) => name === undefined || (!typedNames.has(name) && !isResolvedConfigName(name)),
      )
    expect(untyped).toEqual([])
    expect(
      [...typedNames].filter((name) => name !== undefined && isResolvedConfigName(name)),
    ).toEqual([])
  },
)
