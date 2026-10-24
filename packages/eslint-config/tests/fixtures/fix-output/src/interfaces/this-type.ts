interface Chain {
  next(): this
}

export const chain: Chain = {
  next() {
    return this
  },
}
