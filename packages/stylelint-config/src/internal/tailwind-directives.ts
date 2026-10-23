/**
 * The `@gpahal/tailwind-directives` rule: structural errors in Tailwind CSS v4's at-rules and
 * functions that fail Tailwind's build and that Stylelint's syntax checks can't see. The checks
 * mirror Tailwind 4.3's `compile()`, and `tests/tailwind-directives.test.ts` checks them against
 * the installed Tailwind
 */

import type { AtRule, ChildNode, Container, Declaration } from 'postcss'
import stylelint from 'stylelint'
import type { Plugin, PostcssResult, Rule } from 'stylelint'

import {
  atRulePrelude,
  declarationValue,
  FUNCTION_AT_RULES,
  functionCalls,
  segment,
} from '@/internal/tailwind-values'
import type { Part } from '@/internal/tailwind-values'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

export const TAILWIND_DIRECTIVES = '@gpahal/tailwind-directives'

const ruleName = TAILWIND_DIRECTIVES

const messages = ruleMessages(ruleName, {
  emptyPrelude: (name: string) => `Expected a prelude for "@${name}"`,
  nested: (name: string) => `Unexpected nested "@${name}", which must be at the root`,
  invalidUtilityName: (name: string, reason: string) =>
    `Unexpected invalid utility name "${name}": ${reason}`,
  emptyUtility: (name: string) => `Expected a declaration in "@utility ${name}"`,
  invalidVariantName: (name: string) =>
    `Unexpected invalid variant name "${name}": a variant name starts with a lowercase letter or digit, has only letters, digits, "-" and "_", and doesn't end with "-" or "_"`,
  selectorAndBody: (name: string) =>
    `Unexpected selector and body in "@custom-variant ${name}", which takes one of them`,
  noSelectorOrBody: (name: string) => `Expected a selector or a body in "@custom-variant ${name}"`,
  emptySelector: (name: string) => `Unexpected empty selector in "@custom-variant ${name}"`,
  emptyVariant: () => 'Unexpected empty variant in "@variant"',
  invalidDataType: (type: string, fn: string) =>
    `Unexpected unknown data type "${type}" in "${fn}()". Use "number", "integer", "ratio", "percentage", a "[type]", a "--namespace-*" or a quoted value`,
  alphaArguments: () =>
    'Expected a color and an alpha value in "--alpha()", as in "--alpha(red / 50%)"',
  alphaSecondArgument: () => 'Unexpected second argument in "--alpha()"',
})

/**
 * The at-rules that Tailwind rejects with an empty prelude
 */
const PRELUDE_AT_RULES: ReadonlySet<string> = new Set([
  'source',
  'plugin',
  'variant',
  'apply',
  'custom-variant',
  'utility',
  'reference',
  'config',
])

/**
 * The at-rules that Tailwind rejects anywhere but at the root
 */
const ROOT_AT_RULES: ReadonlySet<string> = new Set([
  'utility',
  'custom-variant',
  'source',
  'plugin',
  'config',
])

/**
 * The start of a utility name, Tailwind's `IS_VALID_UTILITY_NAME`
 */
const UTILITY_NAME_START_REGEX = /^-?[a-z][\w-]*/

/**
 * A variant name, Tailwind's `IS_VALID_VARIANT_NAME`
 */
const VARIANT_NAME_REGEX = /^@?[\da-z][\w-]*(?<![_-])$/

/**
 * The bare data types of `--value()` and `--modifier()`
 */
const BARE_DATA_TYPES: ReadonlySet<string> = new Set(['number', 'integer', 'ratio', 'percentage'])

const MAX_CODE_POINT = 0x10_ff_ff

/**
 * `text` with its escapes read as Tailwind reads a `@utility` name: a one-character escape, even a
 * hex digit, is that character, and an invalid code point is U+FFFD
 */
function unescape(text: string): string {
  return text.replaceAll(/\\(?:[\da-f]{1,6}[\t\n\f\r ]?|[\s\S])/gi, (escape) => {
    if (escape.length <= 2) {
      return escape.slice(1)
    }
    const codePoint = Number.parseInt(escape.slice(1).trim(), 16)
    const isInvalid =
      codePoint === 0 ||
      codePoint > MAX_CODE_POINT ||
      (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
    return isInvalid ? '\u{FFFD}' : String.fromCodePoint(codePoint)
  })
}

/**
 * Whether `name` is a static utility name, as Tailwind's `isValidStaticUtilityName()` reads it
 */
function isStaticUtilityName(name: string): boolean {
  const start = UTILITY_NAME_START_REGEX.exec(name)?.[0]
  if (start === undefined) {
    return false
  }
  const rest = name.slice(start.length)
  if (rest.length === 0) {
    return !start.endsWith('-')
  }
  const isDigit = (char: string | undefined): boolean => char !== undefined && /^\d$/.test(char)
  let hasSlash = false
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index] ?? ''
    const before = index === 0 ? start.at(-1) : rest[index - 1]
    const isLast = index === rest.length - 1
    switch (char) {
      case '%': {
        if (!isLast || !isDigit(before)) return false
        break
      }
      case '/': {
        if (isLast || hasSlash) return false
        hasSlash = true
        break
      }
      case '.': {
        if (!isDigit(before) || !isDigit(rest[index + 1])) return false
        break
      }
      default: {
        if (!/^[\w-]$/.test(char)) return false
      }
    }
  }
  return true
}

