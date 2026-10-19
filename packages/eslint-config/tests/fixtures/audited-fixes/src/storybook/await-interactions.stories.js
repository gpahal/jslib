import { expect, userEvent, within } from '@storybook/test'

export default { title: 'Button' }
export const Hovered = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button')
    userEvent.hover(button)
    await expect(button).toBeVisible()
  },
}
