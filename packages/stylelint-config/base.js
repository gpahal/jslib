/**
@type {import("stylelint").Config}
*/
const config = {
  extends: ['stylelint-config-standard'],
  rules: {
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'config',
          'plugin',
          'theme',
          'source',
          'utility',
          'variant',
          'custom-variant',
          'reference',
        ],
      },
    ],
    'function-no-unknown': true,
    'font-family-name-quotes': 'always-unless-keyword',
    'number-max-precision': 6,
    'comment-empty-line-before': null,
    'nesting-selector-no-missing-scoping-root': null,
    'import-notation': 'string',
  },
}

module.exports = config
