import eslintPluginReact from '@eslint-react/eslint-plugin'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginJsxA11y from 'eslint-plugin-jsx-a11y'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import globals from 'globals'

export const FILES_WITHOUT_TYPES = ['**/*.{js,mjs,cjs,jsx}']
export const FILES_WITH_TYPES = ['**/*.{ts,tsx}']
export const FILES = [...FILES_WITHOUT_TYPES, ...FILES_WITH_TYPES]

const reactConfig = defineConfig(
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
    files: FILES_WITHOUT_TYPES,
    ...eslintPluginReact.configs.recommended,
  },
  {
    files: FILES_WITH_TYPES,
    ...eslintPluginReact.configs['recommended-type-checked'],
  },
  {
    files: FILES,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    extends: [eslintPluginJsxA11y.flatConfigs.recommended],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
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
)

export default reactConfig
