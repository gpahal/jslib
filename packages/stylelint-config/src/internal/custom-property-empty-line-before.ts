/**
 * The `@gpahal/custom-property-empty-line-before` rule: Stylelint's
 * `custom-property-empty-line-before`, with the same options, except that it skips the custom
 * properties of `style` attributes. postcss-html parses each attribute as a root of its own, which
 * the stock rule's `first-nested` exception can't apply to, so it asks for an empty line before
 * `style="--progress: 50%"`, and its fix writes one into the attribute.
 *
 * The stock rule runs on every other root through `checkAgainstRule`, in a result of its own, and
 * its warnings are reported again under this rule's name with this rule's fix. Running it on the
 * linted result would report under the stock rule's name, with its severity and disable comments,
 * and its fix would read the stock rule's setting, which is `null`. A warning whose text isn't one
 * of the stock rule's messages is reported without a fix.
 * It steps aside for the stock rule as `isStockRuleOn` describes
 */

import type { Declaration, Node } from 'postcss'
import stylelint from 'stylelint'
import type { Plugin, Rule } from 'stylelint'

import { isInlineStyle, setEmptyLineBefore } from '@/internal/empty-lines'
import { isDisabledByStockRule, isStockRuleOn } from '@/internal/stock-disables'

const {
  createPlugin,
  utils: { checkAgainstRule, report, ruleMessages, validateOptions },
} = stylelint

/**
 * The rule's name. It replaces `custom-property-empty-line-before`
 */
export const CUSTOM_PROPERTY_EMPTY_LINE_BEFORE = '@gpahal/custom-property-empty-line-before'

const ruleName = CUSTOM_PROPERTY_EMPTY_LINE_BEFORE

const STOCK_RULE_NAME = 'custom-property-empty-line-before'

const messages = ruleMessages(ruleName, {
  expected: 'Expected empty line before custom property',
  rejected: 'Expected no empty line before custom property',
})

function isDeclaration(node: Node): node is Declaration {
  return node.type === 'decl'
}

const ruleFunction: Rule =
  (primary: unknown, secondary: unknown, context) => async (root, result) => {
    const isValid = validateOptions(
      result,
      ruleName,
      { actual: primary, possible: ['always', 'never'] },
      {
        actual: secondary,
        possible: {
          except: ['after-block', 'after-comment', 'after-custom-property', 'first-nested'],
          ignore: [
            'after-comment',
            'after-custom-property',
            'first-nested',
            'inside-single-line-block',
          ],
        },
        optional: true,
      },
    )
    if (!isValid || isStockRuleOn(result, STOCK_RULE_NAME) || isInlineStyle(root)) {
      return
    }
    const stockRule = await stylelint.rules[STOCK_RULE_NAME]
    const problems: Array<{ decl: Declaration; isExpected: boolean }> = []
    const unknownWarnings: Array<{ node: Node; text: string }> = []
    // Without `result`, the stock rule reports into a result of its own, with no config, so it
    // doesn't apply its fixes
    await checkAgainstRule(
      {
        ruleName: STOCK_RULE_NAME,
        ruleSettings: secondary === undefined ? primary : [primary, secondary],
        root,
        context,
      },
      (warning) => {
        const { node, text } = warning
        const isExpected = text === stockRule.messages['expected']
        if (isDeclaration(node) && (isExpected || text === stockRule.messages['rejected'])) {
          problems.push({ decl: node, isExpected })
        } else {
          // A warning this rule doesn't know, as after an upgrade changes the stock rule's
          // messages, is reported as it is, since a fix would guess which way it goes
          unknownWarnings.push({ node, text })
        }
      },
    )
    for (const { node, text } of unknownWarnings) {
      if (isDisabledByStockRule(result, STOCK_RULE_NAME, ruleName, node.source?.start?.line)) {
        continue
      }
      report({
        ruleName,
        result,
        node,
        message: text.replace(` (${STOCK_RULE_NAME})`, () => ` (${ruleName})`),
      })
    }
    const newline = context.newline ?? '\n'
    for (const { decl, isExpected } of problems) {
      if (isDisabledByStockRule(result, STOCK_RULE_NAME, ruleName, decl.source?.start?.line)) {
        continue
      }
      report({
        ruleName,
        result,
        node: decl,
        message: isExpected ? messages.expected : messages.rejected,
        // An edit of the parent, as the stock rule's, since the declaration's own text leaves out
        // `raws.before`
        fix: {
          apply: () => {
            setEmptyLineBefore(decl, isExpected, newline)
          },
          node: decl.parent ?? decl,
        },
      })
    }
  }

ruleFunction.ruleName = ruleName
ruleFunction.messages = messages
ruleFunction.meta = {
  url: 'https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#custom-property-empty-line-before',
  fixable: true,
}

export const customPropertyEmptyLineBefore: Plugin = createPlugin(ruleName, ruleFunction)
