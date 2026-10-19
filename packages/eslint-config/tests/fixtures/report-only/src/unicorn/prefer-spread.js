// Spreading a typed array gives an array, whose `sort` compares text
export function sorted(samples) {
  const copy = samples.slice()
  copy.sort()
  return copy
}
