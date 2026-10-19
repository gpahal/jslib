// The error's class and name change
export function validate(errors: Array<Error>): void {
  if (errors.length > 0) {
    throw new Error('Validation failed')
  }
}
