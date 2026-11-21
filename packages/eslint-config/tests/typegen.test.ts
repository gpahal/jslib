import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { compileRule } from 'eslint-typegen/core'

import { isRecord } from '@gpahal/std/objects'

import { defineConfig } from '@/index'
import type { EslintConfigOptions } from '@/index'
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
} from '../scripts/typegen'

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
})

// A definition reached twice once compiled to two declarations of one interface, with two index
// signatures, which `skipLibCheck: false` rejects
test('the compiler declares each type name once for a definition reached twice', async () => {
  const rule = patchRule({
    create: () => ({}),
    meta: {
      schema: {
        type: 'array',
        items: [
          {
            type: 'object',
            properties: {
              a: { $ref: '#/definitions/flags' },
              b: { anyOf: [{ enum: [false] }, { $ref: '#/definitions/flags' }] },
            },
            additionalProperties: false,
          },
        ],
        definitions: { flags: { type: 'object', additionalProperties: { type: 'boolean' } } },
      },
    },
  })
  const names = (await compileRule('x/twice', rule)).typeDeclarations.flatMap(
    (line) => /^(?:interface|type) (\w+)/.exec(line)?.[1] ?? [],
  )
  expect(names.length).toBeGreaterThan(1)
  expect(new Set(names).size).toBe(names.length)
})

test('names every config uniquely under `gpahal/`', async () => {
  const configNames = (await defineConfig(ALL_ON_OPTIONS)).map((config) => config.name)
  expect(configNames.filter((name) => name?.startsWith('gpahal/') !== true)).toEqual([])
  expect(new Set(configNames).size).toBe(configNames.length)
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
