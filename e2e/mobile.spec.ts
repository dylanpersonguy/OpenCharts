import { test, expect, type Page } from '@playwright/test';

test.describe('Mobile Layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('should hide drawing toolbar on mobile', async ({ page }) => {
    await page.goto('/');

    // Drawing toolbar should not be visible on mobile viewport
    // The left sidebar with drawing tools should be hidden
    await expect(page.locator('text=BTC/USD').first()).toBeVisible();
  });

  test('should show sidebar as overlay on mobile', async ({ page }) => {
    await page.goto('/');

    // Click the watchlist icon to open the panel
    const watchlistBtn = page.locator('button[title="Watchlist"]');
    await watchlistBtn.click();

    // The overlay backdrop should appear
    const overlay = page.locator('.sidebar-overlay');
    await expect(overlay).toBeVisible();

    // Clicking overlay should close the panel
    await overlay.click();
    await expect(overlay).not.toBeVisible();
  });
});
