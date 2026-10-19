export function log() {
  const text = 'a1b2'
  const pattern = /\d/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    console.log(match[0])
  }
}
