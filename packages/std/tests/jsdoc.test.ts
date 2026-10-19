import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

import { runExample } from './helpers'

const packageDir = path.join(import.meta.dirname, '..')

/**
 * The `ts` examples of the JSDoc in `src/`, by the file name each compiles as. `src/internal/` is
 * included, since its public functions are re-exported
 */
function getExamples(): Map<string, string> {
  const examples = new Map<string, string>()
  const files = fs
    .readdirSync(path.join(packageDir, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
  for (const file of files) {
    const source = fs.readFileSync(path.join(packageDir, 'src', file), 'utf8')
    const comments = source.matchAll(/\/\*\*[\s\S]*?\*\//g)
    let index = 0
    for (const [comment] of comments) {
      if (!comment.includes('@example')) continue
      const markdown = comment.replaceAll(/^[\t ]*\* ?/gm, '')
      for (const [, code] of markdown.matchAll(/```ts\n([\s\S]*?)```/g)) {
        const name = path.join(
          packageDir,
          'examples',
          `${file.replaceAll(/[/\\]/g, '-').replace(/\.ts$/, '')}-${index++}.mts`,
        )
        // Compile each snippet as written, with its own imports and module scope.
        examples.set(name, code!)
      }
    }
  }
  return examples
}

const examples = getExamples()

test('JSDoc examples compile against the public declarations', { timeout: 30_000 }, () => {
  expect(examples.size).toBeGreaterThan(0)
  expect([...examples.keys()]).toContainEqual(expect.stringContaining('internal-escape'))
  const options: ts.CompilerOptions = {
    strict: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.NodeNext,
    types: [],
    lib: ['lib.es2024.d.ts', 'lib.dom.d.ts'],
  }
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  host.readFile = (file) => examples.get(file) ?? readFile(file)
  const program = ts.createProgram(
    Array.from(examples, ([file]) => file),
    options,
    host,
  )
  expect(
    ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => packageDir,
      getNewLine: () => '\n',
    }),
  ).toBe('')
})

describe('JSDoc examples', () => {
  beforeEach(() => {
    // The examples fetch, which the tests don't
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('')),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(Array.from(examples, ([name, code]) => ({ name: path.basename(name, '.mts'), code })))(
    '$name gives the results its comments state',
    async ({ code }) => {
      await expect(runExample(code)).resolves.toBeUndefined()
    },
  )
})
