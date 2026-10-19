// The override drops the arguments after `data`, which the parent's `options` would get
class Base {
  save(data, options = {}) {
    return [data, options]
  }
}

export class Child extends Base {
  save(data) {
    return super.save(data)
  }
}
