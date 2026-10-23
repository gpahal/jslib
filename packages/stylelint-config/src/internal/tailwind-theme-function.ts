/**
 * The `@gpahal/tailwind-theme-function` rule: each `theme()` and `--theme()` call without a
 * fallback names a variable that an `@theme` block of the file or the reference files defines, and
 * no later `initial` value or namespace reset removes, as Tailwind's build requires. A legacy key
 * path such as `colors.red.500` is checked as the variable it maps to through
 * {@link LEGACY_NAMESPACES}, or else as a path of Tailwind's JavaScript default theme, which
 * Tailwind falls back to. A file with `@config` or `@plugin`, whose JavaScript can add theme keys,
 * is skipped
 */

import { createRequire } from 'node:module'
import path from 'node:path'

import type { AtRule, Declaration, Root } from 'postcss'
import stylelint, { type Plugin, type Rule } from 'stylelint'

import { isRecord } from '@gpahal/std/objects'

import {
  atRulePrelude,
  declarationValue,
  FUNCTION_AT_RULES,
  functionCalls,
  type Part,
} from '@/internal/tailwind-values'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

export const TAILWIND_THEME_FUNCTION = '@gpahal/tailwind-theme-function'

const ruleName = TAILWIND_THEME_FUNCTION

const messages = ruleMessages(ruleName, {
  rejected: (name: string, fn: string) =>
    `Unexpected unknown theme variable "${name}" in "${fn}()"`,
  rejectedPath: (keyPath: string, name: string, fn: string) =>
    `Unexpected unknown theme key "${keyPath}" in "${fn}()", whose variable is "${name}"`,
})

/**
 * The v3 theme keys that Tailwind v4 maps to variable namespaces, a copy of Tailwind's table that
 * `tests/tailwind-theme-function.test.ts` checks
 */
export const LEGACY_NAMESPACES: Readonly<Record<string, string>> = {
  animation: '--animate',
  aspectRatio: '--aspect',
  borderRadius: '--radius',
  boxShadow: '--shadow',
  colors: '--color',
  containers: '--container',
  fontFamily: '--font',
  fontSize: '--text',
  letterSpacing: '--tracking',
  lineHeight: '--leading',
  screens: '--breakpoint',
  transitionTimingFunction: '--ease',
}

/**
 * The namespaces Tailwind keeps when a shorter one is reset, as `--font-*: initial` keeps
 * `--font-weight-bold`. A copy of Tailwind's list, which `tests/reference-files.test.ts` checks
 */
export const KEPT_NAMESPACES: Readonly<Record<string, ReadonlyArray<string>>> = {
  '--font': ['--font-weight', '--font-size'],
  '--inset': ['--inset-shadow', '--inset-ring'],
  '--text': [
    '--text-color',
    '--text-decoration-color',
    '--text-decoration-thickness',
    '--text-indent',
    '--text-shadow',
    '--text-underline-offset',
  ],
  '--grid-column': ['--grid-column-start', '--grid-column-end'],
  '--grid-row': ['--grid-row-start', '--grid-row-end'],
}

/**
 * Whether resetting `resets` removes the theme variable `name`, as in Tailwind
 */
export function isReset(name: string, resets: ReadonlyArray<string>): boolean {
  return resets.some(
    (namespace) =>
      namespace === '--' ||
      (name.startsWith(namespace) &&
        (KEPT_NAMESPACES[namespace] ?? []).every((kept) => !name.startsWith(kept))),
  )
}

/**
 * The unprefixed names of the variables the reference loader prefixed, since `theme()` takes them
 * unprefixed
 */
const unprefixedNames = new WeakMap<Declaration, string>()

export function recordUnprefixedName(declaration: Declaration, name: string): void {
  unprefixedNames.set(declaration, name)
}

/**
 * The namespace that the `@theme` variable `name` resets with `value`, such as `--color` for
 * `--color-*: initial` or `--` for `--*: initial`
 */
