/** @type {import("eslint").Linter.Config} */
const config = {
  plugins: ['tailwindcss'],
  settings: {
    tailwindcss: {
      config: './tailwind.config.cjs',
    },
  },
  rules: {
    'tailwindcss/enforces-negative-arbitrary-values': 'error',
    'tailwindcss/enforces-shorthand': 'error',
    'tailwindcss/no-contradicting-classname': 'error',
  },
}

module.exports = config
