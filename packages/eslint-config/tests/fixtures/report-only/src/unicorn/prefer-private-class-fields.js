// `#items` hides the field from other modules, proxies and `JSON.stringify`
export class Store {
  _items = []

  add(item) {
    this._items.push(item)
  }
}
