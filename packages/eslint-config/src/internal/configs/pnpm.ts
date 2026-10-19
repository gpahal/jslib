import eslintPluginJson from '@eslint/json'
import eslintPluginPnpm from 'eslint-plugin-pnpm'
import eslintPluginYml from 'eslint-plugin-yml'

import { FIXTURE_IGNORES } from '@/internal/configs/constants'
import type { TypedConfig } from '@/internal/types'

/**
 * pnpm workspace checks: catalogs that are unused, duplicated or missing, and `package.json`
 * settings that belong in `pnpm-workspace.yaml`. Not `json-enforce-catalog`, which moves every
 * dependency to a catalog. Each config sets its own language, the same plugin objects as the `json`
 * and `yaml` areas register, so the checks work with those areas off
 */
export function pnpm(): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/pnpm/package-json',
      files: ['**/package.json'],
      ignores: FIXTURE_IGNORES,
      plugins: { pnpm: eslintPluginPnpm, json: eslintPluginJson },
      language: 'json/json',
      rules: {
        // Its fix points a `catalog:` specifier at a catalog that has the package, which for a
        // misspelled catalog, such as `catalog:react-19` beside `react18` and `react19`, can be
        // another major version, so it only reports. `autoInsert` would add the package to
        // `pnpm-workspace.yaml` with the placeholder version `^0.0.0`
        'pnpm/json-valid-catalog': ['error', { autoInsert: false, autofix: false }],
        // ESLint builds a fix for every report, applied or not, and building this one queues a
        // write of `pnpm-workspace.yaml`, so any run that reports it would rewrite that file. The
        // fix also leaves a comma behind when `pnpm` is the last field
        'pnpm/json-prefer-workspace-settings': ['error', { autofix: false }],
      },
    },
    {
      name: 'gpahal/pnpm/workspace',
      files: ['**/pnpm-workspace.yaml'],
      plugins: { yml: eslintPluginYml },
      language: 'yml/yaml',
      rules: {
        'pnpm/yaml-no-duplicate-catalog-item': 'error',
        'pnpm/yaml-no-unused-catalog-item': 'error',
        'pnpm/yaml-valid-packages': 'error',
      },
    },
  ]
}
