/**
 * Shard E2E – full user flows.
 *
 * Tests are stateful and run in order (workers=1 enforced in playwright.config.ts).
 * State created in earlier tests (folder, uploaded file) is reused by later tests.
 */

import { test, expect, Browser, Page } from '@playwright/test';
import fs from 'fs';

// ── Shared state (populated across tests) ─────────────────────────────────────
let token = '';
let folderId = '';
let uploadedFileId = '';
let publicSlug = '';

// ── Auth helper ───────────────────────────────────────────────────────────────
/**
 * Inject the shared auth cookie into the page's context.
 * Uses the token fetched once in beforeAll.
 *
 * Call BEFORE page.goto() so the cookie is sent with the first navigation.
 */
async function injectAuthCookie(page: Page): Promise<void> {
  if (!token) {
    throw new Error('token not set — beforeAll must have failed');
  }
  await page.context().addCookies([
    {
      name: 'shard_token',
      value: token,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

// ── Suite ──────────────────────────────────────────────────────────────────────
test.describe('Shard E2E flows', () => {
  // Login once before all tests and store token for cookie injection
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    const resp = await pg.request.post('http://localhost:4001/api/e2e/login', {
      data: { email: 'e2e@shard.test', displayName: 'E2E User' },
    });
    const body = await resp.json();
    token = body.token;
    if (!token) {
      throw new Error(`E2E beforeAll: login failed — response body: ${JSON.stringify(body)}`);
    }
    await ctx.close();
  });

  // ── Test 1: Unauthenticated redirect to /login ──────────────────────────────
  test('1: unauthenticated redirect to /login', async ({ browser }) => {
    // Open a fresh context without any cookies
    const freshCtx = await browser.newContext();
    const page = await freshCtx.newPage();
    try {
      await page.goto('/');
      await page.waitForURL('**/login');
      await expect(page.locator('[data-testid="login-google"]')).toBeVisible();
    } finally {
      await freshCtx.close();
    }
  });

  // ── Test 2: Authenticate and access Drive ───────────────────────────────────
  test('2: authenticate and access Drive', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto('/');
    // The sidebar <aside> has aria-label="Main navigation" (implicit role=complementary)
    await expect(page.locator('aside[aria-label="Main navigation"]')).toBeVisible();
    await expect(page.getByRole('toolbar')).toBeVisible();
  });

  // ── Test 3: Create a folder ─────────────────────────────────────────────────
  test('3: create a folder', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto('/');

    // Wait for the drive to fully load (toolbar is visible)
    await expect(page.getByRole('button', { name: 'New folder' })).toBeVisible();

    // Register dialog handler BEFORE clicking "New folder"
    page.on('dialog', (dialog) => dialog.accept('E2E Test Folder'));

    await page.getByRole('button', { name: 'New folder' }).click();

    // Wait for folder card to appear
    const folderCard = page.locator('[data-testid^="file-card-"]').filter({ hasText: 'E2E Test Folder' });
    await expect(folderCard).toBeVisible();

    // Extract folder ID for later tests
    const testId = await folderCard.getAttribute('data-testid');
    folderId = testId!.replace('file-card-', '');
    expect(folderId).toBeTruthy();
  });

  // ── Test 4: Upload a file ───────────────────────────────────────────────────
  test('4: upload a file', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto('/');

    // Wait for the drive toolbar to be visible
    await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible();

    // Create temp file
    fs.writeFileSync('/tmp/shard-e2e-upload.txt', 'Hello Shard E2E');

    // Set files on hidden input (bypasses the click-to-open-file-dialog flow)
    await page.locator('[data-testid="file-upload-input"]').setInputFiles('/tmp/shard-e2e-upload.txt');

    // Wait for the file card to appear
    const fileCard = page.locator('[data-testid^="file-card-"]').filter({ hasText: 'shard-e2e-upload.txt' });
    await expect(fileCard).toBeVisible();

    // Extract file ID for later tests
    const testId = await fileCard.getAttribute('data-testid');
    uploadedFileId = testId!.replace('file-card-', '');
    expect(uploadedFileId).toBeTruthy();
  });

  // ── Test 5: Move file into folder ───────────────────────────────────────────
  test('5: move file into folder', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto('/');

    // Right-click the file card
    const fileCard = page.locator(`[data-testid="file-card-${uploadedFileId}"]`);
    await expect(fileCard).toBeVisible();
    await fileCard.click({ button: 'right' });

    // Click Move in context menu
    await page.locator('[data-testid="ctx-move"]').click();

    // Wait for the move dialog
    await expect(page.locator('[data-testid="move-dialog"]')).toBeVisible();

    // Click the "E2E Test Folder" item in the folder list
    await page.getByRole('option', { name: 'E2E Test Folder' }).click();

    // Click "Move here" button (data-testid="move-confirm")
    await page.locator('[data-testid="move-confirm"]').click();

    // File should disappear from root listing
    await expect(page.locator(`[data-testid="file-card-${uploadedFileId}"]`)).not.toBeVisible();

    // Navigate into the folder
    await page.goto(`/folder/${folderId}`);

    // File should be there
    const fileInFolder = page.locator(`[data-testid="file-card-${uploadedFileId}"]`);
    await expect(fileInFolder).toBeVisible();
  });

  // ── Test 6: Public link + unauthenticated access ────────────────────────────
  test('6: public link and unauthenticated access', async ({ page, browser }) => {
    await injectAuthCookie(page);
    await page.goto(`/folder/${folderId}`);

    // Right-click the file
    const fileCard = page.locator(`[data-testid="file-card-${uploadedFileId}"]`);
    await expect(fileCard).toBeVisible();
    await fileCard.click({ button: 'right' });

    // Click "Get public link"
    await page.locator('[data-testid="ctx-public-link"]').click();

    // Wait for publink dialog
    await expect(page.locator('[data-testid="publink-dialog"]')).toBeVisible();

    // Click "Create link"
    await page.getByRole('button', { name: 'Create link' }).click();

    // Wait for the URL to appear in the list
    const publinkUrl = page.locator('.publink-url').first();
    await expect(publinkUrl).toBeVisible();

    // Extract slug from URL text
    const urlText = await publinkUrl.textContent();
    expect(urlText).toBeTruthy();
    const slugMatch = urlText!.match(/\/p\/([^/\s]+)/);
    expect(slugMatch).toBeTruthy();
    publicSlug = slugMatch![1];
    expect(publicSlug).toBeTruthy();

    // Close the dialog
    await page.keyboard.press('Escape');

    // Open a guest browser context (no cookies)
    const guestCtx = await browser.newContext();
    const guestPage = await guestCtx.newPage();
    try {
      await guestPage.goto(`/p/${publicSlug}`);
      await expect(guestPage.locator('[data-testid="pubfile-card"]')).toBeVisible();
      await expect(guestPage.locator('[data-testid="pubfile-name"]')).toContainText('shard-e2e-upload.txt');
    } finally {
      await guestCtx.close();
    }
  });

  // ── Test 7: Delete to trash and restore ─────────────────────────────────────
  test('7: delete to trash and restore', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto(`/folder/${folderId}`);

    // Right-click the file
    const fileCard = page.locator(`[data-testid="file-card-${uploadedFileId}"]`);
    await expect(fileCard).toBeVisible();
    await fileCard.click({ button: 'right' });

    // Click "Move to trash"
    await page.locator('[data-testid="ctx-delete"]').click();

    // Navigate to Trash via sidebar button
    await page.locator('[data-testid="nav-trash"]').click();
    await page.waitForURL('**/trash');

    // Wait for the file to appear in trash
    const restoreBtn = page.getByRole('button', { name: 'Restore shard-e2e-upload.txt' });
    await expect(restoreBtn).toBeVisible();

    // Restore the file
    await restoreBtn.click();

    // File should be gone from trash
    await expect(restoreBtn).not.toBeVisible();

    // Navigate back to the folder to verify file is restored
    await page.goto(`/folder/${folderId}`);
    await expect(page.locator(`[data-testid="file-card-${uploadedFileId}"]`)).toBeVisible();
  });

  // ── Test 8: Dashboard storage usage renders ──────────────────────────────────
  test('8: dashboard storage usage renders', async ({ page }) => {
    await injectAuthCookie(page);
    await page.goto('/');

    // Wait for drive to load, then click the Dashboard nav button
    await expect(page.locator('[data-testid="nav-dashboard"]')).toBeVisible();
    await page.locator('[data-testid="nav-dashboard"]').click();
    await page.waitForURL('**/dashboard');

    // Assert "Storage" heading is visible
    await expect(page.getByRole('heading', { name: /Storage/i })).toBeVisible();

    // The dashboard-summary section shows total storage (e.g., "15.0 B / 512.0 MB")
    // It is always present once the dashboard has loaded past the initial loading state.
    // Use .first() to handle cases where the selector matches multiple elements.
    await expect(page.locator('.dashboard-summary').first()).toBeVisible();
  });
});
