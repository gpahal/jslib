import type { MarkdownRuleDefinition } from '@eslint/markdown'
import { collapseWhiteSpace } from 'collapse-white-space'
import type { Code } from 'mdast'

import { MARKDOWN_LINE_BREAK_REGEX } from '@/internal/markdown/line-breaks'
import { RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

// Ported from remark-lint-no-shell-dollars (MIT)

/**
 * The languages of shell code, from starry-night:
 * https://github.com/wooorm/starry-night/blob/a3e35db/lang/source.shell.js#L8
 */
const SHELL_LANGUAGES = new Set([
  // Extensions
  'bash',
  'bats',
  'command',
  'csh',
  'ebuild',
  'eclass',
  'ksh',
  'sh',
  'sh.in',
  'tcsh',
  'tmux',
  'tool',
  'zsh',
  'zsh-theme',
  // Names without extensions
  'abuild',
  'alpine-abuild',
  'apkbuild',
  'gentoo-ebuild',
  'gentoo-eclass',
  'openrc',
  'openrc-runscript',
  'shell',
  'shell-script',
])

/**
 * A prompt: `$` then whitespace, or `$` alone. `$HOME/bin/tool` starts with a variable instead
 */
const PROMPT_REGEX = /^\$(?:\s|$)/u

/**
 * Reports a shell code block whose every non-empty line starts with a `$` prompt, which shows
 * commands without their output, so the `$` only gets in the way of copying them. The block's
 * language is matched in any case, as in ` ```Bash `
 */
export const noShellDollars: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: 'shellDollars'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'suggestion',
    docs: {
      description: 'Disallow a `$` before every command of a shell code block without output',
      url: RULE_DOCS_URL,
    },
    messages: {
      shellDollars:
        'Unexpected shell code with every line prefixed by `$`, expected different code for input and output',
    },
    schema: [],
  },
  create(context) {
    return {
      code(node: Code) {
        if (!node.position || node.lang == null || !SHELL_LANGUAGES.has(node.lang.toLowerCase())) {
          return
        }
        const lines = node.value
          .split(MARKDOWN_LINE_BREAK_REGEX)
          .map((line) => collapseWhiteSpace(line, { style: 'html', trim: true }))
          .filter((line) => line !== '')
        if (lines.length > 0 && lines.every((line) => PROMPT_REGEX.test(line))) {
          context.report({ loc: node.position, messageId: 'shellDollars' })
        }
      },
    }
  },
}
