import { isDeepStrictEqual } from 'node:util'

import type { Linter, Rule } from 'eslint'
import type { Nodes, Root } from 'mdast'

import {
  findLineIndex,
  getHtmlComments,
  getLines,
  toCommentKey,
  toHtmlOffset,
  type CommentKind,
  type FileState,
  type Placement,
  type TextLine,
} from '@/internal/markdown/processor/blocks'

/**
 * As in `(no problems were reported from 'a', 'b', or 'c')`. A test pins the text, so a rewording
 * in ESLint fails it rather than silently turning the filter off
 */
const UNUSED_DISABLE_DIRECTIVE_REGEX =
  /^Unused eslint-disable directive \(no problems were reported(?: from (?<rules>.+))?\)\.$/su

/**
 * A test pins the text too
 */
const UNUSED_ENABLE_DIRECTIVE_REGEX =
  /^Unused eslint-enable directive \(no matching eslint-disable directives were found(?: for (?<rules>.+))?\)\.$/su

const QUOTED_RULE_REGEX = /'(?<rule>[^']+)'/gu

/**
 * As in `Unused inline config ('no-var' is not enabled so can't be turned off).`
 */
const UNUSED_INLINE_CONFIG_REGEX = /^Unused inline config \('(?<rule>[^']+)' /u

type DirectiveKind = 'disable' | 'enable'

/**
 * `[]` for a directive naming no rules, `undefined` for another message
 */
function getUnusedDirective(
  message: Linter.LintMessage,
): { kind: DirectiveKind; rules: Array<string> } | undefined {
  if (message.ruleId !== null) {
    return undefined
  }
  const disable = UNUSED_DISABLE_DIRECTIVE_REGEX.exec(message.message)
  const match = disable ?? UNUSED_ENABLE_DIRECTIVE_REGEX.exec(message.message)
  return match
    ? {
        kind: disable ? 'disable' : 'enable',
        rules: (match.groups?.['rules'] ?? '')
          .matchAll(QUOTED_RULE_REGEX)
          .map((rule) => rule.groups?.['rule'] ?? '')
          .toArray(),
      }
    : undefined
}

function getUnusedInlineConfigRule(message: Linter.LintMessage): string | undefined {
  return message.ruleId === null
    ? UNUSED_INLINE_CONFIG_REGEX.exec(message.message)?.groups?.['rule']
    : undefined
}

export function isDirectiveMessage(message: Linter.LintMessage): boolean {
  return (
    getUnusedDirective(message) !== undefined || getUnusedInlineConfigRule(message) !== undefined
  )
}

function formatUnusedDirectiveMessage(kind: DirectiveKind, rules: Array<string>): string {
  const quoted = rules.map((rule) => `'${rule}'`)
  const description =
    quoted.length <= 2
      ? quoted.join(' or ')
      : `${quoted.slice(0, -1).join(', ')}, or ${quoted.at(-1) ?? ''}`
  return kind === 'disable'
    ? `Unused eslint-disable directive (no problems were reported from ${description}).`
    : `Unused eslint-enable directive (no matching eslint-disable directives were found for ${description}).`
}

/**
 * Narrows the file's unused-directive message to what the block's lint finds unused too, since a
 * rule only one lint runs is unused in the other. Without a fix, which could delete text the other
 * lint needs
 */
function intersectUnused(
  message: Linter.LintMessage,
  others: ReadonlyArray<Linter.LintMessage>,
): Linter.LintMessage | undefined {
  const { fix: _fix, suggestions: _suggestions, ...withoutFixes } = message
  const directive = getUnusedDirective(message)
  if (directive === undefined) {
    const rule = getUnusedInlineConfigRule(message)
    return others.some((other) => getUnusedInlineConfigRule(other) === rule)
      ? withoutFixes
      : undefined
  }
  const { kind, rules } = directive
  // ESLint may report a partly used directive's unused rules in several messages
  const otherRules = others.flatMap((other) => {
    const unused = getUnusedDirective(other)
    return unused?.kind === kind ? [unused.rules] : []
  })
  if (rules.length === 0) {
    return otherRules.some((unused) => unused.length === 0) ? withoutFixes : undefined
  }
  const both = rules.filter((rule) => otherRules.some((unused) => unused.includes(rule)))
  return both.length === 0
    ? undefined
    : both.length === rules.length
      ? withoutFixes
      : { ...withoutFixes, message: formatUnusedDirectiveMessage(kind, both) }
}

