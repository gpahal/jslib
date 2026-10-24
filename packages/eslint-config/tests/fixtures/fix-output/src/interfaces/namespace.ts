export namespace A {
  export interface X {
    a: string
  }
}
export namespace A {
  export interface X {
    b: number
  }
}
export const x: A.X = { a: 'a', b: 1 }
