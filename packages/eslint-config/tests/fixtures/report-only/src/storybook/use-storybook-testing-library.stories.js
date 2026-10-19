// `storybook/test` instruments its functions for the interactions panel, and the fix changes the
// package that loads
import { userEvent } from '@testing-library/user-event'

export default { title: 'Form' }

export const Filled = {
  play: async ({ canvasElement }) => {
    await userEvent.type(canvasElement.querySelector('input'), 'a')
  },
}
