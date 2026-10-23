import { DEFAULT_PROJECT_CONFLICT } from '@/internal/project-service'

import { parseWithProjectService } from './project-service-parse'

// Each test pins upstream behavior that this package's code relies on, and its message names the
// code to update when upstream changes it. The canaries of upstream bugs are in
// `upstream-workarounds.canary.test.ts`

describe('upstream contracts', () => {
  const message =
    'typescript-estree words this error differently now: update `DEFAULT_PROJECT_CONFLICT` in src/internal/project-service.ts'

  it(message, async () => {
    expect(await parseWithProjectService('c', 'c.config.ts'), message).toContain(
      DEFAULT_PROJECT_CONFLICT,
    )
  })
})
