import { expect, test, type Page } from '@playwright/test';

// Live reads from the r2 testnet deployment; the viewport is set per test, so one project is enough.
test.skip(({ isMobile }) => isMobile, 'sets its own viewports; the desktop project covers every width');

async function openGuess(page: Page, width: number, height = 900) {
  await page.addInitScript(() => localStorage.setItem('the-rule:guide-seen', '1'));
  await page.setViewportSize({ width, height });
  await page.goto('/play/solo/guess');
  await expect(page.getByRole('heading', { level: 1, name: /Make your guess/i })).toBeVisible();
  await expect(page.locator('[data-atom-text]').first()).toBeVisible();
}

async function narrowestAtomText(page: Page) {
  return page.locator('[data-atom-text]').evaluateAll(els => {
    let min = Infinity;
    for (const el of els) min = Math.min(min, el.getBoundingClientRect().width);
    return { min, count: els.length };
  });
}

async function noHorizontalOverflow(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll, `page is ${scroll}px wide in a ${inner}px viewport`).toBeLessThanOrEqual(inner);
}

for (const width of [1100, 1568]) {
  test(`atom rows keep a readable text column at ${width}px (Single and AND)`, async ({ page }) => {
    await openGuess(page, width);
    const single = await narrowestAtomText(page);
    expect(single.count).toBeGreaterThan(80);
    expect(single.min).toBeGreaterThanOrEqual(160);

    await page.getByRole('radiogroup', { name: 'Rule shape' }).getByRole('radio', { name: 'AND' }).click();
    await expect(page.getByRole('group', { name: 'Second atom' })).toBeVisible();
    const both = await narrowestAtomText(page);
    expect(both.count).toBeGreaterThan(single.count);
    expect(both.min).toBeGreaterThanOrEqual(160);
  });
}

for (const width of [390, 768, 1280, 1568]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await openGuess(page, width, width < 500 ? 844 : 900);
    await noHorizontalOverflow(page);
    await page.getByRole('radiogroup', { name: 'Rule shape' }).getByRole('radio', { name: 'AND' }).click();
    await expect(page.getByRole('group', { name: 'Second atom' })).toBeVisible();
    await noHorizontalOverflow(page);
  });
}

test('the "Your guess" summary sits beside the card from 1280px and is absent below', async ({ page }) => {
  await openGuess(page, 1568);
  const summary = page.getByRole('complementary', { name: 'Your guess' });
  await expect(summary).toBeVisible();
  await expect(summary.getByText('Free check')).toBeVisible();
  await expect(summary.getByText('Committing costs')).toBeVisible();
  const card = await page.locator('h2', { hasText: 'Write your hypothesis' }).boundingBox();
  const side = await summary.boundingBox();
  expect(side!.x + side!.width).toBeLessThan(card!.x);

  await page.setViewportSize({ width: 1279, height: 900 });
  await expect(page.getByRole('complementary', { name: 'Your guess' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('complementary', { name: 'Your guess' })).toHaveCount(0);
});

test('the summary follows the guess in words', async ({ page }) => {
  await openGuess(page, 1568);
  const summary = page.getByRole('complementary', { name: 'Your guess' });
  await expect(summary.getByText('Not written yet.')).toBeVisible();
  await page
    .getByRole('radio', { name: /^the number is even/i })
    .first()
    .click();
  await expect(summary.getByText('Not written yet.')).toHaveCount(0);
});

test('a glossary term opens from the keyboard and Esc closes it', async ({ page }) => {
  await openGuess(page, 1280);
  const term = page.getByRole('button', { name: 'atoms', exact: true });
  await term.focus();
  await expect(term).toHaveAttribute('aria-describedby', /.+/);
  await page.keyboard.press('Enter');
  const tip = page.getByRole('tooltip').filter({ hasText: 'building block' });
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});

test('Cost & payout reads live parameters and lists the three lock tiers', async ({ page }) => {
  await openGuess(page, 1568);
  const panel = page.getByRole('complementary', { name: 'Your guess' }).locator('details');
  await panel.locator('summary').click();
  await expect(panel.getByRole('heading', { name: 'One play' })).toBeVisible();
  await expect(panel.getByText('Reading the parameters from the contract…')).toHaveCount(0);
  await expect(panel.getByText(/Ribbon lock/)).toBeVisible();
  await expect(panel.getByText(/Wax lock/)).toBeVisible();
  await expect(panel.getByText(/Signet lock/)).toBeVisible();
  await noHorizontalOverflow(page);
});
