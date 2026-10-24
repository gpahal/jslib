/**
 * The own rules that replace `font-family-name-quotes`, `function-url-quotes` and
 * `import-notation`, with the same options. The stock fixes write double quotes, which end a
 * double-quoted `style` attribute early, so these only report in `style` attributes and fix as
 * the stock rules do elsewhere.
 *
 * Each runs its stock rule through `checkAgainstRule` into a result of its own, since running it on
 * the linted result would report under the stock name and read its `null` setting. Fixing honors
 * the disable comments of both names, and warnings are reported again under the own name. It steps
 * aside for the stock rule as `isStockRuleOn` describes
 */

import postcss, { Result } from 'postcss'
import type { Root, Warning } from 'postcss'
import stylelint from 'stylelint'
import type { Plugin, PostcssResult, Rule } from 'stylelint'

import { isRecord } from '@gpahal/std/objects'

import { isInlineStyle } from '@/internal/empty-lines'
import { isDisabledByStockRule, isStockRuleOn } from '@/internal/stock-disables'

const {
  createPlugin,
  utils: { checkAgainstRule, report, validateOptions },
} = stylelint

export const QUOTE_OWN_RULES = [
  ['font-family-name-quotes', '@gpahal/font-family-name-quotes'],
  ['function-url-quotes', '@gpahal/function-url-quotes'],
  ['import-notation', '@gpahal/import-notation'],
] as const

type StockQuoteRule = (typeof QUOTE_OWN_RULES)[number][0]

type OptionDescriptions =
  Parameters<typeof validateOptions> extends [unknown, unknown, ...infer Descriptions]
    ? Descriptions
    : never

/**
 * Each stock rule's options, validated here since its own validation doesn't run in a separate
 * result
 */
function optionDescriptionsOf(
  stock: StockQuoteRule,
  primary: unknown,
  secondary: unknown,
): OptionDescriptions {
  switch (stock) {
    case 'font-family-name-quotes': {
      return [
        {
          actual: primary,
          possible: ['always-where-required', 'always-where-recommended', 'always-unless-keyword'],
        },
      ]
    }
    case 'function-url-quotes': {
      return [
        { actual: primary, possible: ['always', 'never'] },
        { actual: secondary, possible: { except: ['empty'] }, optional: true },
      ]
    }
    case 'import-notation': {
      return [{ actual: primary, possible: ['string', 'url'] }]
    }
  }
}

type DisabledRanges = PostcssResult['stylelint']['disabledRanges']

/**
 * The ranges that disable `rule`, as Stylelint reads them
 */
function rangesOf(disabledRanges: DisabledRanges, rule: string): DisabledRanges[string] {
  return disabledRanges[rule] ?? disabledRanges['all'] ?? []
}

function covers(ranges: DisabledRanges[string], line: number): boolean {
  return ranges.some(({ start, end }) => start <= line && (end === undefined || end >= line))
}

/**
 * A result for the stock rule that fixes or computes edits as `result`'s config asks, except on
 * lines a disable comment of either name covers
 */
function fixResultOf(
  result: PostcssResult,
  root: Root,
  stock: string,
  own: string,
  primary: unknown,
): PostcssResult {
  const { config = {}, disabledRanges, lexer } = result.stylelint
  const stylelintData: PostcssResult['stylelint'] = {
    ruleSeverities: {},
    customMessages: {},
    customUrls: {},
    ruleMetadata: {},
    fixersData: {},
    rangesOfComputedEditInfos: [],
    disabledRanges:
      config.ignoreDisables === true
        ? {}
        : { [stock]: [...rangesOf(disabledRanges, stock), ...rangesOf(disabledRanges, own)] },
    lexer,
    referenceRoots: [],
    config: {
      fix: config.fix === true,
      computeEditInfo: config.computeEditInfo === true,
      rules: { [stock]: [primary, {}] },
    },
  }
  return Object.assign(new Result(postcss(), root, {}), { stylelint: stylelintData })
}