function resetNamespaceOf(name: string, value: string): string | undefined {
  const match = /^(--(?:[\w-]*-)?)\*$/.exec(name)
  if (match?.[1] === undefined || value.trim() !== 'initial') {
    return undefined
  }
  return match[1] === '--' ? '--' : match[1].slice(0, -1)
}

/**
 * The theme variables of `root` and `referenceRoots`. Each file's `@theme` variables apply in
 * order, so an `initial` value or a namespace reset removes the names its file defined before it.
 * The linted file's also remove the reference files' names, as Tailwind reads them after those,
 * unless the linted file is a reference file, whose place among them isn't known
 */
function themeOf(
  root: Root,
  referenceRoots: ReadonlyArray<Root>,
): { names: Set<string>; hasJavaScript: boolean } {
  const names = new Set<string>()
  let hasJavaScript = false
  const file = root.source?.input.file
  const isReference =
    file !== undefined && referenceRoots.some((reference) => reference.source?.input.file === file)
  for (const current of [...referenceRoots, root]) {
    const own = current === root && !isReference ? names : new Set<string>()
    hasJavaScript = readTheme(current, own) || hasJavaScript
    for (const name of own) {
      names.add(name)
    }
  }
  return { names, hasJavaScript }
}

/**
 * Apply the `@theme` variables of `root` to `names` in order, and return whether `root` has a
 * `@config` or `@plugin`
 */
function readTheme(root: Root, names: Set<string>): boolean {
  let hasJavaScript = false
  root.walkAtRules((atRule) => {
    const name = atRule.name.toLowerCase()
    if (name === 'config' || name === 'plugin') {
      hasJavaScript = true
      return
    }
    if (name !== 'theme') {
      return
    }
    const nodes = atRule.nodes ?? []
    for (const node of nodes) {
      if (node.type !== 'decl' || !node.prop.startsWith('--')) {
        continue
      }
      const variable = unprefixedNames.get(node) ?? node.prop
      const namespace = resetNamespaceOf(variable, node.value)
      if (namespace !== undefined) {
        for (const defined of names) {
          if (isReset(defined, [namespace])) {
            names.delete(defined)
          }
        }
      } else if (node.value.trim() === 'initial') {
        names.delete(variable)
      } else if (!variable.includes('*')) {
        names.add(variable)
      }
    }
  })
  return hasJavaScript
}

/**
 * Tailwind's JavaScript default theme, by the path of a `theme.css` it resolves from, or
 * `undefined` where it doesn't resolve
 */
const defaultThemes = new Map<string, Readonly<Record<string, unknown>> | undefined>()

/**
 * The JavaScript default theme of the Tailwind whose `theme.css` is a reference file, which is the
 * one installed at or above the entry point or `root`
 */
function defaultThemeOf(referenceRoots: ReadonlyArray<Root>): Readonly<Record<string, unknown>> {
  for (const reference of referenceRoots) {
    const file = reference.source?.input.file
    if (file === undefined || path.basename(file) !== 'theme.css') {
      continue
    }
    if (!defaultThemes.has(file)) {
      let theme: Readonly<Record<string, unknown>> | undefined
      try {
        const loaded: unknown = createRequire(file)('tailwindcss/defaultTheme')
        const exported: unknown =
          isRecord(loaded) && 'default' in loaded ? loaded['default'] : loaded
        theme = isRecord(exported) ? exported : undefined
      } catch {
        theme = undefined
      }
      defaultThemes.set(file, theme)
    }
    const theme = defaultThemes.get(file)
    if (theme !== undefined) {
      return theme
    }
  }
  return {}
}

/**
 * Whether Tailwind's default theme resolves `keyPath` to a value. Tailwind takes `colors` only from
 * the CSS theme
 */
