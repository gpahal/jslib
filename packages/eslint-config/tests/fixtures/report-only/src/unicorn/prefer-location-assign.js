// A test's stub `location` has `href` but no `assign`, and `assign` throws a `SyntaxError` rather
// than a `TypeError` for an invalid URL
export function go(url) {
  location.href = url
}
