// A test that calls the listener with `{ keyCode: 27 }` passes no `key`
export function listen(target, close) {
  target.addEventListener('keydown', (event) => {
    if (event.keyCode === 27) {
      close()
    }
  })
}
