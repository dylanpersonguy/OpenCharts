import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should load and display the chart interface', async ({ page }) => {
    await page.goto('/');

    // Title should contain the default symbol
    await expect(page).toHaveTitle(/OpenCharts/);

    // Top toolbar should be visible
    await expect(page.locator('text=BTC/USD').first()).toBeVisible();

    // Timeframe buttons should be visible
    await expect(page.locator('text=1m').first()).toBeVisible();
    await expect(page.locator('text=1H').first()).toBeVisible();

    // Chart container should be rendered
    const chartArea = page.locator('.flex-1.min-w-0.relative');
    await expect(chartArea).toBeVisible();
  });

  test('should toggle watchlist panel', async ({ page }) => {
    await page.goto('/');

    // Watchlist visible by default
    const watchlistToggle = page.locator('button[title="Watchlist"]');
    await expect(watchlistToggle).toBeVisible();

    // Click to toggle off
    await watchlistToggle.click();
    // Click again to toggle on
    await watchlistToggle.click();
  });

  test('should switch timeframes', async ({ page }) => {
    await page.goto('/');

    // Click "D" timeframe
    const dayBtn = page.locator('button:has-text("D")').first();
    await dayBtn.click();

    // Should highlight the D button (it gets text-tv-blue class)
    await expect(dayBtn).toHaveClass(/text-tv-blue/);
  });

  test('should open indicator dropdown', async ({ page }) => {
    await page.goto('/');

    const indicatorBtn = page.locator('button:has-text("Indicators")');
    await indicatorBtn.click();

    // Should show the indicator dropdown with "Add Indicator"
    await expect(page.locator('text=Add Indicator')).toBeVisible();
  });
});
