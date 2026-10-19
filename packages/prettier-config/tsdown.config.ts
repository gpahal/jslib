import { defineConfig } from 'tsdown'

import rootConfig from '../../tsdown.config.ts'

export default defineConfig({
  ...rootConfig,
  // The GitHub alerts plugin and the import sorter's wrapper are their own modules, which
  // `defineConfig` passes to Prettier by path
  entry: ['src/*.ts', 'src/internal/github-alerts.ts', 'src/internal/sort-imports.ts'],
  // The root config's `cli`, and the plugin modules, which aren't public
  exports: { exclude: ['cli', 'internal/github-alerts', 'internal/sort-imports'] },
})