const DIRECTIVE_PLACEMENT_RULE = '@gpahal/markdown/directive-placement'

/**
 * A message about a comment put in a block is narrowed by {@link intersectUnused}. One about an
 * excluded comment gives way to `@gpahal/markdown/directive-placement`, kept where the file's lint
 * finds it unused; with that rule off, it stays without a fix
 */
export function adjustFileMessages(
  own: Array<Linter.LintMessage>,
  comments: ReadonlyMap<string, CommentKind>,
  blockUnused: ReadonlyMap<string, Array<Linter.LintMessage>>,
  placements: ReadonlyArray<Placement>,
): Array<Linter.LintMessage> {
  const isUnsupportedPlacement = (message: Linter.LintMessage) =>
    message.ruleId === DIRECTIVE_PLACEMENT_RULE && message.messageId === 'unsupported'
  const placementCommentKeys = new Map(
    placements.map((placement) => [toCommentKey(placement), placement.key]),
  )
  const toPlacementKey = (message: Linter.LintMessage) =>
    placementCommentKeys.get(toCommentKey(message)) ?? toCommentKey(message)
  const placementKeys = new Set(own.filter(isUnsupportedPlacement).map(toPlacementKey))
  const unusedKeys = new Set(
    own
      .filter((message) => comments.get(toCommentKey(message))?.kind === 'unsupported')
      .filter(isDirectiveMessage)
      .map(toCommentKey),
  )
  return own.flatMap((message): Array<Linter.LintMessage> => {
    if (isUnsupportedPlacement(message)) {
      return unusedKeys.has(toPlacementKey(message)) ? [message] : []
    }
    const key = toCommentKey(message)
    const comment = comments.get(key)
    if (comment === undefined || !isDirectiveMessage(message)) {
      return [message]
    }
    if (comment.kind === 'injected') {
      const unused = intersectUnused(message, blockUnused.get(key) ?? [])
      return unused ? [unused] : []
    }
    if (comment.kind === 'excluded' || placementKeys.has(key)) {
      return []
    }
    const { fix: _fix, suggestions: _suggestions, ...withoutFixes } = message
    return [withoutFixes]
  })
}

/**
 * Blank in a blockquote too
 */
const BLANK_LINE_REGEX = /^[\s>]*$/u

const LAST_CHILD_CONTAINERS: ReadonlySet<string> = new Set([
  'blockquote',
  'footnoteDefinition',
  'list',
  'listItem',
])

/**
 * With its ancestors, innermost first, and its sibling index. Ordered children use a binary search
 */
function findHtmlNode(
  { root }: FileState,
  start: number,
  end: number,
): { node: Nodes; ancestors: Array<Nodes>; index: number } | undefined {
  const ancestors: Array<Nodes> = []
  let current: Nodes = root
  let index = 0
  for (;;) {
    if (current.type === 'html') {
      return { node: current, ancestors, index }
    }
    if (!('children' in current)) {
      return undefined
    }
    const children: Array<Nodes> = current.children
    let low = 0
    let high = children.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if ((children[middle]?.position?.start.offset ?? Infinity) <= start) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    index = low - 1
    const child = children[index]
    if (child?.position?.end.offset === undefined || end > child.position.end.offset) {
      return undefined
    }
    ancestors.unshift(current)
    current = child
  }
}

