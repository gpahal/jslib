import { defineConfig } from 'tsup'

import { getBaseConfig } from './config/tsup/tsup.base.config'

export default defineConfig((options) => {
  return getBaseConfig(options)
})
