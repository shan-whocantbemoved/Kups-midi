// @ts-check
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.reject(new DOMException('Test MIDI permission denied', 'NotAllowedError')),
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Set the room. Find the moment.' })).toBeVisible();
});

test('creates a set, adds a preset patch and layers, snapshots a scene, then reloads persisted data', async ({ page }) => {
  await page.getByRole('button', { name: /New setlist/ }).click();
  await page.locator('#set-name-input').fill('Playwright Set');
  await page.getByRole('button', { name: 'Create setlist' }).click();

  await page.getByRole('button', { name: '+ Add patch' }).click();
  await page.locator('#patch-name').fill('Test Piano');
  await page.locator('#patch-key').selectOption('F');
  await page.locator('#patch-bpm').fill('96');
  await page.getByRole('button', { name: 'Add patch', exact: true }).click();

  await page.locator('#detail-add-layer').click();
  await page.locator('#layer-name').fill('Warm pad');
  await page.locator('#layer-type').selectOption('pad');
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await expect(page.locator('#detail-layers')).toContainText('Warm pad');

  await page.locator('#detail-add-scene').click();
  await page.locator('#scene-name').fill('Opening');
  await page.getByRole('button', { name: 'Save scene' }).click();
  await expect(page.locator('#scene-list')).toContainText('Opening');
  await page.locator('#detail-save').click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Set the room. Find the moment.' })).toBeVisible();
  await page.locator('.recent-card').filter({ hasText: 'Playwright Set' }).click();
  await expect(page.getByRole('heading', { name: 'Test Piano' })).toBeVisible();
  await expect(page.locator('#song-bpm')).toHaveText('96');
  await expect(page.locator('#detail-layers')).toContainText('Warm pad');
  await expect(page.locator('#scene-list')).toContainText('Opening');
});

test('installs a content pack and imports one of its patch presets', async ({ page }) => {
  await page.getByRole('button', { name: /Content packs/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Night Room')).toBeVisible();
  await dialog.getByRole('button', { name: 'Install' }).first().click();
  await expect(page.getByText('Night Room installed')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: /New setlist/ }).click();
  await page.locator('#set-name-input').fill('Preset Import Set');
  await page.getByRole('button', { name: 'Create setlist' }).click();
  await page.getByRole('button', { name: '+ Add patch' }).click();
  await page.locator('#patch-name').fill('Afterglow Piano');
  await page.locator('#preset-import').selectOption({ label: 'Afterglow Piano · Night Room' });
  await page.getByRole('button', { name: 'Add patch', exact: true }).click();
  await expect(page.locator('#detail-layers')).toContainText('Felt piano');
  await expect(page.locator('#detail-layers')).toContainText('Tape haze');
  await expect(page.locator('#song-bpm')).toHaveText('78');
});

test('shows no-MIDI fallback and keeps the dashboard within a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'MIDI devices' }).click();
  await expect(page.locator('#device-popover')).toContainText('No devices connected.');

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
});

test('serves an installable standalone landscape manifest and registers a service worker', async ({ page }) => {
  const manifest = await page.request.get('/manifest.webmanifest').then(response => response.json());
  expect(manifest.display).toBe('standalone');
  expect(manifest.orientation).toBe('landscape');
  expect(manifest.theme_color).toBe('#8bdcff');

  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistrations().then(items => items.length))).toBeGreaterThan(0);
});