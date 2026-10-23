import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

import { runExample } from './helpers'

// Literal and error comments assert results. Prose comments leave statements executable.

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
 * The type errors of the blocks, each compiled as a module of its own next to the tests, with the
 * tests' compiler options and `@gpahal/std/*` resolved to the sources
 */
function typeCheckBlocks(codes: ReadonlyArray<string>): string {
  const configPath = path.join(packageDir, 'tests', 'tsconfig.json')
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    },
  )
  const options: ts.CompilerOptions = {
    ...config!.options,
    noEmit: true,
    incremental: false,
    paths: { ...config!.options.paths, '@gpahal/std/*': [path.join(packageDir, 'src', '*')] },
  }
  // `export {}` makes each block a module, so blocks don't share their top-level names
  const files = new Map(
    codes.map((code, i) => [
      path.join(packageDir, 'tests', `readme-block-${i}.ts`),
      `${code}\nexport {}\n`,
    ]),
  )
  const baseHost = ts.createCompilerHost(options)
  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (file) => files.has(file) || baseHost.fileExists(file),
    readFile: (file) => files.get(file) ?? baseHost.readFile(file),
    getSourceFile: (file, languageVersion, ...rest) => {
      const code = files.get(file)
      return code === undefined
        ? baseHost.getSourceFile(file, languageVersion, ...rest)
        : ts.createSourceFile(file, code, languageVersion)
    },
  }
  const program = ts.createProgram([...files.keys()], options, host)
  return ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => packageDir,
    getNewLine: () => '\n',
  })
}

const blocks = getBlocks(readme)
const collator = new Intl.Collator()

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

  it('type-checks', () => {
    expect(typeCheckBlocks(blocks.map(({ code }) => code))).toBe('')
  })

  it.each(blocks)('$heading', async ({ code }) => {
    await expect(runExample(code)).resolves.toBeUndefined()
  })
})
