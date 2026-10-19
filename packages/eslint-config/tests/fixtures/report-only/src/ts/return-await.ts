// `return read()` settles the function's promise a tick later than `return await read()`, so code
// that waits on it and on another promise sees them settle in a different order
export async function load(read: () => Promise<string>): Promise<string> {
  return await read()
}