function endsInParagraph(previous: Nodes | undefined): boolean {
  let node = previous
  while (node !== undefined && LAST_CHILD_CONTAINERS.has(node.type) && 'children' in node) {
    node = node.children.at(-1)
  }
  return node?.type === 'paragraph'
}

/**
 * Lists of the same marker and indented code coalesce across blank lines, an indented block after a
 * list can join its last item, a tight list in a blockquote can become loose, and after indented
 * code a following list can parse differently
 */
function needsBlockSeparator(
  previous: Nodes | undefined,
  next: Nodes | undefined,
  text: string,
  parent: Nodes,
): boolean {
  if (previous === undefined || next === undefined) return false
  const startOf = (node: Nodes): number => node.position?.start.offset ?? 0
  const isIndentedCode = (node: Nodes): boolean =>
    node.type === 'code' &&
    !/^ {0,3}(?:`{3}|~{3})/u.test(text.slice(startOf(node), startOf(node) + 6))
  if (previous.type === 'list') {
    if (parent.type === 'blockquote' && previous.spread !== true) return true
    if (
      isIndentedCode(next) ||
      (next.position?.start.column ?? 0) > (previous.position?.start.column ?? 0)
    )
      return true
    if (next.type !== 'list') return false
    const markerOf = (node: Nodes): string | undefined =>
      /^\d*(?<marker>[.*+)-])/u.exec(text.slice(startOf(node), startOf(node) + 10))?.groups?.[
        'marker'
      ]
    return markerOf(previous) === markerOf(next)
  }
  return isIndentedCode(previous) && (isIndentedCode(next) || next.type === 'list')
}

/**
 * A run of comments is checked together, since ESLint can remove every comment in one pass
 */
function blockSeparators({ root, text }: FileState): ReadonlySet<Nodes> {
  const separators = new Set<Nodes>()
  const visit = (parent: Nodes): void => {
    if (!('children' in parent)) return
    let previous: Nodes | undefined
    let pending: Array<Nodes> = []
    for (const child of parent.children) {
      if (child.type === 'html') {
        pending.push(child)
      } else {
        if (needsBlockSeparator(previous, child, text, parent)) {
          for (const node of pending) separators.add(node)
        }
        pending = []
        previous = child
        visit(child)
      }
    }
  }
  visit(root)
  return separators
}

/**
 * Without a blank line on either side, the lines are emptied rather than deleted when the paragraph
 * before would continue into the next line, and left in a tight list's item, which a blank line
 * would make loose. With blank lines on both sides, one goes too, so none doubles
 */
function getLineRemoval(
  state: FileState,
  [firstIndex, lastIndex]: [number, number],
  { node, ancestors, index }: { node: Nodes; ancestors: ReadonlyArray<Nodes>; index: number },
  prefix: string,
  separators: ReadonlySet<Nodes>,
): Rule.Fix | undefined {
  const { lines, text } = state
  const isBlank = (line: TextLine | undefined): boolean =>
    line === undefined || BLANK_LINE_REGEX.test(text.slice(line.start, line.end))
  const lastLineIndex = lines.at(-1)?.start === text.length ? lines.length - 2 : lines.length - 1
  const lineAt = (index: number): TextLine | undefined =>
    index >= 0 && index <= lastLineIndex ? lines[index] : undefined
  const startOf = (index: number): number => lines[index]?.start ?? text.length
  const start = lines[firstIndex]?.start ?? 0
  const end = lines[lastIndex]?.end ?? text.length
  const previous = lineAt(firstIndex - 1)
  const next = lineAt(lastIndex + 1)
  const removal = (from: number, to: number): Rule.Fix => ({ range: [from, to], text: '' })
  const [parent] = ancestors
  const siblings: Array<Nodes> = parent !== undefined && 'children' in parent ? parent.children : []
  if (separators.has(node)) return undefined
  if (isBlank(previous) && isBlank(next)) {
    return next !== undefined
      ? removal(start, startOf(lastIndex + 2))
      : removal(previous?.start ?? start, startOf(lastIndex + 1))
  }
  if (isBlank(previous) || isBlank(next) || !endsInParagraph(siblings[index - 1])) {
    return removal(start, startOf(lastIndex + 1))
  }
  const list = parent?.type === 'listItem' ? ancestors[1] : undefined
  return list?.type === 'list' && list.spread !== true
    ? undefined
    : { range: [start, end], text: prefix.trimEnd() }
}

const FLOW_PARENTS: ReadonlySet<string> = new Set([
  'blockquote',
  'footnoteDefinition',
  'listItem',
  'root',
])

/**
 * The whitespace that HTML collapses and trims. Others, such as a no-break space, render
 */
const HTML_SPACE = ' \t\n\f\r'

const HTML_SPACE_RUN_REGEX = /[\t\n\f\r ]+/gu

function trimSpaceStart(text: string): string {
  let index = 0
  while (index < text.length && HTML_SPACE.includes(text.charAt(index))) {
    index++
  }
  return text.slice(index)
}

function trimSpaceEnd(text: string): string {
  let index = text.length
  while (index > 0 && HTML_SPACE.includes(text.charAt(index - 1))) {
    index--
  }
  return text.slice(0, index)
}

/**
 * Replaces ESLint's removal, which leaves a space that can make a hard break or stop separating
 * blocks. A comment with other text on its lines goes with adjacent whitespace, and one alone on
 * its lines goes with them. `undefined` when no edit keeps what renders
 */
function getDirectiveRemoval(
  state: FileState,
  start: number,
  end: number,
  separators: ReadonlySet<Nodes>,
): Rule.Fix | undefined {
  const { lines, text } = state
  const firstIndex = findLineIndex(lines, start)
  const lastIndex = findLineIndex(lines, end)
  const found = findHtmlNode(state, start, end)
  const first = lines[firstIndex]
  const last = lines[lastIndex]
  if (found === undefined || first === undefined || last === undefined) {
    return undefined
  }
  const before = text.slice(first.start, start)
  const after = text.slice(end, last.end)
  const isFlow = FLOW_PARENTS.has(found.ancestors[0]?.type ?? '')
  if (isFlow && !BLANK_LINE_REGEX.test(before)) {
    return undefined
  }
  if (isFlow && after.trim() === '') {
    return getLineRemoval(state, [firstIndex, lastIndex], found, before, separators)
  }
  const spaceBefore = before.length - trimSpaceEnd(before).length
  if (trimSpaceStart(after) === '') {
    return { range: [start - spaceBefore, last.end], text: '' }
  }
  const spaceAfter = after.length - trimSpaceStart(after).length
  return {
    range: [start, isFlow || spaceBefore > 0 ? end + spaceAfter : end],
    text: '',
  }
}

const TRIMMED_PARENTS: ReadonlySet<string> = new Set(['heading', 'paragraph', 'tableCell'])

/**
 * What renders, for comparing trees before and after a removal: no positions, data or comment-only
 * HTML, merged text with collapsed whitespace. Recursive, since `parseMarkdown` caps the depth
 */
function toStructure(node: Nodes): Record<string, unknown> {
  const { position: _position, data: _data, ...rest } = node
  if (!('children' in node)) {
    return node.type === 'text'
      ? { ...rest, value: node.value.replaceAll(HTML_SPACE_RUN_REGEX, ' ') }
      : rest
  }
  const children: Array<Record<string, unknown>> = []
  for (const child of node.children) {
    if (child.type === 'html' && getHtmlComments(child.value) !== undefined) {
      continue
    }
    const structure = toStructure(child)
    const last = children.at(-1)
    if (structure['type'] === 'text' && last?.['type'] === 'text') {
      last['value'] = `${String(last['value'])}${String(structure['value'])}`.replaceAll(
        HTML_SPACE_RUN_REGEX,
        ' ',
      )
    } else {
      children.push(structure)
    }
  }
  if (TRIMMED_PARENTS.has(node.type)) {
    const first = children[0]
    if (first?.['type'] === 'text') {
      first['value'] = trimSpaceStart(String(first['value']))
    }
    const last = children.at(-1)
    if (last?.['type'] === 'text') {
      last['value'] = trimSpaceEnd(String(last['value']))
    }
  }
  return {
    ...rest,
    children: children.filter((child) => child['type'] !== 'text' || child['value'] !== ''),
  }
}

/**
 * Reparses only the top-level blocks around the fix, since a removal can only join its neighbours.
 * A window at the file's start runs to its end, since a fence there can turn into front matter
 */
function isSameStructure(
  { root, lines, text }: FileState,
  fix: Rule.Fix,
  reparse: (text: string, isFileStart: boolean) => Root | undefined,
): boolean {
  const [start, end] = fix.range
  const { children } = root
  const indexOf = (offset: number): number => {
    let low = 0
    let high = children.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if ((children[middle]?.position?.start.offset ?? Infinity) <= offset) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low - 1
  }
  const first = children[indexOf(start) - 1]
  const last = children[Math.max(indexOf(end), indexOf(start)) + 1]
  const lineStartOf = (offset: number): number => lines[findLineIndex(lines, offset)]?.start ?? 0
  const windowStart = Math.min(lineStartOf(first?.position?.start.offset ?? 0), lineStartOf(start))
  const lastLineIndex = findLineIndex(
    lines,
    Math.max(last?.position?.end.offset ?? text.length, end),
  )
  const windowEnd =
    windowStart === 0 ? text.length : (lines[lastLineIndex + 1]?.start ?? text.length)
  const before = reparse(text.slice(windowStart, windowEnd), windowStart === 0)
  const after = reparse(
    `${text.slice(windowStart, start)}${fix.text}${text.slice(end, windowEnd)}`,
    windowStart === 0,
  )
  return (
    before !== undefined &&
    after !== undefined &&
    isDeepStrictEqual(toStructure(before), toStructure(after))
  )
}

function getCommentRanges({ lines }: FileState, node: Nodes): Array<[number, number]> {
  if (node.type !== 'html' || node.position === undefined) {
    return []
  }
  const comment = { node: { ...node, position: node.position }, valueLines: getLines(node.value) }
  const ranges: Array<[number, number]> = []
  const { value } = node
  for (let start = value.indexOf('<!--'); start !== -1;) {
    const close = value.indexOf('-->', start + 4)
    if (close === -1) {
      break
    }
    const from = toHtmlOffset(lines, comment, start)
    const to = toHtmlOffset(lines, comment, close + 3)
    if (from !== undefined && to !== undefined) {
      ranges.push([from, to])
    }
    start = value.indexOf('<!--', close + 3)
  }
  return ranges
}

/**
 * The first range that holds `[start, end]`. The ranges are in order and their ends never decrease,
 * so only the first one that reaches `end` can
 */
function findContainingRange(
  ranges: ReadonlyArray<[number, number]>,
  start: number,
  end: number,
): [number, number] | undefined {
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((ranges[middle]?.[1] ?? Infinity) < end) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const range = ranges[low]
  return range !== undefined && range[0] <= start ? range : undefined
}

/**
 * `'whole'` when ESLint's fix replaces the whole comment with a space, `'inside'` when it edits
 * only the text inside, as when it drops some rules, or `undefined` for another fix, which isn't
 * applied. `rangesByNode` keeps each node's comment ranges, so many directives in one node don't
 * each rescan it
 */
function getFixKind(
  state: FileState,
  { range, text }: Rule.Fix,
  rangesByNode: Map<Nodes, Array<[number, number]>>,
): 'whole' | 'inside' | undefined {
  const [start, end] = range
  const found = findHtmlNode(state, start, end)
  let ranges: Array<[number, number]> | undefined
  if (found !== undefined) {
    ranges = rangesByNode.get(found.node)
    if (ranges === undefined) {
      ranges = getCommentRanges(state, found.node)
      rangesByNode.set(found.node, ranges)
    }
  }
  const comment = ranges && findContainingRange(ranges, start, end)
  if (comment === undefined) {
    return undefined
  }
  const [from, to] = comment
  if (start === from && end === to) {
    return text === ' ' ? 'whole' : undefined
  }
  return start >= from + '<!--'.length && end <= to - '-->'.length && !/-->|[\n\r]/u.test(text)
    ? 'inside'
    : undefined
}

/**
 * When the combined check fails, at most this many removals are checked one at a time; the rest
 * lose their fixes, so many removals in one large container don't each reparse it
 */
const MAX_SEPARATE_CHECKS = 50

/**
 * ESLint skips a fix whose range starts at or before the end of the last one it applied
 */
function getAppliedFixes(fixes: ReadonlyArray<Rule.Fix>): Array<Rule.Fix> {
  const applied: Array<Rule.Fix> = []
  let lastEnd = -Infinity
  const sorted = fixes.toSorted((a, b) =>
    a.range[0] === b.range[0] ? a.range[1] - b.range[1] : a.range[0] - b.range[0],
  )
  for (const fix of sorted) {
    if (fix.range[0] <= lastEnd) {
      continue
    }
    applied.push(fix)
    lastEnd = fix.range[1]
  }
  return applied
}

function isSameStructureTogether(
  { root, text }: FileState,
  fixes: ReadonlyArray<Rule.Fix>,
  reparse: (text: string, isFileStart: boolean) => Root | undefined,
): boolean {
  let fixed = ''
  let lastEnd = 0
  for (const { range, text: fixText } of getAppliedFixes(fixes)) {
    fixed += `${text.slice(lastEnd, range[0])}${fixText}`
    lastEnd = range[1]
  }
  const after = reparse(`${fixed}${text.slice(lastEnd)}`, true)
  return after !== undefined && isDeepStrictEqual(toStructure(root), toStructure(after))
}

/**
 * Replaces ESLint's unused-directive removal, which leaves a space, with `getDirectiveRemoval`'s, or
 * drops it when the structure checks reject it, since `getLineRemoval` can't foresee every join,
 * such as table rows. A fix whose range isn't one whole HTML comment is dropped, so an off range,
 * as `@eslint/markdown` gives in tab-indented list items, never deletes text
 */
export function fixDirectiveRemovals(
  messages: Array<Linter.LintMessage>,
  state: FileState,
  reparse: (text: string, isFileStart: boolean) => Root | undefined,
): Array<Linter.LintMessage> {
  let separators: ReadonlySet<Nodes> | undefined
  const rangesByNode = new Map<Nodes, Array<[number, number]>>()
  const removals = new Map<number, Rule.Fix>()
  const adjusted = messages.map((message, index) => {
    const { fix } = message
    if (fix === undefined || getUnusedDirective(message) === undefined) {
      return message
    }
    const { fix: _fix, ...withoutFix } = message
    const kind = getFixKind(state, fix, rangesByNode)
    if (kind !== 'whole') {
      return kind === 'inside' ? message : withoutFix
    }
    const [start, end] = fix.range
    const removal = getDirectiveRemoval(state, start, end, (separators ??= blockSeparators(state)))
    if (removal !== undefined) {
      removals.set(index, removal)
    }
    return withoutFix
  })
  if (removals.size > 0 && !isSameStructureTogether(state, removals.values().toArray(), reparse)) {
    let checks = 0
    for (const [index, removal] of removals) {
      if (checks++ >= MAX_SEPARATE_CHECKS || !isSameStructure(state, removal, reparse)) {
        removals.delete(index)
      }
    }
    if (
      removals.size > 0 &&
      !isSameStructureTogether(state, removals.values().toArray(), reparse)
    ) {
      removals.clear()
    }
  }
  return adjusted.map((message, index) => {
    const removal = removals.get(index)
    return removal === undefined ? message : { ...message, fix: removal }
  })
}
