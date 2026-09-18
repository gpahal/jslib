import { isFunction } from './functions'
import { isObject } from './objects'

export { CustomError } from 'ts-custom-error'

function hasMessage(error: unknown): error is { message: unknown } {
  return error != null && typeof error === 'object' && 'message' in error
}

function hasMessageString(error: unknown): error is { message: string } {
  return hasMessage(error) && typeof error.message === 'string'
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error || hasMessageString(error)) {
    return error.message
  }
  return error == null || (!isObject(error) && !isFunction(error)) ? String(error) : 'Unknown error'
}
