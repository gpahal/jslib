/**
 * Runs the `ts` examples of the README and the JSDoc. Literal and error result comments assert
 * results; prose comments leave statements executable
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

const packageDir = path.join(import.meta.dirname, '..')

type Outcome = { kind: 'value'; value: unknown } | { kind: 'error'; type: string; message: string }

const ERROR_COMMENT_REGEX = /^(?<type>Error|TypeError|RangeError|DOMException): (?<message>.+)$/
const STD_IMPORT_REGEX = /^@gpahal\/std\/(?<module>[a-z]+)$/

/**
 * Whether `node` is a literal value, such as `'a'`, `-1`, `null` or an array or object of them
 */
function isLiteral(node: ts.Node): boolean {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isBigIntLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === 'undefined') ||
    ts.isOmittedExpression(node)
  ) {
    return true
  }
  if (ts.isPrefixUnaryExpression(node)) {
    return node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)
  }
  return ts.isArrayLiteralExpression(node)
    ? node.elements.every((element) => isLiteral(element))
    : ts.isObjectLiteralExpression(node) &&
        node.properties.every(
          (property) =>
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name) ||
              ts.isNumericLiteral(property.name)) &&
            isLiteral(property.initializer),
        )
}

/**
 * The outcome a result comment states, or `undefined` for a prose comment
 */
function parseOutcome(comment: string): Outcome | undefined {
  const errorMatch = ERROR_COMMENT_REGEX.exec(comment)
  return errorMatch
    ? { kind: 'error', type: errorMatch.groups!['type']!, message: errorMatch.groups!['message']! }
    : parseLiteral(comment)
}

/**
 * The value a comment states, or `undefined` if it isn't a JS literal
 */
function parseLiteral(comment: string): Outcome | undefined {
  // Parenthesized, so an object literal isn't read as a block
  const text = `(${comment})`
  const sourceFile = ts.createSourceFile('comment.ts', text, ts.ScriptTarget.Latest)
  const [statement, ...rest] = sourceFile.statements
  const { diagnostics } = ts.transpileModule(text, { reportDiagnostics: true })
  if (
    statement === undefined ||
    rest.length > 0 ||
    (diagnostics?.length ?? 0) > 0 ||
    !ts.isExpressionStatement(statement) ||
    !ts.isParenthesizedExpression(statement.expression) ||
    !isLiteral(statement.expression.expression)
  ) {
    return undefined
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- Evaluates a literal the parser checked
  const value: unknown = (new Function(`return ${text}`) as () => unknown)()
  return { kind: 'value', value }
}

/**
 * The single-line comment after a statement, on the same line
 */
function getTrailingComment(code: string, statement: ts.Statement): string | undefined {
  const range = ts
    .getTrailingCommentRanges(code, statement.end)
    ?.find((comment) => comment.kind === ts.SyntaxKind.SingleLineCommentTrivia)
  return range === undefined ? undefined : code.slice(range.pos + 2, range.end).trim()
}

/**
 * A statement of an example as a statement of the function body that runs it
 */
function toBodyStatement(code: string, statement: ts.Statement, outcomes: Array<Outcome>): string {
  if (ts.isImportDeclaration(statement)) {
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
    const module = STD_IMPORT_REGEX.exec(specifier)?.groups?.['module']
    if (module === undefined) {
      throw new Error(`The example imports ${specifier}, which isn't a std module`)
    }
    const bindings = statement.importClause?.namedBindings
    if (
      bindings === undefined ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      return ''
    }
    if (!ts.isNamedImports(bindings)) {
      throw new Error(`The example imports ${specifier} without named imports`)
    }
    const names = bindings.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) =>
        element.propertyName === undefined
          ? element.name.text
          : `${element.propertyName.getText()}: ${element.name.text}`,
      )
    return `const { ${names.join(', ')} } = __modules[${JSON.stringify(module)}]`
  }

  const text = statement.getText()
  // `export` is the only module syntax left, and a function body can't have it
  const withoutExport = text.replace(/^export /, '')
  const comment = getTrailingComment(code, statement)
  if (comment === undefined || !ts.isExpressionStatement(statement)) {
    return withoutExport
  }
  const outcome = parseOutcome(comment)
  if (outcome === undefined) {
    return withoutExport
  }
  outcomes.push(outcome)
  return `await __check(${outcomes.length - 1}, async () => (${statement.expression.getText()}))`
}

/**
 * The body of an async function that runs the example `code`, with its checked statements calling `__check`,
 * and what each of them must give
 */
function compileBlock(code: string): { body: string; outcomes: Array<Outcome> } {
  const sourceFile = ts.createSourceFile('block.ts', code, ts.ScriptTarget.Latest, true)
  const outcomes: Array<Outcome> = []
  const source = sourceFile.statements
    .map((statement) => toBodyStatement(code, statement, outcomes))
    .join('\n')
  const body = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  return { body, outcomes }
}

/**
 * The built std modules that `code` imports, by name
 */
async function loadModules(code: string): Promise<Record<string, unknown>> {
  const modules = new Set(
    Array.from(
      code.matchAll(/from '@gpahal\/std\/(?<module>[a-z]+)'/g),
      (m) => m.groups!['module']!,
    ),
  )
  const entries = await Promise.all(
    Array.from(modules, async (module) => {
      const url = pathToFileURL(path.join(packageDir, 'build', `${module}.js`)).href
      return [module, (await import(url)) as unknown] as const
    }),
  )
  return Object.fromEntries(entries)
}

/**
 * The outcome of a statement that throws `error`
 */
function describeThrown(error: unknown): Outcome {
  return error instanceof Error
    ? { kind: 'error', type: error.constructor.name, message: error.message }
    : { kind: 'error', type: String(error), message: '' }
}

/**
 * What a checked statement of a block gives
 */
async function settle(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { kind: 'value', value: await run() }
  } catch (error) {
    return describeThrown(error)
  }
}

/**
 * A function that runs an example's compiled body, inside an async arrow since the body uses `await`
 */
function compileRunner(
  body: string,
): (
  modules: Record<string, unknown>,
  check: (index: number, run: () => Promise<unknown>) => Promise<void>,
) => Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- Runs a README block
  return new Function('__modules', '__check', `return (async () => {\n${body}\n})()`) as ReturnType<
    typeof compileRunner
  >
}

/**
 * Run the example `code` against the built modules, asserting the result of each statement with a
 * literal or error comment, and checking that every one of them ran
 */
export async function runExample(code: string): Promise<void> {
  const { body, outcomes } = compileBlock(code)
  let checked = 0
  const check = async (index: number, run: () => Promise<unknown>): Promise<void> => {
    expect(await settle(run), `result ${index}`).toStrictEqual(outcomes[index])
    checked++
  }
  await compileRunner(body)(await loadModules(code), check)
  expect(checked).toBe(outcomes.length)
}
