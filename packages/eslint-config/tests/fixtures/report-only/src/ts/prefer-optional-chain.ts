// `take()` runs twice here, and once in `take()?.value`
export function second(take: () => { value: number } | undefined): number | undefined {
  return take() && take()!.value
}
