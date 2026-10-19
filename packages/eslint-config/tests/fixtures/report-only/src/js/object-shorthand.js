// A method can't be called with `new`, and a `function` can
export const factory = {
  make: function () {
    this.made = true
  },
}
