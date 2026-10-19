/**
 * The `@gpahal/tailwind-theme-function` rule: each `theme()` and `--theme()` call without a
 * fallback names a variable that an `@theme` block of the file or the reference files defines, as
 * Tailwind's build requires. A legacy key path such as `colors.red.500` is checked as the variable
 * it maps to through {@link LEGACY_NAMESPACES}. A file with `@config` or `@plugin`, whose
 * JavaScript can add theme keys, is skipped
 */

import type { AtRule, Declaration, Root } from 'postcss'
import stylelint, { type Plugin, type Rule } from 'stylelint'

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
 * The unprefixed names of the variables the reference loader prefixed, since `theme()` takes them
 * unprefixed
 */
const unprefixedNames = new WeakMap<Declaration, string>()

export function recordUnprefixedName(declaration: Declaration, name: string): void {
  unprefixedNames.set(declaration, name)
}

function themeOf(roots: ReadonlyArray<Root>): { names: Set<string>; hasJavaScript: boolean } {
  const names = new Set<string>()
  let hasJavaScript = false
  const readAtRule = (atRule: AtRule): void => {
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
      if (node.type === 'decl' && node.prop.startsWith('--') && !node.prop.includes('*')) {
        names.add(unprefixedNames.get(node) ?? node.prop)
      }
    }
  }
  for (const root of roots) {
    root.walkAtRules(readAtRule)
  }
  return { names, hasJavaScript }
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
      known ??= themeOf([root, ...referenceRoots])
      if (known.hasJavaScript || known.names.has(variable.name)) {
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