function isDefaultThemePath(theme: Readonly<Record<string, unknown>>, keyPath: string): boolean {
  const [first = '', ...rest] = keyPath.split('.')
  if (first === 'colors') {
    return false
  }
  let value: unknown = theme
  for (const key of [first, ...rest]) {
    value = isRecord(value) || Array.isArray(value) ? Reflect.get(value, key) : undefined
  }
  return typeof value === 'string' || typeof value === 'number' || Array.isArray(value)
}

function unquote(text: string): string {
  const quote = text[0]
  if ((quote !== '"' && quote !== "'") || text.at(-1) !== quote || text.length < 2) {
    return text
  }
  return text.slice(1, -1).replaceAll(/\\(.)/g, '$1')
}

/**
 * The variable a call's first argument names, or its key path and mapped variable
 */
function variableOf(
  fn: string,
  argument: string,
): { name: string; keyPath?: string | undefined } | undefined {
  let text = argument.trim()
  if (fn === '--theme' && text.endsWith(' inline')) {
    text = text.slice(0, -' inline'.length).trimEnd()
  }
  if (/^--(?:[\w-]|\\.)+$/.test(text)) {
    return { name: text }
  }
  const keyPath = unquote(text)
  const [first, ...rest] = keyPath.split('.')
  const namespace =
    first !== undefined && Object.hasOwn(LEGACY_NAMESPACES, first)
      ? LEGACY_NAMESPACES[first]
      : undefined
  if (
    namespace === undefined ||
    rest.length === 0 ||
    rest.some((key) => !/^[a-z\d-]+$/.test(key))
  ) {
    return undefined
  }
  return { name: `${namespace}-${rest.join('-')}`, keyPath }
}

/**
 * The longest first argument that is read, longer than any theme variable's name
 */
const MAX_VARIABLE_ARGUMENT_LENGTH = 512

const FUNCTIONS: ReadonlySet<string> = new Set(['theme', '--theme'])

const ruleFunction: Rule = (primary: unknown) => (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary, possible: [true] })) {
    return
  }
  // Without reference files, the theme is unknown
  const { referenceRoots } = result.stylelint
  if (referenceRoots.length === 0) {
    return
  }
  let known: ReturnType<typeof themeOf> | undefined
  let defaultTheme: Readonly<Record<string, unknown>> | undefined
  const check = (node: Declaration | AtRule, { text, index: offset }: Part): void => {
    if (!text.includes('theme(')) {
      return
    }
    for (const call of functionCalls(text, FUNCTIONS)) {
      const [first] = call.args
      // A fallback argument, even an empty one, silences Tailwind's error
      if (first === undefined || call.args.length > 1) {
        continue
      }
      // A `/` starts an opacity modifier, as in `theme(--color-red-500 / 50%)`
      const end = call.slashes[0] ?? first.endIndex
      if (end - first.index > MAX_VARIABLE_ARGUMENT_LENGTH) {
        continue
      }
      const variable = variableOf(call.name, text.slice(first.index, end))
      if (variable === undefined) {
        continue
      }
      known ??= themeOf(root, referenceRoots)
      if (known.hasJavaScript || known.names.has(variable.name)) {
        continue
      }
      defaultTheme ??= defaultThemeOf(referenceRoots)
      if (variable.keyPath !== undefined && isDefaultThemePath(defaultTheme, variable.keyPath)) {
        continue
      }
      report({
        ruleName,
        result,
        node,
        index: offset + call.index,
        endIndex: offset + call.endIndex,
        message:
          variable.keyPath === undefined
            ? messages.rejected(variable.name, call.name)
            : messages.rejectedPath(variable.keyPath, variable.name, call.name),
      })
    }
  }
  root.walkDecls((declaration) => {
    check(declaration, declarationValue(declaration))
  })
  root.walkAtRules(FUNCTION_AT_RULES, (atRule) => {
    check(atRule, atRulePrelude(atRule))
  })
}

ruleFunction.ruleName = ruleName
ruleFunction.messages = messages
ruleFunction.meta = {
  url: 'https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#tailwind-theme-function',
}

export const tailwindThemeFunction: Plugin = createPlugin(ruleName, ruleFunction)
