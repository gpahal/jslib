import { configs as eslintPluginNodeConfigs } from 'eslint-plugin-n'
import { config } from 'typescript-eslint'

import type { Config } from './base'

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
export default config(eslintPluginNodeConfigs['flat/recommended']) as Config
