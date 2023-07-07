module.exports = {
  '**/*.{js,mjs,cjs,jsx,ts,tsx}': ['eslint --ignore-path=.gitignore'],
  '**/*.{ts,tsx}': ['tsc-files --noEmit'],
  '**/*.css': ['stylelint --ignore-path=.gitignore'],
}
