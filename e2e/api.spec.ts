import { test, expect } from '@playwright/test';

test.describe('API Health', () => {
  const API_BASE = process.env.API_URL || 'http://localhost:4000';

  test('health endpoint should return OK', async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThan(0);
  });

  test('calendar endpoint should return events', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/calendar`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.events).toBeDefined();
    expect(Array.isArray(body.events)).toBeTruthy();
  });

  test('exchanges endpoint should return array', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/exchanges`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('plugins endpoint should return plugins list', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/plugins`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.plugins).toBeDefined();
    expect(Array.isArray(body.plugins)).toBeTruthy();
  });
});
