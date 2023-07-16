import { defineConfig } from 'tsup'

import { getBaseConfig } from './config/tsup.base.config'

export default defineConfig((options) => {
  return getBaseConfig(options)
})
