import type { Config } from 'stylelint'

/**
 * Compiled by typecheck. When upstream accepts object extends, remove toStylelintExtends in
 * src/internal/overrides.ts and its callers' bridge, then remove this canary
 */
// @ts-expect-error - Stylelint's runtime accepts object extends, but its declarations still omit it
export const objectExtends: Config['extends'] = [{}]
