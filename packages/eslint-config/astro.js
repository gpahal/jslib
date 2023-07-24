/** @type {import("eslint").Linter.Config} */
const config = {
  extends: ['plugin:astro/recommended', 'plugin:astro/jsx-a11y-strict'],
  overrides: [
    {
      files: ['*.astro'],
      parser: 'astro-eslint-parser',
      parserOptions: {
        parser: '@typescript-eslint/parser',
        extraFileExtensions: ['.astro'],
      },
      rules: {
        'react/jsx-key': 'off',
        'react/react-in-jsx-scope': 'off',
      },
    },
  ],
}

module.exports = config
