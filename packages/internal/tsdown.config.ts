import { defineConfig } from 'tsdown'

import rootConfig from '../../tsdown.config.ts'

export default defineConfig({
  ...rootConfig,
  // The Node-only modules, such as `@gpahal/internal/node/resolve`, are in `src/node/`
  entry: ['src/*.ts', 'src/node/*.ts'],
})
