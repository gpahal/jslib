// Renaming the test orphans its snapshots, whose file names come from its title
import { expect, test } from '@playwright/test'

test(' matches the screenshot ', async ({ page }) => {
  await expect(page).toHaveScreenshot()
})
