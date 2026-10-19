export function listen(element) {
  element.addEventListener('wheel', () => {
    console.log('wheel')
  })
}
