/** @type {import("stylelint").Config} */
const config = {
  extends: ['stylelint-config-standard'],
  rules: {
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'tailwind',
          'layer',
          'config',
          'plugin',
          'import',
          'theme',
          'source',
          'utility',
          'variant',
          'custom-variant',
          'apply',
          'reference',
        ],
      },
    ],
    'at-rule-no-deprecated': [
      true,
      {
        ignoreAtRules: [
          'tailwind',
          'layer',
          'config',
          'plugin',
          'import',
          'theme',
          'source',
          'utility',
          'variant',
          'custom-variant',
          'apply',
          'reference',
        ],
      },
    ],
    'function-no-unknown': [
      true,
      {
        ignoreFunctions: ['theme'],
      },
    ],
    'font-family-name-quotes': 'always-unless-keyword',
    'number-max-precision': 6,
    'comment-empty-line-before': null,
  },
}

module.exports = config
