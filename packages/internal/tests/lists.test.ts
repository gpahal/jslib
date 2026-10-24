import { formatSomeNames, joinList } from '@/lists'

describe('joinList', () => {
  it.each([
    [[], 'and', ''],
    [['a'], 'or', 'a'],
    [['a', 'b'], 'and', 'a and b'],
    [['a', 'b', 'c'], 'or', 'a, b or c'],
  ] as const)('joins %j with %s', (items, conjunction, joined) => {
    expect(joinList(items, conjunction)).toBe(joined)
  })
})

describe('formatSomeNames', () => {
  it.each([
    [['a'], 3, '`a`'],
    [['a', 'b', 'c'], 3, '`a`, `b` and `c`'],
    [['a', 'b', 'c', 'd', 'e'], 3, '`a`, `b`, `c` and 2 more'],
  ])('formats %j with at most %i names', (names, max, formatted) => {
    expect(formatSomeNames(names, max)).toBe(formatted)
  })
})
