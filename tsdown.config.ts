import fs from 'node:fs/promises'
import { builtinModules } from 'node:module'
import path from 'node:path'

import { defineConfig, type ResolvedConfig } from 'tsdown'
import ts from 'typescript'

import {
  dropSources,
  hashSource,
  isHashedSource,
  isPublishedFile,
  isSourceMap,
  resolveSourcePath,
} from './packages/internal/src/node/source-maps.ts'

/**
 * A `/// <reference types="module" />` directive's module
 */
const REFERENCE_TYPES_REGEX = /^\/\/\/\s*<reference\s+types\s*=\s*(["'])(?<module>.*?)\1/

type DeclarationToken = {
  kind: ts.SyntaxKind
  /**
   * The token's value: a string literal's content, or a name with its escapes resolved
   */
  value: string
}

/**
 * The tokens of `declarations` other than trivia, and the modules of its `/// <reference types>`
 * directives. TypeScript's scanner reads string and template literals and comments whole, so text
 * inside them never reads as an import, and it runs in linear time, unclosed literals included
 */
function scanDeclarations(declarations: string): {
  tokens: Array<DeclarationToken>
  references: Array<string>
} {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    declarations,
  )
  const tokens: Array<DeclarationToken> = []
  const references: Array<string> = []
  // The brace depths at which a template literal's `${` opened: the `}` back at that depth resumes
  // the literal, which the scanner reads only when asked to
  const templateDepths: Array<number> = []
  let depth = 0
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind >= ts.SyntaxKind.FirstTriviaToken && kind <= ts.SyntaxKind.LastTriviaToken) {
      const reference =
        kind === ts.SyntaxKind.SingleLineCommentTrivia
          ? REFERENCE_TYPES_REGEX.exec(scanner.getTokenText())?.groups?.module
          : undefined
      if (reference !== undefined) {
        references.push(reference)
      }
      continue
    }
    if (kind === ts.SyntaxKind.TemplateHead) {
      templateDepths.push(depth)
    } else if (kind === ts.SyntaxKind.CloseBraceToken && templateDepths.at(-1) === depth) {
      kind = scanner.reScanTemplateToken(false)
      if (kind === ts.SyntaxKind.TemplateTail) {
        templateDepths.pop()
      }
    } else if (kind === ts.SyntaxKind.OpenBraceToken) {
      depth++
    } else if (kind === ts.SyntaxKind.CloseBraceToken) {
      depth--
    }
    tokens.push({ kind, value: scanner.getTokenValue() })
  }
  return { tokens, references }
}

/**
 * Whether a token of kind `kind` can be in an import or export clause, `braces` deep in its braces,
 * other than a brace: a name, a keyword such as `type` or `as` other than `import` and `export`, a
 * comma, `*` and a quoted name such as `"a-b"`, in braces or after `as`
 */
function isClauseToken(
  kind: ts.SyntaxKind,
  previousKind: ts.SyntaxKind | undefined,
  braces: number,
): boolean {
  return (
    kind === ts.SyntaxKind.Identifier ||
    (kind >= ts.SyntaxKind.FirstKeyword &&
      kind <= ts.SyntaxKind.LastKeyword &&
      kind !== ts.SyntaxKind.ImportKeyword &&
      kind !== ts.SyntaxKind.ExportKeyword) ||
    kind === ts.SyntaxKind.CommaToken ||
    kind === ts.SyntaxKind.AsteriskToken ||
    (kind === ts.SyntaxKind.StringLiteral &&
      (braces > 0 || previousKind === ts.SyntaxKind.AsKeyword))
  )
}

/**
 * Reads `tokens[index]` in an import or export clause, `braces` deep in its braces. The result has
 * the clause's module when the token completes it, after `from` or as `= require("module")`, and
 * the new brace depth when the clause goes on. A clause ends at a token that can't be in one, such
 * as the `:` of `export declare const from: "module"`, so `export interface` never reaches a later
 * `from`, and at a `}` back at depth 0 that `from` doesn't follow, so the `declare module` after
 * `export interface A {}` or `export {}` is read
 */
function readClause(
  tokens: ReadonlyArray<DeclarationToken>,
  index: number,
  braces: number,
): { module?: string | undefined; braces?: number | undefined } {
  const [token, next, afterNext, module] = [0, 1, 2, 3].map((offset) => tokens[index + offset])
  if (token?.kind === ts.SyntaxKind.FromKeyword && next?.kind === ts.SyntaxKind.StringLiteral) {
    return { module: next.value }
  }
  if (token?.kind === ts.SyntaxKind.EqualsToken) {
    const isRequire =
      next?.value === 'require' &&
      afterNext?.kind === ts.SyntaxKind.OpenParenToken &&
      module?.kind === ts.SyntaxKind.StringLiteral
    return { module: isRequire ? module.value : undefined }
  }
  if (token?.kind === ts.SyntaxKind.OpenBraceToken) {
    return { braces: braces + 1 }
  }
  if (token?.kind === ts.SyntaxKind.CloseBraceToken) {
    return {
      braces:
        braces > 1 || (braces === 1 && next?.kind === ts.SyntaxKind.FromKeyword)
          ? braces - 1
          : undefined,
    }
  }
  return {
    braces:
      token !== undefined && isClauseToken(token.kind, tokens[index - 1]?.kind, braces)
        ? braces
        : undefined,
  }
}

