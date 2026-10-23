/**
 * The `@gpahal/tailwind-apply` rule: each `@apply` class and `@variant` variant is one the entry
 * point's design system knows. The design system comes from Tailwind's public `compile()` of the
 * entry point's stylesheets without their ordinary rules, so an `@apply` or `theme()` error there
 * doesn't stop it. A class is known when `build()` of it adds CSS
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { parse } from 'postcss'
import stylelint, { type Plugin, type Rule } from 'stylelint'

import { resolveFile, resolveFromNodeModules } from '@gpahal/internal/node/resolve'
import { formatMessage, formatNames, getErrorReason } from '@gpahal/std/errors'

import { PREFIX } from '@/internal/options'
import {
  tailwindCompileOf,
  tailwindModulePath,
  tailwindStylesheetPath,
  type TailwindCompile,
} from '@/internal/tailwind-loader'
import { atRulePrelude, segment, type Part } from '@/internal/tailwind-values'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

export const TAILWIND_APPLY = '@gpahal/tailwind-apply'

const ruleName = TAILWIND_APPLY

const messages = ruleMessages(ruleName, {
  rejectedClass: (candidate: string) =>
    `Unexpected unknown utility class "${candidate}" in "@apply"`,
  rejectedVariant: (variant: string) => `Unexpected unknown variant "${variant}" in "@variant"`,
})

export type TailwindDesign = {
  isKnownClass: (candidate: string) => boolean
  isKnownVariant: (variant: string) => boolean
}

/**
 * The root at-rules that make up a design system, the only ones {@link loadTailwindDesign} compiles
 */
const DESIGN_AT_RULES: ReadonlySet<string> = new Set([
  'import',
  'reference',
  'theme',
  'utility',
  'custom-variant',
  'plugin',
  'config',
  'tailwind',
])

/**
 * `css` with only its design system at-rules, or as it is when it doesn't parse, so Tailwind
 * reports the error
 */
function designOnly(css: string, file: string): string {
  let root: ReturnType<typeof parse>
  try {
    root = parse(css, { from: file })
  } catch {
    return css
  }
  root.each((node) => {
    const isKept =
      node.type === 'atrule' &&
      (DESIGN_AT_RULES.has(node.name.toLowerCase()) ||
        (node.name.toLowerCase() === 'variant' && node.nodes === undefined))
    if (!isKept) {
      node.remove()
    }
  })
  // Ends the last kept at-rule with `;`, which the file leaves out when a rule came last, so the
  // CSS appended after it stays a statement of its own
  root.raws.semicolon = true
  return root.toString()
}

/**
 * A design system with the stylesheets it read, so the cache is used only while they're unchanged
 */
type CachedDesign = { files: ReadonlyMap<string, string>; design: Promise<TailwindDesign> }

const designCache = new Map<string, CachedDesign>()

function isCurrent(cached: CachedDesign): boolean {
  for (const [file, content] of cached.files) {
    let current: string | undefined
    try {
      current = fs.readFileSync(file, 'utf8')
    } catch {
      return false
    }
    if (current !== content) return false
  }
  return true
}

function failValidateApply(description: string, cause?: unknown): never {
  throw new TypeError(
    formatMessage(PREFIX, ['`tailwindcss.validateApply`'], description),
    cause === undefined ? undefined : { cause },
  )
}

/**
 * The design system of the Tailwind next to `theme`, compiled from `entryPath` or else
 * `@import 'tailwindcss'`, cached while its stylesheets are unchanged
 *
 * @throws TypeError when Tailwind isn't installed there, has no `compile()`, or fails to compile
 *   the stylesheets, or when its design system builds no `flex` class.
 */
export async function loadTailwindDesign({
  entryPath,
  theme,
  prefix,
  resolveImport,
}: {
  entryPath: string | undefined
  theme: string
  prefix: string | undefined
  resolveImport: (target: string, importer: string) => string | undefined
}): Promise<TailwindDesign> {
  const modulePath = tailwindModulePath(theme, failValidateApply)
  const key = JSON.stringify([modulePath, entryPath ?? null, prefix ?? null])
  const cached = designCache.get(key)
  if (cached !== undefined && isCurrent(cached)) {
    return cached.design
  }
  const files = new Map<string, string>()
  const design = compileDesign({
    modulePath,
    packageDir: path.dirname(theme),
    entryPath,
    prefix,
    resolveImport,
    files,
  })
  designCache.set(key, { files, design })
  try {
    return await design
  } catch (error) {
    designCache.delete(key)
    throw error
  }
}

const MODULE_EXTENSIONS: ReadonlyArray<string> = ['.js', '.json', '.node', '.ts']

