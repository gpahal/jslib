import markdownPlugin from '@eslint/markdown'
import type { MarkdownRuleDefinition } from '@eslint/markdown'

import { isAutolinkableBareUrl, isLink } from '@/internal/markdown/rules/prefer-autolinks'
import { RULE_DOCS_URL } from '@/internal/markdown/rules/utils'
import { withReport } from '@/internal/utils'

const STOCK_RULE = markdownPlugin.rules['no-bare-urls']

/**
 * `@eslint/markdown`'s `no-bare-urls` without its fix, which in 8.0.3 wraps a URL in `<>` without
 * adding a scheme, so `www.example.com` becomes `<www.example.com>`, which isn't an autolink
 * (https://github.com/eslint/markdown/issues/710). Drop the fix removal once a release has the fix.
 * It leaves out the bare URLs that `@gpahal/markdown/prefer-autolinks` reports and fixes, such as
 * `https://example.com`, so each gets one report, and keeps `www.` and email literals
 */
export const noBareUrls: MarkdownRuleDefinition<{ RuleOptions: []; MessageIds: 'bareUrl' }> = {
  meta: {
    languages: ['markdown/*'],
    type: STOCK_RULE.meta.type,
    docs: { ...STOCK_RULE.meta.docs, url: RULE_DOCS_URL },
    messages: STOCK_RULE.meta.messages,
    schema: [],
  },
  create(context) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- `@eslint/markdown` types its rules' `create` as taking `unknown` and returning `any`
    return STOCK_RULE.create(
      withReport(context, (descriptor) => {
        const node: unknown = 'node' in descriptor ? descriptor.node : undefined
        if (!(isLink(node) && isAutolinkableBareUrl(context.sourceCode, node))) {
          context.report({ ...descriptor, fix: undefined })
        }
      }),
    )
  },
}
