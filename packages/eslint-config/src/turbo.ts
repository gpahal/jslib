/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginTurbo from 'eslint-plugin-turbo'
import { config } from 'typescript-eslint'

import type { Config } from './base'

export default config({
  plugins: {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    turbo: eslintPluginTurbo,
  },
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  settings: eslintPluginTurbo.configs.recommended.settings,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  rules: eslintPluginTurbo.configs.recommended.rules,
}) as Config
