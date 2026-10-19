// `toHaveCount` waits until the count matches, where the test checks it once
import { expect, test } from '@playwright/test'

test('has one row at once', async ({ page }) => {
  expect(await page.locator('tr').count()).toBe(1)
})
