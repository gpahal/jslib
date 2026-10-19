// any `length` counts as a number, but an object's, such as parsed JSON's, can be a string
export function minutes(movie) {
  return Number(movie.length)
}
