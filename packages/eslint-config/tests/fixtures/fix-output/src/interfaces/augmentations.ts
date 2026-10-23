import { registry, type Register } from './registry'

export const all: Register = { ...registry, b: '', c: true }

declare module './registry' {
  interface Register {
    b: string
  }
}

declare module './registry' {
  interface Register {
    c: boolean
  }
}

interface Local {
  d: number
}

export const local: Local = { d: 1 }
