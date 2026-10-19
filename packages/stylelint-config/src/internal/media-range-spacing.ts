/**
 * The `@gpahal/media-range-spacing` rule: a range comparison in a query has one space on each side
 * of its operator. `media-feature-range-notation`'s fix leaves `(width <=1023.98px)`, which
 * Prettier keeps, so this rule spaces it in the same pass
 */

import {
  isTokenAtKeyword,
  isTokenCloseParen,
  isTokenComma,
  isTokenDelim,
  isTokenEOF,
  isTokenFunction,
  isTokenOpenParen,
  isTokenWhitespace,
  tokenize,
  type CSSToken,
  type TokenDelim,
} from '@csstools/css-tokenizer'
import type { AtRule } from 'postcss'
import stylelint, { type Plugin, type Rule } from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

const ruleName = '@gpahal/media-range-spacing'

const messages = ruleMessages(ruleName, {
  expected: (operators: string) => `Expected one space before and after ${operators}`,
})

function describeOperators(comparisons: ReadonlyArray<Comparison>): string {
  const operators = [...new Set(comparisons.map(({ operator }) => `"${operator}"`))]
  const last = operators.pop() ?? ''
  return operators.length === 0 ? last : `${operators.join(', ')} and ${last}`
}

/**
 * The at-rules whose whole prelude is a query, or ends with one, as `@import`'s does
 */
const QUERY_AT_RULES = new Set(['media', 'container', 'custom-media', 'import'])

type Query = {
  start: number
  text: string
}

const OPERATORS = new Set(['<', '>', '<=', '>=', '='])

type Comparison = {
  operator: string
  /**
   * The index of the whitespace before the operator, where the replacement starts
   */
  start: number
  /**
   * The index after the whitespace after the operator, where the replacement ends
   */
  end: number
}

function isOperatorToken(token: CSSToken | undefined): token is TokenDelim {
  return isTokenDelim(token) && ['<', '>', '='].includes(token[4].value)
}

/**
 * The comparison whose operator run starts at `tokens[start]`, and the index after the run. An
 * invalid run such as `=>` or `< =` gets none, since spacing it would make a different, valid
 * query; `media-query-no-invalid` reports it
 */
function readComparison(
  tokens: Array<CSSToken>,
  start: number,
): { comparison: Comparison | undefined; next: number } {
  const operatorTokens: Array<TokenDelim> = []
  let next = start
  for (let index = start; ; index += 1) {
    const token = tokens[index]
    if (isOperatorToken(token)) {
      operatorTokens.push(token)
      next = index + 1
    } else if (!isTokenWhitespace(token)) {
      break
    }
  }
  const first = operatorTokens[0]
  const last = operatorTokens.at(-1)
  const operator = operatorTokens.map((token) => token[1]).join('')
  // A run of more tokens has whitespace inside, as in `< =`, so it's invalid
  if (!first || !last || next - start !== operator.length || !OPERATORS.has(operator)) {
    return { comparison: undefined, next }
  }
  const before = tokens[start - 1]
  const after = tokens[next]
  // Only a whitespace token's text is a space
  if (before?.[1] === ' ' && after?.[1] === ' ') {
    return { comparison: undefined, next }
  }
  return {
    comparison: {
      operator,
      start: isTokenWhitespace(before) ? before[2] : first[2],
      end: (isTokenWhitespace(after) ? after[3] : last[3]) + 1,
    },
    next,
  }
}

/**
 * The misspaced comparisons in `(` blocks, in order. Function arguments, such as `style()` and
 * `supports()`, aren't comparisons, and strings, URLs and escapes are single tokens
 */
function findComparisons(params: string): Array<Comparison> {
  const tokens = tokenize({ css: params })
  const comparisons: Array<Comparison> = []
  // The open blocks, innermost last: `true` for a function, `false` for a `(` block
  const blocks: Array<boolean> = []
  let functionDepth = 0
  // The index of the first token after the last comparison's run
  let next = 0
  for (const [index, token] of tokens.entries()) {
    if (index < next) {
      continue
    }
    if (isTokenFunction(token) || isTokenOpenParen(token)) {
      const isFunction = isTokenFunction(token)
      blocks.push(isFunction)
      functionDepth += isFunction ? 1 : 0
    } else if (isTokenCloseParen(token)) {
      // An unmatched `)` closes nothing
      functionDepth -= blocks.pop() === true ? 1 : 0
    } else if (functionDepth === 0 && blocks.length > 0 && isOperatorToken(token)) {
      const run = readComparison(tokens, index)
      if (run.comparison) {
        comparisons.push(run.comparison)
      }
      next = run.next
    }
  }
  return comparisons
}

