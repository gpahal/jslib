import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'

import { ESLint, type Linter } from 'eslint'
import ts from 'typescript'

/**
 * A file's output after `--fix`, `undefined` when the fix leaves it, and the rules left reporting in
 * it, or a fatal message's text
 */
export type FixResult = { output: string | undefined; rules: Array<string> }

/**
 * The rules that the running `fixFiles` or `reportFiles` call lets run. An async context rather
 * than a variable, so calls that overlap on a shared ESLint can't see each other's rules
 */
const runningRules = new AsyncLocalStorage<ReadonlySet<string>>()

/**
 * An ESLint for each set of configs and `fix`, made once: making one takes about 20 times as long
 * as linting a fixture file
 */
const eslints = new WeakMap<ReadonlyArray<Linter.Config>, Map<string, ESLint>>()

function eslintOf(dir: string, configs: ReadonlyArray<Linter.Config>, fix: boolean): ESLint {
  let byOptions = eslints.get(configs)
  if (byOptions === undefined) {
    byOptions = new Map()
    eslints.set(configs, byOptions)
  }
  const key = JSON.stringify([dir, fix])
  let eslint = byOptions.get(key)
  if (eslint === undefined) {
    eslint = new ESLint({
      cwd: dir,
      overrideConfigFile: true,
      overrideConfig: [...configs],
      fix,
      ruleFilter: ({ ruleId }) => runningRules.getStore()?.has(ruleId) === true,
    })
    byOptions.set(key, eslint)
  }
  return eslint
}

/**
 * The results of linting `files` with `configs` from `dir`, only `ruleIds` running, by each file's
 * `/`-separated path relative to `dir`. `configs` keys a cached ESLint, so it must not change
 */
async function lintFiles(
  dir: string,
  configs: ReadonlyArray<Linter.Config>,
  files: ReadonlyArray<string>,
  ruleIds: Iterable<string>,
  fix: boolean,
): Promise<Record<string, ESLint.LintResult>> {
  const eslint = eslintOf(dir, configs, fix)
  const results = await runningRules.run(new Set(ruleIds), async () => eslint.lintFiles([...files]))
  return Object.fromEntries(
    results.map((result) => [
      path.relative(dir, result.filePath).split(path.sep).join('/'),
      result,
    ]),
  )
}

function rulesOf(messages: ReadonlyArray<Linter.LintMessage>): Array<string> {
  return messages.map((message) => message.ruleId ?? message.message)
}

/**
 * The result of `--fix` for each of `files`, by its `/`-separated path relative to `dir`, linted
 * with `configs`, only `ruleIds` running. `configs` must not change after the first call with it
 */
export async function fixFiles({
  dir,
  configs,
  files,
  ruleIds,
}: {
  dir: string
  configs: ReadonlyArray<Linter.Config>
  files: ReadonlyArray<string>
  ruleIds: Iterable<string>
}): Promise<Record<string, FixResult>> {
  const results = await lintFiles(dir, configs, files, ruleIds, true)
  return Object.fromEntries(
    Object.entries(results).map(([file, result]) => [
      file,
      { output: result.output, rules: rulesOf(result.messages) },
    ]),
  )
}

/**
 * A file's problems without fixing, as in `FixResult`, and the rules among them that offer a fix,
 * which `--fix` would apply
 */
export type ReportResult = { rules: Array<string>; fixing: Array<string> }

/**
 * The problems of each of `files` without `--fix`, as `fixFiles` gives them. `--fix` changes a file
 * exactly when `fixing` isn't empty, without the passes that `--fix` lints again after a fix
 */
export async function reportFiles({
  dir,
  configs,
  files,
  ruleIds,
}: {
  dir: string
  configs: ReadonlyArray<Linter.Config>
  files: ReadonlyArray<string>
  ruleIds: Iterable<string>
}): Promise<Record<string, ReportResult>> {
  const results = await lintFiles(dir, configs, files, ruleIds, false)
  return Object.fromEntries(
    Object.entries(results).map(([file, result]) => [
      file,
      {
        rules: rulesOf(result.messages),
        fixing: rulesOf(result.messages.filter((message) => message.fix !== undefined)),
      },
    ]),
  )
}

/**
 * The diagnostics of type-checking `dir`'s TypeScript files with its `tsconfig.json`, so a fix that
 * leaves invalid TypeScript fails, as in `TS1234 src/file.ts: message`
 */
export function typeCheck(dir: string): Array<string> {
  const read = ts.readConfigFile(path.join(dir, 'tsconfig.json'), (file) => ts.sys.readFile(file))
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  }
  const config: unknown = read.config
  const { options, fileNames, errors } = ts.parseJsonConfigFileContent(config, ts.sys, dir)
  if (errors.length > 0) {
    throw new Error(
      errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'),
    )
  }
  const program = ts.createProgram({
    rootNames: fileNames.filter((file) => /\.[cm]?tsx?$/u.test(file)),
    // TypeScript's own libs can't hold an error that a fix made, and checking them takes most of
    // the time
    options: { ...options, noEmit: true, skipDefaultLibCheck: true },
  })
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(
    (diagnostic) =>
      `TS${String(diagnostic.code)} ${diagnostic.file === undefined ? '' : path.relative(dir, diagnostic.file.fileName)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
  )
}
