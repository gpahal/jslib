/**
 * The `@gpahal/declaration-empty-line-before` rule: Stylelint's `declaration-empty-line-before`,
 * except that a declaration right after `@apply` needs no empty line and `style` attributes are
 * skipped. A wrapper can't exempt `@apply`, since under `--fix` the stock rule fixes before a
 * wrapper sees its reports. postcss-html parses each `style` attribute as its own root, where the
 * stock rule's fix adds an empty line to an attribute Prettier wrapped. It steps aside for the stock
 * rule as `isStockRuleOn` describes
 */

import type { AtRule, ChildNode, Container, Rule as CssRule, Node } from 'postcss'
import stylelint, { type Plugin, type Rule } from 'stylelint'

import { toArray } from '@gpahal/std/arrays'
import { isRecord } from '@gpahal/std/objects'

import { isInlineStyle, setEmptyLineBefore } from '@/internal/empty-lines'
import { isDisabledByStockRule, isStockRuleOn } from '@/internal/stock-disables'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

export const DECLARATION_EMPTY_LINE_BEFORE = '@gpahal/declaration-empty-line-before'

const ruleName = DECLARATION_EMPTY_LINE_BEFORE

const STOCK_RULE_NAME = 'declaration-empty-line-before'

const messages = ruleMessages(ruleName, {
  expected: 'Expected empty line before declaration',
  rejected: 'Expected no empty line before declaration',
})

function isRule(node: Node): node is CssRule {
  return node.type === 'rule'
}

function isAtRule(node: Node): node is AtRule {
  return node.type === 'atrule'
}

/**
 * Whether `node` is a standard, non-custom property declaration, as the stock rule decides with
 * `isStandardSyntaxDeclaration` and `isCustomProperty`
 */
function isPropertyDeclaration(node: ChildNode | undefined): boolean {
  if (node?.type !== 'decl') {
    return false
  }
  const { prop, parent } = node
  if (
    prop.startsWith('--') ||
    prop.startsWith('$') ||
    prop.includes('.$') ||
    (prop.startsWith('@') && prop[1] !== '{') ||
    ('extend' in node && Boolean(node.extend))
  ) {
    return false
  }
  if (parent && isAtRule(parent)) {
    return parent.raws.afterName !== ':'
  }
  if (parent && isRule(parent) && parent.selector) {
    const { selector } = parent
    return !(
      (selector.startsWith('#') && selector.endsWith('()')) ||
      (selector.endsWith(':') && !selector.startsWith('--'))
    )
  }
  return true
}

function lineOf(node: ChildNode | undefined, edge: 'start' | 'end' = 'start'): number | undefined {
  return node?.source?.[edge]?.line
}

type Siblings = (
  node: ChildNode,
) => { previous: ChildNode | undefined; next: ChildNode | undefined } | undefined

/**
 * Index each block once, since PostCSS's `prev` and `next` scan the siblings. The rule changes only
 * whitespace, so the index stays valid through a fix pass
 */
function createSiblingLookup(): Siblings {
  const siblings = new WeakMap<
    ChildNode,
    { previous: ChildNode | undefined; next: ChildNode | undefined }
  >()
  return (node) => {
    if (!siblings.has(node) && node.parent) {
      const nodes = node.parent.nodes ?? []
      for (const [index, child] of nodes.entries()) {
        siblings.set(child, { previous: nodes[index - 1], next: nodes[index + 1] })
      }
    }
    return siblings.get(node)
  }
}

/**
 * The node before `node`, skipping the comments that share a line with the node after them or the
 * node before them
 */
function previousSkippingSharedLineComments(
  node: ChildNode,
  siblings: Siblings,
): ChildNode | undefined {
  let current = node
  let previous = siblings(current)?.previous
  while (
    previous?.type === 'comment' &&
    (lineOf(current) === lineOf(previous) ||
      lineOf(previous) === lineOf(siblings(previous)?.previous))
  ) {
    current = previous
    previous = siblings(current)?.previous
  }
  return previous
}

function nextSkippingSharedLineComments(
  node: ChildNode,
  siblings: Siblings,
): ChildNode | undefined {
  let current = node
  let next = siblings(current)?.next
  while (
    next?.type === 'comment' &&
    (lineOf(current) === lineOf(next) || lineOf(next) === lineOf(siblings(next)?.next))
  ) {
    current = next
    next = siblings(current)?.next
  }
  return next
}

function isAfterComment(node: ChildNode, siblings: Siblings): boolean {
  const comment = siblings(node)?.previous
  if (comment?.type !== 'comment') {
    return false
  }
  const previous = previousSkippingSharedLineComments(comment, siblings)
  const next = nextSkippingSharedLineComments(comment, siblings)
  return !(
    (previous !== undefined && lineOf(previous, 'end') === lineOf(comment)) ||
    (next !== undefined && lineOf(comment, 'end') === lineOf(next)) ||
    (comment.parent?.type !== 'root' &&
      comment === comment.parent?.first &&
      comment.raws.before?.includes('\n') === false)
  )
}

