import type { MarkdownRuleDefinition } from '@eslint/markdown'

import { getProcessorState } from '@/internal/markdown/processor'
import type { PlacementMessageId } from '@/internal/markdown/processor/blocks'
import { RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

const REMEDY = 'Use `<!-- eslint-skip -->`, or move the directive'

/**
 * Reports the directive comments right before code blocks that the blocks don't take, from the
 * state of the Markdown processor, which reads the code blocks: a directive that can't be written
 * in the block's comment syntax, a second `eslint-disable-next-line` before a YAML or TOML block,
 * and a directive before a block without directives that the Markdown file doesn't use, which the
 * processor keeps only then. Without the processor, it reports nothing
 */
export const directivePlacement: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: PlacementMessageId
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'problem',
    docs: {
      description: "Disallow directive comments before code blocks that the blocks can't take",
      url: RULE_DOCS_URL,
    },
    messages: {
      containsClose: `Unexpected \`{{close}}\` in a directive before a \`\`\`{{info}} block, which would end the \`{{open}}\` comment it becomes there, so it isn't applied to the block. ${REMEDY}`,
      multiLine: `Unexpected multi-line directive before a \`\`\`{{info}} block, which would become a \`{{open}}\` line comment there, so it isn't applied to the block. ${REMEDY}`,
      sharedLine: `Unexpected second \`eslint-disable-next-line\` directive before a \`\`\`{{info}} block, whose \`{{open}}\` comments can't share a line, so it isn't applied to the block. ${REMEDY}`,
      unsupported: `Unexpected directive before a \`\`\`{{info}} block, which takes no directives, so it isn't applied to the block. ${REMEDY}`,
    },
    schema: [],
  },
  create(context) {
    return {
      root() {
        const placements =
          getProcessorState(context.filename, context.sourceCode.text)?.placements ?? []
        for (const { messageId, info, syntax, line, column } of placements) {
          context.report({
            loc: { line, column },
            messageId,
            data: { info, open: syntax.open, close: syntax.close },
          })
        }
      },
    }
  },
}
