/**
 * Stands in for the React types, so JSX has a type
 */
declare namespace JSX {
  type Element = { type: unknown }
  type IntrinsicElements = Record<string, unknown>
}
