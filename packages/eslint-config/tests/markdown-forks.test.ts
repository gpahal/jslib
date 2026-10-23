import { minCpuMs } from '@gpahal/internal/node/testing'

import { lintRun } from './markdown-fork-helpers'

// The canaries of the forks, which fail once a stock rule no longer differs, are in
// `markdown-forks.canary.test.ts`

describe('the fork of `no-multiple-h1`', () => {
  it('scales linearly on an unclosed `<!--`', () => {
    // Against a rule that only reads code blocks, so the time to parse the file, which most of the
    // lint takes, is in both. The stock rule takes over 20 times as long as that on 40,000 lines
    const code = `# A\n\n${'<!--\n'.repeat(40_000)}`
    const [forkMs = 0, baseMs = 0] = minCpuMs([
      lintRun('no-multiple-h1', code, true),
      lintRun('lowercase-code-block-language', code, true),
    ])
    expect(forkMs).toBeLessThan(4 * baseMs + 200)
  })
})
