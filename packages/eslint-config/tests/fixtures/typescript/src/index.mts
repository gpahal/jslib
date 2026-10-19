export async function load(): Promise<number> {
  await Promise.resolve()
  return 1
}

export function run(): void {
  load()
}

export function sum(values: Array<number>): number {
  let total = 0
  values.forEach((value) => {
    total += value
  })
  return total
}
