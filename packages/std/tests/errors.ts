import { getErrorMessage } from '@/errors'

describe('getErrorMessage', () => {
  it('should get correct error message', () => {
    const cases = [
      {
        error: new Error('test'),
        expected: 'test',
      },
      {
        error: { message: 'test' },
        expected: 'test',
      },
      {
        error: { message: 'test_message', name: 'test_name' },
        expected: 'test_message',
      },
      {
        error: 'test',
        expected: 'test',
      },
      {
        error: null,
        expected: 'null',
      },
      {
        error: undefined,
        expected: 'undefined',
      },
      {
        error: { name: 'test_name' },
        expected: 'Unknown error',
      },
      {
        error: [{ message: 'test' }],
        expected: 'Unknown error',
      },
      {
        error: () => 'test',
        expected: 'Unknown error',
      },
    ] as const

    for (const { error, expected } of cases) {
      expect(getErrorMessage(error)).toBe(expected)
    }
  })
})
