interface Json extends Record<string, Json | string> {
  x: string
}

export const json: Json = { x: 'a' }