/**
 * Why Tailwind rejects the `@utility` name `name`, or `undefined` when it takes it
 */
function utilityNameProblem(name: string): string | undefined {
  if (name.endsWith('-*')) {
    const stem = name.slice(0, -2)
    return UTILITY_NAME_START_REGEX.exec(stem)?.[0] === stem
      ? undefined
      : 'a utility name starts with a lowercase letter and has only letters, digits, "-" and "_"'
  }
  if (isStaticUtilityName(name)) {
    return undefined
  }
  if (name.endsWith('*')) {
    return 'a functional utility name ends with "-*"'
  }
  if (name.includes('*')) {
    return '"-*" goes once, at the end'
  }
  return 'a utility name starts with a lowercase letter and has only letters, digits, "-" and "_"'
}

function hasContent(nodes: ReadonlyArray<ChildNode> | undefined): boolean {
  return (nodes ?? []).some((node) => node.type !== 'comment')
}

function isBlank(text: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (!/\s/.test(text[index] ?? '')) return false
  }
  return true
}

/**
 * The longest `--value()` or `--modifier()` argument that is read, longer than any data type
 */
const MAX_DATA_TYPE_LENGTH = 256

type Range = { index: number; endIndex: number }

type Report = (node: AtRule | Declaration, message: string, range?: Range) => void

function checkUtility(atRule: AtRule, params: string, reportAt: Report): void {
  const problem = utilityNameProblem(unescape(params))
  if (problem !== undefined) {
    reportAt(atRule, messages.invalidUtilityName(params, problem))
  }
  // An empty block is `block-no-empty`'s
  if (atRule.nodes?.length !== 0 && !hasContent(atRule.nodes)) {
    reportAt(atRule, messages.emptyUtility(params))
  }
}

/**
 * Report the first problem of a `@custom-variant`, as Tailwind fails on its first
 */
function checkCustomVariant(atRule: AtRule, params: string, reportAt: Report): void {
  // Tailwind reads the prelude with its whitespace collapsed
  const [variant, selector] = segment(params.replaceAll(/\s+/g, ' '), ' ')
  const name = variant?.text ?? ''
  const selectorText = selector?.text ?? ''
  const hasBody = hasContent(atRule.nodes)
  if (!VARIANT_NAME_REGEX.test(name)) {
    reportAt(atRule, messages.invalidVariantName(name))
  } else if (hasBody) {
    if (selectorText !== '') reportAt(atRule, messages.selectorAndBody(name))
  } else if (selectorText === '') {
    reportAt(atRule, messages.noSelectorOrBody(name))
  } else if (segment(selectorText.slice(1, -1), ',').some((part) => part.text.trim() === '')) {
    reportAt(atRule, messages.emptySelector(name))
  }
}

function checkVariant(atRule: AtRule, params: string, reportAt: Report): void {
  const variants = segment(params, ',')
  const isEmpty = variants.some((variant) =>
    segment(variant.text, ':').some((part) => part.text.trim() === ''),
  )
  if (isEmpty) {
    reportAt(atRule, messages.emptyVariant())
  }
}

function checkAtRule(atRule: AtRule, reportAt: Report): void {
  const name = atRule.name.toLowerCase()
  const params = atRule.params.trim()
  if (atRule.parent?.type !== 'root' && ROOT_AT_RULES.has(name)) {
    reportAt(atRule, messages.nested(name))
  }
  if (params === '' && PRELUDE_AT_RULES.has(name)) {
    reportAt(atRule, messages.emptyPrelude(name))
    return
  }
  switch (name) {
    case 'utility': {
      checkUtility(atRule, params, reportAt)
      break
    }
    case 'custom-variant': {
      checkCustomVariant(atRule, params, reportAt)
      break
    }
    case 'variant': {
      checkVariant(atRule, params, reportAt)
      break
    }
    default:
  }
}

const ALPHA_FUNCTIONS: ReadonlySet<string> = new Set(['--alpha'])

/**
 * The default `untypedFunctions`
 */
const DEFAULT_UNTYPED_FUNCTIONS: ReadonlyArray<string> = ['theme', '--theme', '--spacing']

/**
 * A pattern that matches a call of one of `names`, already checked as CSS function names, for the
 * values `declaration-property-value-no-unknown` skips
 */
export function untypedFunctionsPattern(names: ReadonlyArray<string>): RegExp | undefined {
  return names.length === 0
    ? undefined
    : new RegExp(
        String.raw`(?:^|[^\w-])(?:${names.map((name) => RegExp.escape(name)).join('|')})\(`,
      )
}

