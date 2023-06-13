module.exports = {
  "**/*.{js,mjs,cjs,ts}": ["prettier --write --ignore-path=.gitignore"],
  "**/*.{json}": ["prettier --write --ignore-path=.gitignore"],
  "./styles/**/*.css": ["prettier --write --ignore-path=.gitignore"],
};
