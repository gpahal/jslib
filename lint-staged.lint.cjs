module.exports = {
  "**/*.{js,mjs,cjs,ts}": ["eslint --fix"],
  "**/*.{ts}": ["tsc-files --noEmit"],
  "**/*.css": ["stylelint --fix"],
};