/**
 * The real path of a `@plugin` or `@config` module, as Tailwind resolves it: a path with
 * {@link MODULE_EXTENSIONS} or as a folder, or a package through `import`, then `require`
 *
 * @throws Error when it doesn't resolve.
 */
function resolveModule(id: string, base: string): string {
  if (id.startsWith('.') || path.isAbsolute(id)) {
    const resolved = resolveFile(path.resolve(base, id), {
      mainFields: ['module', 'main'],
      extensions: MODULE_EXTENSIONS,
    })
    if (resolved !== undefined && 'reason' in resolved) {
      throw new Error(resolved.reason, { cause: resolved.cause })
    }
    if (resolved === undefined) {
      throw new Error(`Can't resolve '${id}' in '${base}'`)
    }
    return fs.realpathSync(resolved.path)
  }
  const importer = path.join(base, 'importer.js')
  let resolved: string | undefined
  try {
    resolved = resolveFromNodeModules(id, importer, {
      prefix: PREFIX,
      conditions: ['node', 'import'],
      mainFields: ['module', 'main'],
      extensions: MODULE_EXTENSIONS,
    })?.path
  } catch {
    // Tailwind tries `require` next, whose error it reports
  }
  resolved ??= resolveFromNodeModules(id, importer, {
    prefix: PREFIX,
    conditions: ['node', 'require'],
    mainFields: ['main'],
    extensions: MODULE_EXTENSIONS,
  })?.path
  if (resolved === undefined) {
    throw new Error(`Can't resolve '${id}' in '${base}'`)
  }
  return resolved
}

async function loadModule(
  id: string,
  base: string,
): Promise<{ path: string; base: string; module: unknown }> {
  const file = resolveModule(id, base)
  const imported: unknown = await import(pathToFileURL(file).href)
  const module =
    typeof imported === 'object' && imported !== null && 'default' in imported
      ? imported.default
      : imported
  return { path: file, base: path.dirname(file), module }
}

/**
 * The most distinct classes and variants a design system checks; later ones count as known. Each
 * check rebuilds the known classes, so the checks take quadratic time
 */
const MAX_CHECKED_CANDIDATES = 2000

async function compileDesign({
  modulePath,
  packageDir,
  entryPath,
  prefix,
  resolveImport,
  files,
}: {
  modulePath: string
  packageDir: string
  entryPath: string | undefined
  prefix: string | undefined
  resolveImport: (target: string, importer: string) => string | undefined
  files: Map<string, string>
}): Promise<TailwindDesign> {
  const compile = tailwindCompileOf(modulePath, failValidateApply)
  const read = (file: string): string => {
    const content = fs.readFileSync(file, 'utf8')
    files.set(file, content)
    return content
  }
  const loadStylesheet = async (id: string, base: string) => {
    // As Tailwind leaves `http(s):` and `data:` URLs alone, a scheme-relative one loads nothing
    if (id.startsWith('//')) {
      return { path: id, base, content: '' }
    }
    const file =
      tailwindStylesheetPath(id, packageDir) ?? resolveImport(id, path.join(base, 'importer.css'))
    if (file === undefined) {
      throw new Error(`Can't resolve '${id}' in '${base}'`)
    }
    if (file.startsWith(packageDir + path.sep)) {
      return { path: file, base: path.dirname(file), content: read(file) }
    }
    // As in the walk of the reference files: a FIFO would block, and a non-CSS file such as a
    // `.env` would print its content in Tailwind's parse error
    const stats = fs.statSync(file, { throwIfNoEntry: false })
    if (stats === undefined) {
      throw new Error(`${formatNames([file])} doesn't exist`)
    }
    if (!stats.isFile()) {
      throw new Error(`${formatNames([file])} isn't a file`)
    }
    // As in Tailwind, a symlinked stylesheet's imports resolve from the folder of its real path
    const realPath = fs.realpathSync(file)
    const isCss = /\.css$/i.test(file) && /\.css$/i.test(realPath)
    return {
      path: file,
      base: path.dirname(realPath),
      content: isCss ? designOnly(read(file), file) : '',
    }
  }
  const css =
    entryPath === undefined
      ? "@import 'tailwindcss';\n"
      : `${designOnly(read(entryPath), entryPath)}\n@tailwind utilities;\n`
  let compiler: Awaited<ReturnType<TailwindCompile>>
  try {
    compiler = await compile(css, {
      base: entryPath === undefined ? packageDir : path.dirname(fs.realpathSync(entryPath)),
      loadStylesheet,
      loadModule,
    })
  } catch (error) {
    return failValidateApply(
      `compiling ${formatNames([entryPath ?? 'tailwindcss'])} with Tailwind CSS failed: ${getErrorReason(error)}`,
      error,
    )
  }
  const known = new Map<string, boolean>()
  let length = compiler.build([]).length
  const isKnownClass = (candidate: string): boolean => {
    let isKnown = known.get(candidate)
    if (isKnown === undefined) {
      if (known.size >= MAX_CHECKED_CANDIDATES) {
        return true
      }
      try {
        const built = compiler.build([candidate]).length
        isKnown = built > length
        length = built
      } catch {
        // A class whose CSS fails to build, as with an `@apply` error in its `@utility`, exists
        isKnown = true
      }
      known.set(candidate, isKnown)
    }
    return isKnown
  }
  const classPrefix = prefix === undefined ? '' : `${prefix}:`
  if (!isKnownClass(`${classPrefix}flex`)) {
    return failValidateApply(
      `Tailwind CSS builds no \`${classPrefix}flex\` class from ${formatNames([entryPath ?? 'tailwindcss'])}`,
    )
  }
  return {
    isKnownClass,
    isKnownVariant: (variant) => isKnownClass(`${classPrefix}${variant}:flex`),
  }
}

