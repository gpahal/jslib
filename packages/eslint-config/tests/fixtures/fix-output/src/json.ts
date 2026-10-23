/**
 * A JSON value
 */
export type Json = string | number | boolean | null | Array<Json> | JsonObject

/**
 * A JSON object with a kind. As a type alias, it would refer to itself through `Record` (TS2456)
 */
export interface JsonObject extends Record<string, Json> {
  kind: string
}
