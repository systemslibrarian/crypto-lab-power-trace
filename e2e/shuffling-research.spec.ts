import { expect, test } from '@playwright/test';

test('shuffling research preserves physical and measurement scope', async ({ page }) => {
  await page.goto('.');
  const note = page.locator('#shuffling-research-note');
  await expect(note).toBeVisible();
  for (const text of ['preprint', 'physical', 'ML-DSA-44', 'individual shuffle', 'multiple measurements', 'not a mathematical break']) {
    await expect(note).toContainText(text);
  }
  await expect(note.locator('a')).toHaveAttribute('href', 'https://eprint.iacr.org/2026/2658');
});
