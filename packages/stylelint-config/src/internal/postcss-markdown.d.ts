/**
 * `postcss-markdown` ships no types. Its default export is a syntax, and also a function that
 * builds one from options, which map a language, such as `html` for the HTML in Markdown or a code
 * block's language, to its syntax
 */
declare module 'postcss-markdown' {
  import type { Syntax } from 'postcss'

  type Options = Record<string, Syntax | undefined>

  const syntax: Syntax & ((options?: Options) => Syntax)
  export default syntax
}
