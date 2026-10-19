// Static methods become enumerable properties, so `Object.keys(Limits)` lists `double` too
/* eslint unicorn/no-static-only-class: "error" */
export class Limits {
  static max = 10

  static double() {
    return Limits.max * 2
  }
}
