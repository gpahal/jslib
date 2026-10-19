export function logFlag(isOn: boolean, log: (message: string) => void): void {
  if (isOn || false) {
    log('on')
  }
}
