// Removing `await` removes a microtask, so code queued before it runs later
import { test } from '@playwright/test'

test('finds the heading', async ({ page }) => {
  const heading = await page.locator('h1')
  await heading.click()
})
