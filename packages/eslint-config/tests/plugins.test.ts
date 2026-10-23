import fs from 'node:fs/promises'
import path from 'node:path'

import { RuleTester } from 'eslint'
import type { ESLint } from 'eslint'
import { parser as tsEslintParser } from 'typescript-eslint'

import { MARKDOWN_PLUGIN } from '@/internal/markdown/plugin'
import { named, withSetupNamed } from '@/internal/naming'
import { GPAHAL_PLUGIN } from '@/internal/plugin'

const { name, version } = JSON.parse(
  await fs.readFile(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'),
) as { name: string; version: string }

/**
 * The rules of `plugin`, by name
 */
function rulesOf(plugin: ESLint.Plugin): Array<[string, unknown]> {
  return Object.entries(plugin.rules ?? {})
}

describe("this package's plugins", () => {
  it.each([
    ['@gpahal', GPAHAL_PLUGIN, name],
    ['@gpahal/markdown', MARKDOWN_PLUGIN, `${name}/markdown`],
  ] as Array<[string, ESLint.Plugin, string]>)(
    '%s declares its name and the package version, which `--cache` tells releases apart by',
    (_prefix, plugin, pluginName) => {
      expect(plugin.meta).toMatchObject({ name: pluginName, version })
    },
  )

  it('declare the Markdown rules for Markdown languages only', () => {
    expect(
      rulesOf(MARKDOWN_PLUGIN).filter(
        ([, rule]) =>
          JSON.stringify((rule as { meta?: { languages?: unknown } }).meta?.languages) !==
          JSON.stringify(['markdown/*']),
      ),
    ).toEqual([])
  })
})

describe('withSetupNamed', () => {
  const plugin: ESLint.Plugin = { rules: {} }

  it('registers a plugin that several configs share once', () => {
    expect(
      withSetupNamed('setup', [
        { name: 'a', plugins: { x: plugin }, settings: { a: 1 } },
        { name: 'b', plugins: { x: plugin }, settings: { b: 1 } },
      ]),
    ).toEqual([
      { name: 'setup', plugins: { x: plugin } },
      { name: 'a', settings: { a: 1 } },
      { name: 'b', settings: { b: 1 } },
    ])
  })

  it('throws on two different plugins under one name, naming it', () => {
    expect(() =>
      withSetupNamed('setup', [
        { name: 'a', plugins: { x: plugin } },
        { name: 'b', plugins: { x: { rules: {} } } },
      ]),
    ).toThrow(
      '@gpahal/eslint-config: setup config `setup`: has two different plugins named `x`, one from the config `b`',
    )
  })
})

describe('named', () => {
  it('keeps one of two equal upstream configs with the same name', () => {
    const base = { name: 'x/base', rules: { 'no-console': 'error' as const } }
    const configs = named('a', { files: ['**/*.js'] }, [
      [base, { name: 'x/rules', rules: {} }],
      [{ ...base }],
    ])
    expect(configs.map(({ name, rules }) => ({ name, rules }))).toEqual([
      { name: 'gpahal/a/x/base', rules: { 'no-console': 'error' } },
      { name: 'gpahal/a/x/rules', rules: {} },
    ])
  })

  it('throws on two different upstream configs with the same name', () => {
    expect(() =>
      named('a', { files: ['**/*.js'] }, [
        { name: 'x/base', rules: { 'no-console': 'error' } },
        { name: 'x/base', rules: { 'no-console': 'warn' } },
      ]),
    ).toThrow(
      '@gpahal/eslint-config: config `gpahal/a/x/base`: two different upstream configs have this name, so one would be dropped',
    )
  })
})

/**
 * `@gpahal/no-node-globals`' options for `globals` with `checkGlobalObject`
 */
function checkGlobalObject(globals: Array<unknown>): Array<unknown> {
  return [{ globals, checkGlobalObject: true }]
}

describe('@gpahal/no-node-globals', () => {
  const tester = new RuleTester({
    languageOptions: {
      parser: tsEslintParser,
      globals: { globalThis: 'readonly', process: 'readonly' },
    },
  })
  const allowEnv = [{ name: 'process', allowProperties: ['env'] }]
  const error = { messageId: 'defaultMessage' }

  tester.run('no-node-globals', GPAHAL_PLUGIN.rules['no-node-globals'], {
    valid: [
      ...['(process as any).env.X', "process['env'].X", 'typeof process'].map((code) => ({
        code,
        options: allowEnv,
      })),
      ...['globalThis.process.env.X', "globalThis['process'].env"].map((code) => ({
        code,
        options: checkGlobalObject(allowEnv),
      })),
      // `typeof` doesn't read an undeclared global
      { code: 'typeof (process as any)', options: ['process'] },
      { code: 'typeof globalThis[`process`]', options: checkGlobalObject(['process']) },
    ],
    invalid: [
      // `typeof process?.env` reads `process`, which throws when it's undeclared
      ...['process!.env.X', 'typeof process?.env'].map((code) => ({
        code,
        options: ['process'],
        errors: [error],
      })),
      ...['typeof globalThis[process]', 'globalThis.process.env.X'].map((code) => ({
        code,
        options: checkGlobalObject(['process']),
        errors: [error],
      })),
      ...['const p = process!', `process[\`\${name}\`]`].map((code) => ({
        code,
        options: allowEnv,
        errors: [error],
      })),
      { code: 'globalThis.process.argv', options: checkGlobalObject(allowEnv), errors: [error] },
    ],
  })
})
