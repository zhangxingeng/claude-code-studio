import { test, expect } from '@playwright/test';

/**
 * Issue #14 — delete-only editing UI. Drives the real app (browser-dev mock
 * layer in src/lib/api.ts serves the mock session) to confirm the read-only
 * thinking/tool rendering, per-block/turn soft delete, and bulk multi-select
 * actually wire up end-to-end — not just the unit-tested data model.
 */
test.describe('Delete-only editing (#14)', () => {
  test('tool activity renders as a collapsed read-only group', async ({ page }) => {
    await page.goto('/');
    await page.locator('.session-card__open').click();
    await expect(page.locator('h2.viewer-title')).toBeVisible();

    // The run of tool calls/results/thinking between chat turns collapses into
    // a ToolGroup strip with an informative summary (e.g. "… tool call…").
    const group = page.locator('.tool-group').first();
    await expect(group).toBeVisible();
    await expect(group.locator('.tool-group__summary').first()).toContainText('tool call');
  });

  test('turn-level delete marks the session dirty and is reversible', async ({ page }) => {
    await page.goto('/');
    await page.locator('.session-card__open').click();
    await expect(page.locator('h2.viewer-title')).toBeVisible();

    // No unsaved changes initially.
    await expect(page.locator('.editor-dirty')).toHaveCount(0);

    // Delete the first turn via its divider affordance.
    const firstDivider = page.locator('.turn-divider').first();
    await firstDivider.hover();
    await firstDivider.getByRole('button', { name: 'Delete turn' }).click();

    // Dirty indicator now shows a change count, and the divider flips to Restore.
    await expect(page.locator('.editor-dirty')).toBeVisible();
    await expect(page.locator('.editor-dirty')).toContainText('unsaved');
    await expect(firstDivider.getByRole('button', { name: 'Restore turn' })).toBeVisible();

    // Restore brings it back to a clean (no unsaved changes) state.
    await firstDivider.getByRole('button', { name: 'Restore turn' }).click();
    await expect(page.locator('.editor-dirty')).toHaveCount(0);
  });

  test('bulk select mode deletes selected units', async ({ page }) => {
    await page.goto('/');
    await page.locator('.session-card__open').click();
    await expect(page.locator('h2.viewer-title')).toBeVisible();

    // Enter select mode — checkboxes appear on units.
    await page.getByRole('button', { name: '☑ Select' }).click();
    const firstCheckbox = page.locator('.msg-select input[type="checkbox"]').first();
    await expect(firstCheckbox).toBeVisible();

    // Select two message bubbles; the action button reflects the count.
    await firstCheckbox.check();
    await page.locator('.msg-select input[type="checkbox"]').nth(1).check();
    const deleteBtn = page.getByRole('button', { name: /Delete selected \(2\)/ });
    await expect(deleteBtn).toBeEnabled();

    // Delete them — the session goes dirty (soft delete, no confirm modal).
    await deleteBtn.click();
    await expect(page.locator('.editor-dirty')).toBeVisible();
  });
});
