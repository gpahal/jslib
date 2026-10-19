import { within } from '@storybook/test'

export default { title: 'Button' }
export const Shown = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button')
    expect(button).toBeTruthy()
  },
}
