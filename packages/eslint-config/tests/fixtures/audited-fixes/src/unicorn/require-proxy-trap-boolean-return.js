export const proxy = new Proxy(
  {},
  {
    set() {
      return 1
    },
  },
)