/**
 * Copy what the stock rule's run counted to `result`: the disabled problems, so
 * `reportNeedlessDisables` counts their comments, and the fixes
 */
function recordFixResult(
  result: PostcssResult,
  fixResult: PostcssResult,
  stock: string,
  own: string,
): void {
  const { disabledRanges } = result.stylelint
  const keptLines = (fixResult.stylelint.disabledWarnings ?? []).map(({ line }) => line)
  for (const line of keptLines) {
    for (const rule of [stock, own]) {
      if (covers(rangesOf(disabledRanges, rule), line)) {
        ;(result.stylelint.disabledWarnings ??= []).push({ rule, line })
      }
    }
  }
  const fixed = fixResult.stylelint.fixersData[stock]
  if (fixed !== undefined) {
    result.stylelint.fixersData[own] = (result.stylelint.fixersData[own] ?? 0) + fixed
  }
}

/**
 * Report the stock rule's `warning` under `own`'s name, with its edit, keeping the first edit of
 * each range as Stylelint does
 */
function reportWarning(result: PostcssResult, warning: Warning, stock: string, own: string): void {
  const count = result.messages.length
  report({
    ruleName: own,
    result,
    node: warning.node,
    message: warning.text.replace(` (${stock})`, ''),
    start: { line: warning.line, column: warning.column },
    end: { line: warning.endLine ?? warning.line, column: warning.endColumn ?? warning.column },
  })
  const edit: unknown = Reflect.get(warning, 'fix')
  const reported = result.messages[count]
  if (reported === undefined || !isEdit(edit)) {
    return
  }
  const ranges = result.stylelint.rangesOfComputedEditInfos
  if (ranges.some(([start, end]) => start < edit.range[1] && edit.range[0] < end)) {
    return
  }
  ranges.push(edit.range)
  Object.assign(reported, { fix: edit })
}

function quoteRule(stock: StockQuoteRule, own: string): Plugin {
  const ruleFunction: Rule =
    (primary: unknown, secondary: unknown, context) => async (root: Root, result) => {
      if (
        !validateOptions(result, own, ...optionDescriptionsOf(stock, primary, secondary)) ||
        isStockRuleOn(result, stock)
      ) {
        return
      }
      const { config = {} } = result.stylelint
      const isFixing =
        !isInlineStyle(root) &&
        !(isRecord(secondary) && secondary['disableFix'] === true) &&
        (config.fix === true || config.computeEditInfo === true)
      const fixResult = isFixing ? fixResultOf(result, root, stock, own, primary) : undefined
      const warnings: Array<Warning> = []
      await checkAgainstRule(
        {
          ruleName: stock,
          ruleSettings: secondary === undefined ? primary : [primary, secondary],
          root,
          ...(fixResult !== undefined && { result: fixResult }),
          context,
        },
        (warning) => {
          warnings.push(warning)
        },
      )
      if (fixResult !== undefined) {
        recordFixResult(result, fixResult, stock, own)
      }
      for (const warning of warnings) {
        if (
          // The fixing run skipped the disabled lines already
          fixResult !== undefined ||
          !isDisabledByStockRule(result, stock, own, warning.line)
        ) {
          reportWarning(result, warning, stock, own)
        }
      }
    }
  ruleFunction.ruleName = own
  ruleFunction.messages = {}
  ruleFunction.meta = {
    url: 'https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#quote-rules',
    fixable: true,
  }
  return createPlugin(own, ruleFunction)
}

function isEdit(value: unknown): value is { range: [number, number]; text: string } {
  return (
    isRecord(value) &&
    Array.isArray(value['range']) &&
    value['range'].length === 2 &&
    typeof value['text'] === 'string'
  )
}

export const quoteRules: ReadonlyArray<Plugin> = QUOTE_OWN_RULES.map(([stock, own]) =>
  quoteRule(stock, own),
)
