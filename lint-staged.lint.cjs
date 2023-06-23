module.exports = {
  "**/*.{js,mjs,cjs,ts}": ["eslint --fix --ignore-path=.gitignore"],
  "**/*.{ts}": ["tsc-files --noEmit"],
  "**/*.css": ["stylelint --fix --ignore-path=.gitignore"],
};
