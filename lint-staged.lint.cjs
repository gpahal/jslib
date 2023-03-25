module.exports = {
  "**/*.{js,mjs,cjs,ts}": [
    "prettier --check --plugin-search-dir=. --ignore-path=.gitignore",
    "eslint",
  ],
  "**/*.{ts}": ["tsc-files --noEmit"],
  "**/*.{json}": ["prettier --check --plugin-search-dir=. --ignore-path=.gitignore"],
  "**/*.css": ["prettier --check --plugin-search-dir=. --ignore-path=.gitignore", "stylelint"],
};
