// indexing a string visits its UTF-16 code units, and `for…of` its code points
/* eslint unicorn/no-for-loop: "error" */
export function each(text, callback) {
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    callback(char)
  }
}
