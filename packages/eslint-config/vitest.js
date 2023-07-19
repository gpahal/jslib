/** @type {import("eslint").Linter.Config} */
const config = {
  extends: ['plugin:vitest-globals/recommended'],
  overrides: [
    {
      files: ['**/*.test.{js,mjs,cjs,jsx,ts,tsx}'],
      env: {
        'vitest-globals/env': true,
      },
    },
  ],
}

module.exports = config
