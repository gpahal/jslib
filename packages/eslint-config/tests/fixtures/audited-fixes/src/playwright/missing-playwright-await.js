import { expect, test } from '@playwright/test'

test('shows the heading', async ({ page }) => {
  expect(page.locator('h1')).toBeVisible()
})
