/**
 * Readers of Tailwind CSS v4 values for the own Tailwind rules: splitting a value as Tailwind's
 * `segment()` does, and finding the calls of Tailwind's functions in a value
 */

import {
  isTokenCloseParen,
  isTokenComma,
  isTokenDelim,
  isTokenFunction,
  isTokenOpenParen,
  tokenize,
} from '@csstools/css-tokenizer'
import type { AtRule, Declaration } from 'postcss'

export type Part = { text: string; index: number }

const CLOSING: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' }

/**
 * `text` split at each `separator` outside parentheses, brackets, braces and quotes, as Tailwind's
 * `segment()` splits it. A backslash escapes the character after it
 */
export function segment(text: string, separator: string): Array<Part> {
  const parts: Array<Part> = []
  const closers: Array<string> = []
  let quote: string | undefined
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (char === '\\') {
      index += 1
    } else if (quote !== undefined) {
      if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (Object.hasOwn(CLOSING, char)) {
      closers.push(CLOSING[char] ?? '')
    } else if (char === closers.at(-1)) {
      closers.pop()
    } else if (char === separator && closers.length === 0) {
      parts.push({ text: text.slice(start, index), index: start })
      start = index + 1
    }
  }
  parts.push({ text: text.slice(start), index: start })
  return parts
}

/**
 * A function call in a value, with its range, its top-level arguments and its top-level `/`s
 */
export type FunctionCall = {
  name: string
  index: number
  endIndex: number
  args: Array<{ index: number; endIndex: number }>
  slashes: Array<number>
}

/**
 * The closed calls in `text` of `names`, nested ones included, in closing order. Names match
 * case-sensitively, as in Tailwind. Linear in the length of `text`
 */
export function functionCalls(text: string, names: ReadonlySet<string>): Array<FunctionCall> {
  const calls: Array<FunctionCall> = []
  const open: Array<FunctionCall | undefined> = []
  const tokens = tokenize({ css: text })
  for (const token of tokens) {
    const call = open.at(-1)
    if (isTokenFunction(token)) {
      open.push(
        names.has(token[4].value)
          ? {
              name: token[4].value,
              index: token[2],
              endIndex: text.length,
              args: [{ index: token[3] + 1, endIndex: text.length }],
              slashes: [],
            }
          : undefined,
      )
    } else if (isTokenOpenParen(token)) {
      open.push(undefined)
    } else if (isTokenCloseParen(token)) {
      open.pop()
      if (call !== undefined) {
        call.endIndex = token[3] + 1
        const last = call.args.at(-1)
        if (last !== undefined) last.endIndex = token[2]
        calls.push(call)
      }
    } else if (call !== undefined && isTokenComma(token)) {
      const last = call.args.at(-1)
      if (last !== undefined) last.endIndex = token[2]
      call.args.push({ index: token[3] + 1, endIndex: text.length })
    } else if (call !== undefined && isTokenDelim(token) && token[4].value === '/') {
      call.slashes.push(token[2])
    }
  }
  return calls
}

/**
 * A declaration's value as written, comments included, and its index in the declaration's text
 */
export function declarationValue(declaration: Declaration): Part {
  const raws: { between?: string; value?: { raw: string } } = declaration.raws
  return {
    text: raws.value?.raw ?? declaration.value,
    index: declaration.prop.length + (raws.between?.length ?? 0),
  }
}

/**
 * An at-rule's prelude as written, comments included, and its index in the at-rule's text
 */
export function atRulePrelude(atRule: AtRule): Part {
  const raws: { afterName?: string; params?: { raw: string } } = atRule.raws
  return {
    text: raws.params?.raw ?? atRule.params,
    index: 1 + atRule.name.length + (raws.afterName?.length ?? 0),
  }
}

/**
 * The at-rules whose preludes Tailwind evaluates its functions in, as it does in declaration values.
 * It matches their names case-sensitively
 */
export const FUNCTION_AT_RULES: RegExp = /^(?:media|custom-media|container|supports)$/
