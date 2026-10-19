export function describe(count: number, isOn: boolean): string {
  return `${count} items, ${isOn ? 'on' : 'off'} ${isOn}`
}
