// `Object.groupBy` returns an object without a prototype, so `groups.hasOwnProperty` throws
export function groupByType(items) {
  return items.reduce((groups, item) => {
    groups[item.type] ??= []
    groups[item.type].push(item)
    return groups
  }, {})
}
