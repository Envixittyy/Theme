import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility gate.
 *
 * Runs axe against every primary screen at the WCAG 2.x A/AA rule sets and
 * fails on any violation, with the offending selectors printed so a regression
 * is actionable rather than just red.
 */
const SCREENS: Array<{ path: string; name: string }> = [
  { path: '/today', name: 'Today' },
  { path: '/tasks?list=upcoming', name: 'Tasks' },
  { path: '/calendar?view=month', name: 'Calendar (month)' },
  { path: '/calendar?view=timetable', name: 'Calendar (timetable)' },
  { path: '/courses', name: 'Courses' },
  { path: '/announcements', name: 'Announcements' },
  { path: '/notes', name: 'Notes' },
  { path: '/notifications', name: 'Notifications' },
  { path: '/settings', name: 'Settings' },
  { path: '/settings/notifications', name: 'Settings — notifications' },
  { path: '/settings/integrations', name: 'Settings — integrations' },
  { path: '/settings/sync', name: 'Settings — sync' },
];

test.describe('accessibility', () => {
  for (const screen of SCREENS) {
    test(`${screen.name} has no violations`, async ({ page }) => {
      await page.goto(screen.path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(describe(results.violations)).toEqual([]);
    });
  }

  test('the dark theme keeps its contrast', async ({ page }) => {
    await page.goto('/today');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.goto('/today');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(300);

    const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
    expect(describe(results.violations)).toEqual([]);
  });

  test('the interface is reachable by keyboard alone', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard navigation is a desktop concern');
    await page.goto('/today');

    // The skip link is the first stop.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip to main content/i })).toBeFocused();

    // The command palette opens and closes from the keyboard.
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: /search and commands/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /search and commands/i })).toBeHidden();

    // "g then c" jumps to the calendar.
    await page.keyboard.press('g');
    await page.keyboard.press('c');
    await page.waitForURL(/\/calendar/);
  });
});

type Violation = { id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> };

/** Compact, readable failure output instead of a wall of axe JSON. */
function describe(violations: Violation[]): string[] {
  return violations.map(
    (v) => `${v.id} (${v.impact ?? 'unknown'}): ${v.nodes.slice(0, 3).map((n) => String(n.target)).join(', ')}`,
  );
}
