/**
 * `stylelint-plugin-use-baseline` ships no types. Its default export is the plugin
 */
declare module 'stylelint-plugin-use-baseline' {
  import type { Plugin } from 'stylelint'

  const plugin: Plugin
  export default plugin
}
