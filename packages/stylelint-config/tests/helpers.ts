import stylelint, { type Config } from 'stylelint'

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
