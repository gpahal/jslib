// Compiled by `typecheck` under strict settings: the README's recipe spreads the static config's
// `overrides`, which the declarations must type as set

import prettierConfig from '@gpahal/prettier-config'

export const config = {
  ...prettierConfig,
  overrides: [...prettierConfig.overrides, { files: 'scripts/**', options: { semi: true } }],
}

export const plugins: ReadonlyArray<unknown> = [...prettierConfig.plugins]