/**
 * The first node in a block, skipping only comments on the line of its `{`
 */
function firstNested(parent: Container): ChildNode | undefined {
  if (parent.type === 'root' && parent.parent?.type !== 'document') {
    return undefined
  }
  const first = parent.first
  const braceLine = lineOf(first)
  if (
    braceLine === undefined ||
    first?.type !== 'comment' ||
    first.raws.before?.includes('\n') === true ||
    lineOf(first, 'end') !== braceLine
  ) {
    return first
  }
  const nodes = parent.nodes ?? []
  for (const sibling of nodes) {
    if (sibling.type !== 'comment' || lineOf(sibling, 'end') !== braceLine) {
      return sibling
    }
  }
  return undefined
}

/**
 * Whether a block, from its `{` to its `}`, or a whole stylesheet, is on one line
 */
function isSingleLineBlock(parent: Container): boolean {
  let head = ''
  if (isRule(parent)) {
    head = `${parent.raws.selector?.raw ?? parent.selector}${parent.raws.between ?? ''}`
  } else if (isAtRule(parent)) {
    head = `@${parent.name}${parent.raws.afterName ?? ''}${parent.raws.params?.raw ?? parent.params}${parent.raws.between ?? ''}`
  }
  return !/[\n\r]/.test(parent.toString().slice(head.length))
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
          except: ['first-nested', 'after-block', 'after-comment', 'after-declaration'],
          ignore: [
            'after-comment',
            'after-declaration',
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
    // Waiting a tick runs this after `declaration-block-no-duplicate-properties`, whose fix can
    // remove the declaration that held the blank line, so the result settles in one pass
    await Promise.resolve()
    const has = (key: 'except' | 'ignore', name: string): boolean =>
      isRecord(secondary) && toArray(secondary[key]).includes(name)
    const siblings = createSiblingLookup()
    const firstNodes = new WeakMap<Container, ChildNode | undefined>()
    const isFirstNested = (node: ChildNode): boolean => {
      const { parent } = node
      if (!parent) {
        return false
      }
      if (!firstNodes.has(parent)) {
        firstNodes.set(parent, firstNested(parent))
      }
      return firstNodes.get(parent) === node
    }
    const singleLineBlocks = new WeakMap<Container, boolean>()
    const isSingleLine = (parent: Container): boolean => {
      let singleLine = singleLineBlocks.get(parent)
      if (singleLine === undefined) {
        singleLine = isSingleLineBlock(parent)
        singleLineBlocks.set(parent, singleLine)
      }
      return singleLine
    }
    root.walkDecls((decl) => {
      const { parent } = decl
      const previous = siblings(decl)?.previous
      // A comment after the `@apply` on its line, as in `@apply font-bold; /* why */`, is skipped
      const previousNode = previousSkippingSharedLineComments(decl, siblings)
      if (
        !parent ||
        (parent.type === 'root' && decl === parent.first) ||
        !['atrule', 'rule', 'root'].includes(parent.type) ||
        !isPropertyDeclaration(decl) ||
        (previousNode?.type === 'atrule' && previousNode.name === 'apply')
      ) {
        return
      }
      const isAfterDeclaration = isPropertyDeclaration(previousNode)
      if (
        (has('ignore', 'after-comment') && isAfterComment(decl, siblings)) ||
        (isAfterDeclaration && has('ignore', 'after-declaration')) ||
        (has('ignore', 'first-nested') && isFirstNested(decl)) ||
        (has('ignore', 'inside-single-line-block') && isSingleLine(parent))
      ) {
        return
      }
      const isExcepted =
        (has('except', 'first-nested') && isFirstNested(decl)) ||
        (has('except', 'after-block') &&
          (previous?.type === 'rule' || previous?.type === 'atrule')) ||
        (has('except', 'after-comment') && isAfterComment(decl, siblings)) ||
        (isAfterDeclaration && has('except', 'after-declaration'))
      const isExpected = (primary === 'always') !== isExcepted
      const before = decl.raws.before ?? ''
      if (
        isExpected === /\n[\t\r ]*\n/.test(before) ||
        isDisabledByStockRule(result, STOCK_RULE_NAME, ruleName, decl.source?.start?.line)
      ) {
        return
      }
      const newline = context.newline ?? '\n'
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
          node: parent,
        },
      })
    })
  }

ruleFunction.ruleName = ruleName
ruleFunction.messages = messages
ruleFunction.meta = {
  url: 'https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#declaration-empty-line-before',
  fixable: true,
}

export const declarationEmptyLineBefore: Plugin = createPlugin(ruleName, ruleFunction)
