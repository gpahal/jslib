// Upstream behavior that this package's code relies on, which isn't a bug it works around. The
// canaries of those bugs are in `upstream.canary.test.ts`

import stylelint from 'stylelint'

describe('upstream contracts', () => {
  it("custom-property-empty-line-before: the messages that @gpahal/custom-property-empty-line-before's fix reads", async () => {
    // A changed message makes the rule report the warning without a fix. Update the comparisons in
    // src/internal/custom-property-empty-line-before.ts if the messages change
    const stockRule = await stylelint.rules['custom-property-empty-line-before']
    expect(stockRule.messages).toEqual({
      expected: 'Expected empty line before custom property (custom-property-empty-line-before)',
      rejected: 'Expected no empty line before custom property (custom-property-empty-line-before)',
    })
  })
})
