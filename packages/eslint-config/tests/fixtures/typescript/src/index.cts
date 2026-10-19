async function load(): Promise<number> {
  await Promise.resolve()
  return 1
}

function run(): void {
  load()
}

function sum(values: Array<number>): number {
  let total = 0
  values.forEach((value) => {
    total += value
  })
  return total
}

export = { load, run, sum }