/**
 * The module that `tokens[index]` imports when it starts a type's `import("module")`, a side-effect
 * `import "module"` or a `declare module "module"` augmentation
 */
function readDirectImport(
  tokens: ReadonlyArray<DeclarationToken>,
  index: number,
): string | undefined {
  const [previous, token, next, afterNext] = [-1, 0, 1, 2].map((offset) => tokens[index + offset])
  if (token?.kind === ts.SyntaxKind.ImportKeyword && previous?.kind !== ts.SyntaxKind.DotToken) {
    if (next?.kind === ts.SyntaxKind.StringLiteral) {
      return next.value
    }
    return next?.kind === ts.SyntaxKind.OpenParenToken &&
      afterNext?.kind === ts.SyntaxKind.StringLiteral
      ? afterNext.value
      : undefined
  }
  return token?.kind === ts.SyntaxKind.DeclareKeyword &&
    next?.kind === ts.SyntaxKind.ModuleKeyword &&
    afterNext?.kind === ts.SyntaxKind.StringLiteral
    ? afterNext.value
    : undefined
}

/**
 * The modules that `declarations`, the text of a declaration file, imports: in import and export
 * statements, `import A = require("module")`, a type's `import("module")`, a
 * `declare module "module"` augmentation and a `/// <reference types="module" />` directive
 */
function getDeclarationImports(declarations: string): Array<string> {
  const { tokens, references } = scanDeclarations(declarations)
  const imports = [...references]
  // The brace depth in the import or export clause being read, if any. A clause never has
  // `import` or `export`, so each token is in at most one clause and the scan stays linear
  let clauseBraces: number | undefined
  for (const [index, { kind }] of tokens.entries()) {
    if (clauseBraces !== undefined) {
      const clause = readClause(tokens, index, clauseBraces)
      if (clause.module !== undefined) {
        imports.push(clause.module)
      }
      clauseBraces = clause.braces
      if (clauseBraces !== undefined) {
        continue
      }
    }
    const module = readDirectImport(tokens, index)
    if (module !== undefined) {
      imports.push(module)
    } else if (kind === ts.SyntaxKind.ImportKeyword || kind === ts.SyntaxKind.ExportKeyword) {
      clauseBraces = 0
    }
  }
  return imports
}

const INTERNAL_PACKAGE = '@gpahal/internal'

const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

/**
 * The package a bare specifier names: `@scope/name` or `name`
 */
function getPackageName(specifier: string): string {
  const [first = '', second = ''] = specifier.split('/', 2)
  return first.startsWith('@') ? `${first}/${second}` : first
}

/**
 * The DefinitelyTyped package of a package: `@types/name`, or `@types/scope__name` for
 * `@scope/name`
 */
function getTypesPackageName(packageName: string): string {
  return `@types/${packageName.replace(/^@/, '').replace('/', '__')}`
}

/**
 * Throws when a built declaration file imports a package that the package doesn't depend on, such
 * as a type of a dev dependency, which its users don't install, so their type check would fail.
 *
 * tsdown's `deps.onlyImport` can't replace it: as of 0.23 it checks import and export statements
 * and `import()` expressions, but not a type's `import("module")` or a
 * `/// <reference types="module" />`. The canaries in eslint-config's
 * `tests/build-upstream.test.ts` fail once it checks both; then remove this check
 */
async function checkDeclarationImports({ cwd, outDir }: ResolvedConfig): Promise<void> {
  const packageJson: unknown = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'))
  const field = (key: string): unknown =>
    typeof packageJson === 'object' && packageJson !== null
      ? Reflect.get(packageJson, key)
      : undefined
  const name = String(field('name'))
  const allowed = new Set([
    name,
    ...DEPENDENCY_FIELDS.flatMap((key) => {
      const dependencies = field(key)
      return typeof dependencies === 'object' && dependencies !== null
        ? Object.keys(dependencies)
        : []
    }),
  ])
  // Recursive, so declaration chunks in subfolders are checked too
  const files = (await fs.readdir(outDir, { recursive: true })).filter((file) =>
    file.endsWith('.d.ts'),
  )
  for (const file of files) {
    const declarations = await fs.readFile(path.join(outDir, file), 'utf8')
    for (const specifier of getDeclarationImports(declarations)) {
      if (specifier.startsWith('.')) {
        continue
      }
      // A Node module's types come from `@types/node`, which a browser-safe package's users may not
      // have
      const packageName =
        specifier.startsWith('node:') || builtinModules.includes(specifier)
          ? 'node'
          : getPackageName(specifier)
      // Any import also resolves to the package's `@types` package, such as `@types/estree` for
      // `estree`, or `@types/node` for a Node module
      if (!allowed.has(packageName) && !allowed.has(getTypesPackageName(packageName))) {
        // The repo's error shape, written by hand: importing std's `formatMessage` would make std's
        // build depend on itself
        throw new Error(
          `${name}: \`${path.relative(cwd, path.join(outDir, file))}\`: imports '${specifier}', which isn't a dependency or peer dependency, so its users' type check would fail`,
        )
      }
    }
  }
}

