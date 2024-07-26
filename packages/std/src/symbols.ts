export default function isSymbol(value: unknown): value is symbol {
  const t = typeof value
  return t === 'symbol' || (t != null && t === 'object' && Object.prototype.toString.call(value) == '[object Symbol]')
}
