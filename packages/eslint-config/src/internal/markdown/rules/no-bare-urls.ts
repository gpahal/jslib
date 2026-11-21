import markdownPlugin from '@eslint/markdown'
import type { MarkdownRuleDefinition } from '@eslint/markdown'

import {
  isAutolinkableBareUrl,
  isLink,
  isUnsafeToRewrite,
} from '@/internal/markdown/rules/prefer-autolinks'
import { RULE_DOCS_URL } from '@/internal/markdown/rules/utils'
import { withReport } from '@/internal/utils'

const STOCK_RULE = markdownPlugin.rules['no-bare-urls']

/**
 * `@eslint/markdown`'s `no-bare-urls`, without the bare URLs that `@gpahal/markdown/prefer-autolinks`
 * reports and fixes, such as `https://example.com`, so each gets one report. It keeps `www.` and
 * email literals. A URL that rewriting could retarget, such as one with a character reference, gets
 * no fix
 */
export const noBareUrls: MarkdownRuleDefinition<{ RuleOptions: []; MessageIds: 'bareUrl' }> = {
  meta: {
    languages: ['markdown/*'],
    type: STOCK_RULE.meta.type,
    fixable: STOCK_RULE.meta.fixable,
    docs: { ...STOCK_RULE.meta.docs, url: RULE_DOCS_URL },
    messages: STOCK_RULE.meta.messages,
    schema: [],
  },
  create(context) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- `@eslint/markdown` types its rules' `create` as taking `unknown` and returning `any`
    return STOCK_RULE.create(
      withReport(context, (descriptor) => {
        const node: unknown = 'node' in descriptor ? descriptor.node : undefined
        if (!isLink(node)) {
          context.report(descriptor)
        } else if (isUnsafeToRewrite(context.sourceCode, node)) {
          context.report({ ...descriptor, fix: undefined })
        } else if (!isAutolinkableBareUrl(context.sourceCode, node)) {
          context.report(descriptor)
        }
      }),
    )
  },
}