/**
 * The `@media` and `@container` queries of a `@custom-variant` shorthand. Tailwind splits it at
 * commas and reads an item starting with `@` as an at-rule, and the rest as selectors
 */
function customVariantQueries(params: string): Array<Query> {
  const tokens = tokenize({ css: params })
  const open = tokens.findIndex((token) => isTokenOpenParen(token) || isTokenFunction(token))
  if (open === -1) {
    return []
  }
  const queries: Array<Query> = []
  let itemStart = open + 1
  let depth = 0
  for (const [index, token] of tokens.entries()) {
    if (index <= open) {
      continue
    }
    if (isTokenOpenParen(token) || isTokenFunction(token)) {
      depth += 1
    } else if (depth > 0 && isTokenCloseParen(token)) {
      depth -= 1
    } else if (
      isTokenCloseParen(token) ||
      isTokenEOF(token) ||
      (depth === 0 && isTokenComma(token))
    ) {
      const query = atRuleQuery(params, tokens, itemStart, token)
      if (query) {
        queries.push(query)
      }
      if (!isTokenComma(token)) {
        break
      }
      itemStart = index + 1
    }
  }
  return queries
}

function atRuleQuery(
  params: string,
  tokens: Array<CSSToken>,
  start: number,
  end: CSSToken,
): Query | undefined {
  const first = isTokenWhitespace(tokens[start]) ? start + 1 : start
  const atKeyword = tokens[first]
  const after = tokens[first + 1]
  if (
    !isTokenAtKeyword(atKeyword) ||
    !['media', 'container'].includes(atKeyword[4].value.toLowerCase()) ||
    !(isTokenWhitespace(after) || isTokenOpenParen(after))
  ) {
    return undefined
  }
  const queryStart = atKeyword[3] + 1
  const queryEnd = isTokenEOF(end) ? params.length : end[2]
  return { start: queryStart, text: params.slice(queryStart, queryEnd) }
}

function queriesOf(atRule: AtRule): Array<Query> {
  const name = atRule.name.toLowerCase()
  if (QUERY_AT_RULES.has(name)) {
    return [{ start: 0, text: atRule.params }]
  }
  return name === 'custom-variant' ? customVariantQueries(atRule.params) : []
}

function paramsIndex(atRule: AtRule): number {
  return 1 + atRule.name.length + (atRule.raws.afterName?.length ?? 0)
}

const ruleFunction: Rule = (primary: unknown) => async (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary, possible: [true] })) {
    return
  }
  // Stylelint runs plugin rules first and doesn't await each, so waiting a tick runs this after
  // `media-feature-range-notation`, whose fix's output it then spaces in the same pass
  await Promise.resolve()
  root.walkAtRules((atRule) => {
    // A prelude with comments keeps its text in `raws.params`, which a fix would drop
    if (atRule.raws.params !== undefined) {
      return
    }
    const { params } = atRule
    const comparisons = queriesOf(atRule).flatMap((query) =>
      findComparisons(query.text).map(({ operator, start, end }) => ({
        operator,
        start: query.start + start,
        end: query.start + end,
      })),
    )
    const first = comparisons[0]
    const last = comparisons.at(-1)
    if (!first || !last) {
      return
    }
    // One warning per at-rule, since `computeEditInfo` calls only a node's first fix
    const offset = paramsIndex(atRule)
    report({
      ruleName,
      result,
      node: atRule,
      index: offset + first.start,
      endIndex: offset + last.end,
      message: messages.expected(describeOperators(comparisons)),
      fix: {
        apply: () => {
          atRule.params = respace(params, comparisons)
        },
        node: atRule,
      },
    })
  })
}

function respace(params: string, comparisons: Array<Comparison>): string {
  const parts: Array<string> = []
  let last = 0
  for (const { operator, start, end } of comparisons) {
    parts.push(params.slice(last, start), ` ${operator} `)
    last = end
  }
  parts.push(params.slice(last))
  return parts.join('')
}

ruleFunction.ruleName = ruleName
ruleFunction.messages = messages
ruleFunction.meta = {
  url: 'https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#media-range-spacing',
  fixable: true,
}

export const mediaRangeSpacing: Plugin = createPlugin(ruleName, ruleFunction)
