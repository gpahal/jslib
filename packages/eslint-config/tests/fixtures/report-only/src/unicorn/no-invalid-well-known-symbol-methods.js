// The fix renames the method to `Symbol.asyncDispose`, so `using` and callers of `Symbol.dispose` throw
export class Resource {
  async [Symbol.dispose]() {
    await Promise.resolve()
  }
}
