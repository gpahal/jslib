import type { B } from './b'

type C = { c: string }

interface A<T> extends B<T>, C {}

export const a: A<number> = { b: 1, c: '' }
