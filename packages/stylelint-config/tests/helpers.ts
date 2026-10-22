import fs from 'node:fs/promises'
import path from 'node:path'

import stylelint, { type Config } from 'stylelint'

/**
 * The real path of the package's Tailwind CSS
 */
export const TAILWIND_DIR = await fs.realpath(
  path.join(import.meta.dirname, '../node_modules/tailwindcss'),
)

/**
 * Links the package's Tailwind CSS into `dir`'s `node_modules`
 */
export async function linkTailwind(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true })
  await fs.symlink(TAILWIND_DIR, path.join(dir, 'node_modules/tailwindcss'))
}

/**
 * Tailwind's problem with `css`, which the Tailwind rules must agree with: the message of the error
 * that `compile()` or building the class `flex` throws, or else its first warning, or `undefined`.
 * It loads only Tailwind's own stylesheets and no module, as for a path that doesn't exist
 */
export async function tailwindProblemOf(css: string): Promise<string | undefined> {
  // Imported here, so the tests that don't ask Tailwind don't load it
  const { compile } = await import('tailwindcss')
  const warnings: Array<string> = []
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: Array<unknown>) => {
    warnings.push(args.map(String).join(' '))
  })
  try {
    const compiler = await compile(css, {
      base: TAILWIND_DIR,
      loadStylesheet: async (id: string) => {
        const file = id === 'tailwindcss' ? path.join(TAILWIND_DIR, 'index.css') : id
        if (!file.startsWith(TAILWIND_DIR)) throw new Error(`Can't resolve '${id}'`)
        return { path: file, base: path.dirname(file), content: await fs.readFile(file, 'utf8') }
      },
      loadModule: async (id: string) => {
        throw new Error(`Can't resolve '${id}'`)
      },
    })
    compiler.build(['flex'])
    return warnings[0]
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    warn.mockRestore()
  }
}

/**
 * The rules that `config` reports on `code`, and its invalid options
 */
export async function lintRules(
  code: string,
  config: Config,
  codeFilename?: string,
): Promise<Array<string>> {
  const { results } = await stylelint.lint({
    code,
    config,
    ...(codeFilename !== undefined && { codeFilename }),
  })
  return results.flatMap((result) => [
    ...result.warnings.map((warning) => warning.rule),
    ...result.invalidOptionWarnings.map((warning) => `invalid option: ${warning.text}`),
  ])
}

/**
 * The warning texts that `config` reports on `code`, disable comment problems included
 */
export async function lintTexts(code: string, config: Config): Promise<Array<string>> {
  const { results } = await stylelint.lint({ code, config })
  return results.flatMap((result) => result.warnings.map((warning) => warning.text))
}

/**
 * `code` after `stylelint --fix` with `config`
 */
export async function fix(code: string, config: Config, codeFilename?: string): Promise<string> {
  const { code: fixed } = await stylelint.lint({
    code,
    config,
    ...(codeFilename !== undefined && { codeFilename }),
    fix: true,
  })
  return fixed!
}

/**
 * The top-level rules of `config`, as Stylelint merges them for a file no override matches: those
 * of the config objects in its `extends`, recursively and in order, then its own. Configs given by
 * path or name, such as stylelint-config-standard, are left out
 */
export function topLevelRules(config: Config): Record<string, unknown> {
  const extended: Array<unknown> = [config.extends ?? []].flat()
  const rules: Record<string, unknown> = {}
  for (const entry of extended) {
    if (typeof entry === 'object' && entry !== null)
      Object.assign(rules, topLevelRules(entry as Config))
  }
  return Object.assign(rules, config.rules)
}
