module.exports = {
  "**/*.{js,mjs,cjs,ts}": [
    "prettier --write --plugin-search-dir=. --ignore-path=.gitignore",
    "eslint --fix",
  ],
  "**/*.{ts}": ["tsc-files --noEmit"],
  "**/*.{json}": ["prettier --write --plugin-search-dir=. --ignore-path=.gitignore"],
  "./styles/**/*.css": [
    "prettier --write --plugin-search-dir=. --ignore-path=.gitignore",
    "stylelint --fix",
  ],
};
