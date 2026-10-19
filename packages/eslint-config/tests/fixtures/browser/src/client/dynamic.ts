export async function loadFs() {
  const fs = await import('node:fs')
  return fs.readFileSync
}

export async function loadOs() {
  const os = await import('os')
  return os.EOL
}

export async function loadPromises() {
  const fsPromises = await import(`fs/promises`)
  return fsPromises.readFile
}

export async function loadLocal() {
  const app = await import('./app')
  return app.mode
}
