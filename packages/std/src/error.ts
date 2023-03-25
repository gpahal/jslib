export { CustomError } from "ts-custom-error";

function hasMessage(error: unknown): error is { message: unknown } {
  return error != null && typeof error === "object" && "message" in error;
}

function hasMessageString(error: unknown): error is { message: string } {
  return hasMessage(error) && typeof error.message === "string";
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error || hasMessageString(error) ? error.message : "Unknown error";
}
