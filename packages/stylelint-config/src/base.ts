import { type Config } from 'stylelint'

const config: Config = {
  extends: ['stylelint-config-standard'],
  rules: {
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: ['tailwind', 'apply', 'layer', 'config'],
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

export default config