/**
 * Completes each source map. It embeds the sources outside the package, so the unpublished
 * `@gpahal/internal` still maps to readable code. It drops the package's sources that `files`
 * leaves out, such as eslint-config's generated rule types, which are too large to embed, so
 * go-to-definition stays in the declaration file. It records each TypeScript source's SHA-256 in
 * a JavaScript map's `x_sourceHashes`, which `assertBuildIsCurrent` compares with the sources
 */
async function completeSourceMaps({ cwd, outDir, pkg }: ResolvedConfig): Promise<void> {
  const files = (await fs.readdir(outDir, { recursive: true })).filter((file) =>
    file.endsWith('.map'),
  )
  for (const file of files) {
    const mapPath = path.join(outDir, file)
    const map: unknown = JSON.parse(await fs.readFile(mapPath, 'utf8'))
    if (!isSourceMap(map)) {
      // The repo's error shape, written by hand, as in `checkDeclarationImports`
      throw new Error(
        `${pkg?.name ?? cwd}: \`${path.relative(cwd, mapPath)}\`: expected a source map with \`sources\``,
      )
    }
    const files = pkg?.files
    dropSources(map, (source) => {
      const relativePath = path
        .relative(cwd, resolveSourcePath(mapPath, map, source))
        .split(path.sep)
        .join('/')
      return !relativePath.startsWith('..') && !isPublishedFile(relativePath, files)
    })
    const sources = await Promise.all(
      map.sources.map(async (source) => {
        const sourcePath = resolveSourcePath(mapPath, map, source)
        // A JSON source, such as `package.json`, is left out
        const content = isHashedSource(source) ? await fs.readFile(sourcePath, 'utf8') : undefined
        return { sourcePath, content }
      }),
    )
    const isOutside = (sourcePath: string): boolean =>
      path.relative(cwd, sourcePath).startsWith('..')
    if (sources.some(({ sourcePath }) => isOutside(sourcePath))) {
      map.sourcesContent = await Promise.all(
        sources.map(async ({ sourcePath, content }) =>
          isOutside(sourcePath) ? (content ?? fs.readFile(sourcePath, 'utf8')) : null,
        ),
      )
    }
    if (file.endsWith('.js.map')) {
      map.x_sourceHashes = sources.map(({ content }) =>
        content === undefined ? null : hashSource(content),
      )
    }
    await fs.writeFile(mapPath, JSON.stringify(map))
  }
}

export default defineConfig({
  entry: ['src/*.ts'],
  outDir: 'build',
  target: 'es2024',
  // `.js`, not the `.mjs` that tsdown defaults to for Node: every package is `type: module`
  fixedExtension: false,
  // Stable chunk names, so a Turbo cache restore overwrites the chunk files that a build wrote
  // instead of leaving them next to the restored ones
  hash: false,
  // Fails the build when it would bundle a package from `node_modules`, which tsdown otherwise only
  // logs. `@gpahal/internal` is never published, so its code and types are bundled
  deps: {
    onlyBundle: [],
    alwaysBundle: [INTERNAL_PACKAGE],
    dts: { alwaysBundle: [INTERNAL_PACKAGE] },
  },
  // Bundles `@gpahal/internal` from its `src`, so the source maps point at TypeScript, not its build
  alias: { [INTERNAL_PACKAGE]: path.join(import.meta.dirname, 'packages/internal/src') },
  // Each module resolves `@/` with its nearest tsconfig, so `@gpahal/internal`'s `src` resolves its
  // own modules, not the importing package's
  inputOptions: { tsconfig: true },
  // The maps point at `src`, which every package publishes, instead of copying it into the maps
  sourcemap: true,
  outputOptions: { sourcemapExcludeSources: true },
  dts: { sourcemap: true },
  // A package's CLI is `src/cli.ts`, which starts with a shebang, so tsdown writes it as the `bin`
  exports: { exclude: ['cli'] },
  onSuccess: async (config) => {
    await completeSourceMaps(config)
    await checkDeclarationImports(config)
  },
})
