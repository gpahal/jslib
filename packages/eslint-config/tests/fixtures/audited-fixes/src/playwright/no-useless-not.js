import { expect, test } from '@playwright/test'

test('hides the heading', async ({ page }) => {
  await expect(page.locator('h1')).not.toBeVisible()
  await expect(page.locator('button')).toBeEnabled({ enabled: false, timeout: 1000 })
})