/**
 * Whether `declaration-property-value-no-unknown` already checks the value against the preset's
 * `--alpha()` syntax. It skips custom properties, `var()` and `untypedFunctions` values
 */
function isTypeChecked(declaration: Declaration, untypedFunctions: RegExp | undefined): boolean {
  return (
    !declaration.prop.startsWith('--') &&
    !/\bvar\s*\(/i.test(declaration.value) &&
    untypedFunctions?.test(declaration.value) !== true
  )
}

function checkAlpha(node: AtRule | Declaration, value: Part, reportAt: Report): void {
  if (!value.text.includes('--alpha(')) {
    return
  }
  const { text } = value
  const calls = functionCalls(text, ALPHA_FUNCTIONS)
  for (const call of calls) {
    const range = { index: value.index + call.index, endIndex: value.index + call.endIndex }
    const [first, second] = call.args
    if (first === undefined) {
      continue
    }
    if (second !== undefined) {
      reportAt(node, messages.alphaSecondArgument(), range)
      continue
    }
    const [slash, nextSlash] = call.slashes
    if (
      slash === undefined ||
      isBlank(text, first.index, slash) ||
      isBlank(text, slash + 1, nextSlash ?? first.endIndex)
    ) {
      reportAt(node, messages.alphaArguments(), range)
    }
  }
}

const DATA_TYPE_FUNCTIONS: ReadonlySet<string> = new Set(['--value', '--modifier'])

function checkDataTypes(declaration: Declaration, reportAt: Report): void {
  const value = declarationValue(declaration)
  if (!value.text.includes('--value(') && !value.text.includes('--modifier(')) {
    return
  }
  for (const call of functionCalls(value.text, DATA_TYPE_FUNCTIONS)) {
    for (const argument of call.args) {
      if (argument.endIndex - argument.index > MAX_DATA_TYPE_LENGTH) {
        continue
      }
      const type = value.text.slice(argument.index, argument.endIndex).trim()
      const isKnown =
        type === '' ||
        type.startsWith('--') ||
        /^(["']).*\1$/s.test(type) ||
        /^\[.*\]$/s.test(type) ||
        /[\s()]/.test(type) ||
        BARE_DATA_TYPES.has(type)
      if (!isKnown) {
        reportAt(declaration, messages.invalidDataType(type, call.name), {
          index: value.index + argument.index,
          endIndex: value.index + argument.endIndex,
        })
      }
    }
  }
}

/**
 * Check the nodes of `container` in one walk, so nested at-rules cost no more than their nodes
 */
function checkNodes(
  container: Container,
  inUtility: boolean,
  { reportAt, untypedFunctions }: { reportAt: Report; untypedFunctions: RegExp | undefined },
): void {
  const nodes = container.nodes ?? []
  for (const node of nodes) {
    switch (node.type) {
      case 'atrule': {
        checkAtRule(node, reportAt)
        if (FUNCTION_AT_RULES.test(node.name)) {
          checkAlpha(node, atRulePrelude(node), reportAt)
        }
        checkNodes(node, inUtility || node.name.toLowerCase() === 'utility', {
          reportAt,
          untypedFunctions,
        })
        break
      }
      case 'rule': {
        checkNodes(node, inUtility, { reportAt, untypedFunctions })
        break
      }
      case 'decl': {
        if (!isTypeChecked(node, untypedFunctions)) {
          checkAlpha(node, declarationValue(node), reportAt)
        }
        if (inUtility) {
          checkDataTypes(node, reportAt)
        }
        break
      }
      case 'comment': {
        break
      }
    }
  }
}

/**
 * `untypedFunctions`: the Tailwind functions whose result can be of any type
 */
type SecondaryOptions = { untypedFunctions?: ReadonlyArray<string> | undefined }

const ruleFunction: Rule = (primary: unknown, secondary: unknown) => (root, result) => {
  const isValid = validateOptions(
    result,
    ruleName,
    { actual: primary, possible: [true] },
    {
      actual: secondary,
      possible: { untypedFunctions: [(value: unknown) => typeof value === 'string'] },
      optional: true,
    },
  )
  if (!isValid) {
    return
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Checked by `validateOptions`
  const options = secondary as SecondaryOptions | undefined
  checkNodes(root, false, {
    reportAt: reporter(result),
    untypedFunctions: untypedFunctionsPattern(
      options?.untypedFunctions ?? DEFAULT_UNTYPED_FUNCTIONS,
    ),
  })
}

function reporter(result: PostcssResult): Report {
  return (node, message, range) => {
    report({
      ruleName,
      result,
      node,
      message,
      ...range,
    })
  }
}

ruleFunction.ruleName = ruleName
ruleFunction.messages = messages
ruleFunction.meta = {
  url: 'https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#tailwind-directives',
}

export const tailwindDirectives: Plugin = createPlugin(ruleName, ruleFunction)