/**
 * The classes of an `@apply` prelude with their ranges. As in Tailwind, comments outside quotes go
 * first, so `p-/* x *\/4` is `p-4`
 */
function classesOf(text: string): Array<Part & { endIndex: number }> {
  const classes: Array<Part & { endIndex: number }> = []
  let current: (Part & { endIndex: number }) | undefined
  let quote: string | undefined
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    if (quote === undefined && char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2)
      index = close === -1 ? text.length : close + 2
      continue
    }
    if (quote === undefined && /\s/.test(char)) {
      current = undefined
      index += 1
      continue
    }
    if (quote === undefined && (char === '"' || char === "'")) {
      quote = char
    } else if (char === quote) {
      quote = undefined
    }
    // A backslash escapes the character after it
    const end = Math.min(index + (char === '\\' ? 2 : 1), text.length)
    if (current === undefined) {
      current = { text: '', index, endIndex: end }
      classes.push(current)
    }
    current.text += text.slice(index, end)
    current.endIndex = end
    index = end
  }
  return classes
}

function createTailwindApply(design: TailwindDesign | undefined): Plugin {
  const ruleFunction: Rule = (primary: unknown) => (root, result) => {
    const isValid = validateOptions(result, ruleName, { actual: primary, possible: [true] })
    if (design === undefined || !isValid) {
      return
    }
    root.walkAtRules(/^(?:apply|variant)$/i, (atRule) => {
      const prelude = atRulePrelude(atRule)
      const isApply = atRule.name.toLowerCase() === 'apply'
      // A root `@variant` without a block is a `@custom-variant` shorthand
      if (!isApply && atRule.nodes === undefined) {
        return
      }
      const parts = isApply
        ? classesOf(prelude.text).filter((word) => word.text !== '!important')
        : segment(prelude.text, ',').flatMap((group) =>
            segment(group.text, ':').map((part) => {
              const leading = part.text.length - part.text.trimStart().length
              const text = part.text.trim()
              const index = group.index + part.index + leading
              return { text, index, endIndex: index + text.length }
            }),
          )
      for (const part of parts) {
        const isKnown =
          part.text === '' ||
          (isApply ? design.isKnownClass(part.text) : design.isKnownVariant(part.text))
        if (!isKnown) {
          report({
            ruleName,
            result,
            node: atRule,
            index: prelude.index + part.index,
            endIndex: prelude.index + part.endIndex,
            message: isApply
              ? messages.rejectedClass(part.text)
              : messages.rejectedVariant(part.text),
          })
        }
      }
    })
  }
  ruleFunction.ruleName = ruleName
  ruleFunction.messages = messages
  ruleFunction.meta = {
    url: 'https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#tailwind-apply',
  }
  return createPlugin(ruleName, ruleFunction)
}

const inactiveTailwindApply = createTailwindApply(undefined)

const tailwindApplies = new WeakMap<TailwindDesign, Plugin>()

/**
 * The `@gpahal/tailwind-apply` rule for `design`, shared per design system. Without one it checks
 * nothing
 */
export function tailwindApply(design: TailwindDesign | undefined): Plugin {
  if (design === undefined) {
    return inactiveTailwindApply
  }
  let plugin = tailwindApplies.get(design)
  if (plugin === undefined) {
    plugin = createTailwindApply(design)
    tailwindApplies.set(design, plugin)
  }
  return plugin
}
