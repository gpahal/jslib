/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

import eslintPluginReact from '@eslint-react/eslint-plugin'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginJsxA11y from 'eslint-plugin-jsx-a11y'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { config, type ConfigWithExtends } from 'typescript-eslint'

import type { Config } from './base'

export default config(
  {
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    ...eslintPluginReact.configs.recommended,
  },
  {
    files: ['**/*.{ts,tsx,astro}'],
    ...eslintPluginReact.configs['recommended-type-checked'],
  },
  {
    plugins: {
      'react-hooks': eslintPluginReactHooks,
    },

    rules: eslintPluginReactHooks.configs.recommended.rules,
  } as ConfigWithExtends,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
  eslintPluginJsxA11y.flatConfigs.recommended,
  {
    rules: {
      'react/no-unknown-property': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-no-target-blank': 'off',
      'jsx-a11y/alt-text': [
        'error',
        {
          elements: ['img'],
          img: ['Image'],
        },
      ],
      'jsx-a11y/aria-props': 'warn',
      'jsx-a11y/aria-proptypes': 'warn',
      'jsx-a11y/aria-unsupported-elements': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/role-supports-aria-props': 'warn',
    },
  },
) as Config
