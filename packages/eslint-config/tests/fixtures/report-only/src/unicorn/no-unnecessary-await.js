// Without the `await`, the function's promise settles a microtask sooner, ahead of callbacks it
// ran behind
export async function settle() {
  return await 0
}
