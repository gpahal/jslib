// `Response.json` sets `application/json`, and throws for `undefined`
export function respond(data) {
  return new Response(JSON.stringify(data), { status: 200 })
}
