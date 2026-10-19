export class AppError extends Error {
  constructor(message) {
    super(message)
    Error.captureStackTrace(this, AppError)
  }
}
