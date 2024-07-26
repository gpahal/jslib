import eslintBaseConfig, { defineConfig } from '@gpahal/eslint-config/base'
import eslintVitestConfig from '@gpahal/eslint-config/vitest'

/** @type {import("@gpahal/eslint-config/base").Config} */
export default defineConfig(
  ...eslintBaseConfig(['./tsconfig.eslint.json', './packages/*/tsconfig.json'], import.meta.dirname),
  ...eslintVitestConfig,
)
