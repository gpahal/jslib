// `toBeVisible` waits until the banner shows, where the test checks that it shows at once
import { expect, test } from '@playwright/test'

test('shows the banner at once', async ({ page }) => {
  expect(await page.locator('.banner').isVisible()).toBe(true)
})
