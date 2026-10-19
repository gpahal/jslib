// In the page, `name` is `window.name`. The fix passes the test's `name` instead
import { test } from '@playwright/test'

test('reads the window name', async ({ page }) => {
  const name = 'test'
  await page.evaluate(() => name)
})
