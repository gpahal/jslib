import path from 'node:path'

import { ESLint, type Linter } from 'eslint'
import ts from 'typescript'

/**
 * A file's output after `--fix`, `undefined` when the fix leaves it, and the rules left reporting in
 * it, or a fatal message's text
 */
export type FixResult = { output: string | undefined; rules: Array<string> }

/**
 * The result of `--fix` for each of `files`, by its `/`-separated path relative to `dir`, linted
 * with `configs`, only `ruleIds` running
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
  const rules = new Set(ruleIds)
  const eslint = new ESLint({
    cwd: dir,
    overrideConfigFile: true,
    overrideConfig: [...configs],
    fix: true,
    ruleFilter: ({ ruleId }) => rules.has(ruleId),
  })
  const results = await eslint.lintFiles([...files])
  return Object.fromEntries(
    results.map((result) => [
      path.relative(dir, result.filePath).split(path.sep).join('/'),
      {
        output: result.output,
        rules: result.messages.map((message) => message.ruleId ?? message.message),
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
    options: { ...options, noEmit: true },
  })
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(
    (diagnostic) =>
      `TS${String(diagnostic.code)} ${diagnostic.file === undefined ? '' : path.relative(dir, diagnostic.file.fileName)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
  )
}
