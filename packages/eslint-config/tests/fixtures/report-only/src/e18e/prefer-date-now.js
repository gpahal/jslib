// The fix calls `now` on the parameter, which has none
export function elapsed(Date, start) {
  return new Date().getTime() - start
}
