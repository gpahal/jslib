import { createRequire } from 'node:module'

import type { Parser, ParserOptions, Plugin, Printer } from 'prettier'

// The import sorter as a plugin module that Prettier loads by path, without the parsers and
// printers whose optional dependency the sorter can't load, whose getters throw, failing
// prettier-plugin-merge. Its parsers pin directives' imports. The Tailwind plugin loads the sorter
// itself. Self-contained, since tests load the source

const require = createRequire(import.meta.url)

const SORTER = '@ianvs/prettier-plugin-sort-imports'

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The sorter's declarations expose only its options type, not the plugin it exports
const sorter = require(SORTER) as Plugin

/**
 * The packages that each optional parser and printer needs, loaded from the sorter's folder
 */
const OPTIONAL_DEPENDENCIES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'ember-template-tag': ['prettier-plugin-ember-template-tag', 'content-tag'],
  oxc: ['@prettier/plugin-oxc'],
  'oxc-ts': ['@prettier/plugin-oxc'],
  'estree-oxc': ['@prettier/plugin-oxc'],
  vue: ['@vue/compiler-sfc'],
}

const sorterRequire = createRequire(require.resolve(SORTER))

function canResolve(id: string): boolean {
  try {
    sorterRequire.resolve(id)
    return true
  } catch {
    return false
  }
}

/**
 * The entries whose optional dependency resolves, copied as descriptors, so getters load the
 * dependency only when Prettier uses them
 */
function withResolvable<T>(
  object: Readonly<Record<string, T>> | undefined,
  wrap: (value: T) => T = (value) => value,
): Record<string, T> {
  const descriptors = Object.entries(Object.getOwnPropertyDescriptors(object ?? {}))
    .filter(([name]) => {
      const dependencies = OPTIONAL_DEPENDENCIES[name] ?? []
      return dependencies.every((dependency) => canResolve(dependency))
    })
    .map(([name, descriptor]): [string, PropertyDescriptor] => {
      if (descriptor.get !== undefined) {
        const get = descriptor.get.bind(object)
        return [name, { ...descriptor, get: () => wrap(get()) }]
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The value is the sorter's, a `T`
      return [name, { ...descriptor, value: wrap(descriptor.value as T) }]
    })
  return Object.defineProperties({}, Object.fromEntries(descriptors))
}

// A directive such as `// @ts-expect-error` applies to the line below it, but the sorter keeps
// comments above the first import at the top. It keeps an import under `// prettier-ignore` in
// place, so that comment and a marker go above each directive's import, and come out after

const DIRECTIVE =
  /@ts-expect-error|@ts-ignore|eslint-disable-next-line|eslint-disable-line|biome-ignore|prettier-ignore/

const PIN_MARKER = '@gpahal/prettier-config: pinned by a directive'

/**
 * Not `import(` or `import.meta`
 */
const IMPORT_START = /^([\t ]*)import(?=[\s"'*{])/

const LINE_COMMENT = /^[\t ]*\/\//

const BLOCK_COMMENT_LINE = /^[\t ]*\/\*.*\*\/[\t ]*$/

const BLOCK_COMMENT_END = /\*\/[\t ]*$/

const BLOCK_COMMENT_START = /^[\t ]*\/\*/

const PIN_COMMENTS = new RegExp(
  String.raw`^[\t ]*// prettier-ignore\r?\n[\t ]*// ${PIN_MARKER}\r?\n`,
  'gm',
)

const PIN_MARKER_LINE = new RegExp(String.raw`^[\t ]*// ${PIN_MARKER}\r?\n`, 'gm')

/**
 * A block comment that starts after code on its line, as an import's trailing comment does, ends
 * them
 */
function commentLinesAbove(lines: ReadonlyArray<string>, index: number): Array<string> {
  const comments: Array<string> = []
  let i = index - 1
  while (i >= 0) {
    const line = lines[i] ?? ''
    if (LINE_COMMENT.test(line) || BLOCK_COMMENT_LINE.test(line)) {
      comments.push(line)
      i--
      continue
    }
    if (!BLOCK_COMMENT_END.test(line)) {
      break
    }
    // The nearest `/*` opens the comment, which counts only when nothing comes before it
    let start = i
    while (start >= 0 && !(lines[start] ?? '').includes('/*')) {
      start--
    }
    if (start < 0 || !BLOCK_COMMENT_START.test(lines[start] ?? '')) {
      break
    }
    comments.push(...lines.slice(start, i + 1))
    i = start - 1
  }
  return comments
}

/**
 * By line, without parsing: a string line that looks like such an import gets the comments too, and
 * loses them after, since the sorter rewrites only import declarations
 */
function pinDirectiveImports(text: string): string {
  if (!DIRECTIVE.test(text)) {
    return text
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(newline)
  const pinned: Array<string> = []
  for (const [i, line] of lines.entries()) {
    const indent = IMPORT_START.exec(line)?.[1]
    if (
      indent !== undefined &&
      commentLinesAbove(lines, i).some((comment) => DIRECTIVE.test(comment))
    ) {
      pinned.push(`${indent}// prettier-ignore`, `${indent}// ${PIN_MARKER}`)
    }
    pinned.push(line)
  }
  return pinned.join(newline)
}

function unpinDirectiveImports(text: string): string {
  return text.includes(PIN_MARKER)
    ? text.replaceAll(PIN_COMMENTS, '').replaceAll(PIN_MARKER_LINE, '')
    : text
}

function withPinnedDirectives(parser: Parser): Parser {
  const { preprocess } = parser
  if (preprocess === undefined) {
    return parser
  }
  return {
    ...parser,
    preprocess: async (text: string, options: ParserOptions) =>
      unpinDirectiveImports(await preprocess(pinDirectiveImports(text), options)),
  }
}

export const parsers: Record<string, Parser> = withResolvable(sorter.parsers, withPinnedDirectives)

export const options: Plugin['options'] = sorter.options

export const printers: Record<string, Printer> = withResolvable(sorter.printers)
