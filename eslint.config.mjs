import eslintBaseConfig from '@gpahal/eslint-config/base'
import eslintVitestConfig from '@gpahal/eslint-config/vitest'

/** @type {import("@gpahal/eslint-config/base").Config} */
export default eslintBaseConfig({
  tsconfigRootDir: import.meta.dirname,
  configs: [
    eslintVitestConfig,
    {
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: ['config/*.{ts,json}', '*.config.{cjs,mjs,ts,json}'],
            defaultProject: 'tsconfig.json',
          },
          tsconfigRootDir: import.meta.dirname,
        },
      },
    },
  ],
})
