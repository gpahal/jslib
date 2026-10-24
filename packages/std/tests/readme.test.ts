import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

import { runExample } from './helpers'

const packageDir = path.join(import.meta.dirname, '..')
const readme = fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8')

type Block = { heading: string; code: string }

const BLOCK_REGEX = /^#+ (?<heading>.+)$|^```(?<language>[^\n]*)\n(?<code>[\s\S]*?)^```$/gm

/**
 * The `ts` blocks of the README, each with the heading it's under
 */
function getBlocks(markdown: string): Array<Block> {
  const blocks: Array<Block> = []
  let heading = ''
  for (const { groups } of markdown.matchAll(BLOCK_REGEX)) {
    if (groups?.['heading'] !== undefined) {
      heading = groups['heading']
    } else if (groups?.['language'] === 'ts') {
      blocks.push({ heading, code: groups['code']! })
    }
  }
  return blocks
}

/**
 * The `ts` examples of the JSDoc in `src/`, by the file name each compiles as. `src/internal/` is
 * included, since its public functions are re-exported
 */
function getJsdocExamples(): Map<string, string> {
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
        examples.set(name, code!)
      }
    }
  }
  return examples
}

/**
 * The type errors of `files`, by path, in one program, so the libs are read once. Each file is an
 * ES module of its own, so examples don't share their top-level names, and `@gpahal/std/*`
 * resolves through the package's `exports` to the public declarations
 */
function typeCheck(files: ReadonlyMap<string, string>): string {
  const options: ts.CompilerOptions = {
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noPropertyAccessFromIndexSignature: true,
    // As the repo's tsconfigs set it. The libs and declarations are checked where they're built
    skipLibCheck: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.NodeNext,
    types: [],
    lib: ['lib.es2024.d.ts', 'lib.dom.d.ts'],
  }
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  host.readFile = (file) => files.get(file) ?? readFile(file)
  host.fileExists = (file) => files.has(file) || fileExists(file)
  const program = ts.createProgram([...files.keys()], options, host)
  return ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => packageDir,
    getNewLine: () => '\n',
  })
}

const blocks = getBlocks(readme)
const jsdocExamples = getJsdocExamples()
const collator = new Intl.Collator()

test('README and JSDoc examples compile against the public declarations', () => {
  expect(blocks.length).toBeGreaterThan(0)
  expect(jsdocExamples.size).toBeGreaterThan(0)
  expect([...jsdocExamples.keys()]).toContainEqual(expect.stringContaining('internal-escape'))
  const readmeFiles = blocks.map(
    ({ code }, i) => [path.join(packageDir, 'examples', `readme-${i}.mts`), code] as const,
  )
  expect(typeCheck(new Map([...readmeFiles, ...jsdocExamples]))).toBe('')
})

describe('README examples', () => {
  it('has a block for each module', () => {
    const modules = fs
      .readdirSync(path.join(packageDir, 'src'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => path.basename(file, '.ts'))
      .toSorted((a, b) => collator.compare(a, b))
    expect(
      [...new Set(blocks.map(({ heading }) => heading))].toSorted((a, b) => collator.compare(a, b)),
    ).toEqual(modules)
  })

  it.each(blocks)('$heading', async ({ code }) => {
    await expect(runExample(code)).resolves.toBeUndefined()
  })
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

  it.each(
    Array.from(jsdocExamples, ([name, code]) => ({ name: path.basename(name, '.mts'), code })),
  )('$name gives the results its comments state', async ({ code }) => {
    await expect(runExample(code)).resolves.toBeUndefined()
  })
})
