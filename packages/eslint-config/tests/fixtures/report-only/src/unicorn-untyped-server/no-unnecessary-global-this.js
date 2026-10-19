// Without `globalThis.`, a global that's missing at run time, as in a worker or on the server, throws
export const storage = globalThis.localStorage
