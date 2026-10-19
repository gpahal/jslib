// `HttpError` is a factory, not a class
const HttpError = (status, message) => Object.assign(new Error(message), { status })

export function fail() {
  throw HttpError(404, 'missing')
}
