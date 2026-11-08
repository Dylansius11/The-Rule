import { expect, test, type Locator, type Page } from '@playwright/test';

const guideSeen = async (page: Page) => {
  await page.addInitScript(() => localStorage.setItem('the-rule:guide-seen', '1'));
};

function roomNav(page: Page, mobile: boolean): Locator {
  return page.getByRole('navigation', { name: mobile ? 'Game' : 'Round room' });
}

async function openSettings(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'More', exact: true }).click();
  else await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

test('landing CTA, room tabs and mode switch preserve the selected tab', async ({ page, isMobile }) => {
  await guideSeen(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Enter the game', exact: true }).first().click();
  await expect(page).toHaveURL(/\/play\/solo$/);
  const tabs = [
    ['Stamp', '', /Stamp a play/i],
    ['Ledger', '/ledger', /The ledger/i],
    ['Guess', '/guess', /Make your guess/i],
    ['Verify', '/verify', /Reveal & verify/i],
  ] as const;
  for (const [label, suffix, heading] of tabs) {
    await roomNav(page, isMobile).getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/play/solo${suffix}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Team' }).click();
    await expect(page).toHaveURL(new RegExp(`/play/team${suffix}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Solo' }).click();
  }
});

for (const [source, destination] of [
  ['/log?mode=1&round=0', '/play/team/ledger?round=0'],
  ['/guess?mode=1&round=0', '/play/team/guess?round=0'],
  ['/reveal?mode=1&round=0', '/play/team/verify?round=0'],
  ['/team?mode=1&round=0', '/play/team/crew'],
  ['/wallet?mode=1&round=0', '/account'],
] as const) {
  test(`legacy redirect ${source}`, async ({ page }) => {
    await guideSeen(page);
    await page.goto(source);
    if (source.startsWith('/team?') || source.startsWith('/wallet?')) {
      await expect(page).toHaveURL(url => url.pathname === destination);
    } else {
      await expect(page).toHaveURL(new URL(destination, 'http://127.0.0.1:5173').href);
    }
  });
}

test('first-visit guide steps, dismissal, persistence and reopening', async ({ page, isMobile }) => {
  await page.goto('/play');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Pick a number and a word' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'The sealed law stamps it' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog.getByRole('heading', { name: 'Pick a number and a word' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(dialog).not.toBeVisible();
  if (isMobile) {
    await page.goto('/play/solo?guide=1');
    await expect(dialog.getByRole('heading', { name: 'Pick a number and a word' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  } else {
    const trigger = page.getByRole('button', { name: 'How to play', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading', { name: 'Pick a number and a word' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});

test('sound and reduced motion persist and motion state updates', async ({ page, isMobile }) => {
  await guideSeen(page);
  await page.goto('/play/solo');
  await openSettings(page, isMobile);
  const sound = page.getByRole('switch', { name: 'Sound' });
  const motion = page.getByRole('switch', { name: 'Reduce motion' });
  await expect(sound).toHaveAttribute('aria-checked', 'true');
  await sound.click();
  await motion.click();
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  await expect(motion).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await openSettings(page, isMobile);
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  await expect(motion).toHaveAttribute('aria-checked', 'true');
});

test('unavailable demo leaves the rehearsal deployment active', async ({ page }) => {
  await guideSeen(page);
  await page.goto('/play/solo');
  const strip = page.getByRole('note');
  await expect(strip).toContainText('Testnet rehearsal · keys retained · no preselected rule');
  await strip.getByRole('radio', { name: 'Demo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Demo Mode is not deployed yet' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay on the real game' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/play\/solo$/);
  await expect(strip).toContainText('Testnet rehearsal · keys retained · no preselected rule');
  await expect(strip).not.toContainText('Demo Mode - preselected rule');
  await expect(strip.getByRole('radio', { name: 'Live' })).toHaveAttribute('aria-checked', 'true');
});

test('live solo round 0 replay matches its commitment and all 52 verdicts', async ({ page }) => {
  await guideSeen(page);
  await page.goto('/play/solo/verify?round=0');
  await page.getByRole('button', { name: 'Break the seal' }).click({ timeout: 90_000 });
  const checks = page.getByRole('list', { name: 'Checks' });
  await expect(checks.getByText('Day-1 commitment matches')).toBeVisible({ timeout: 100_000 });
  await expect(checks.getByText('52 of 52 verdicts match')).toBeVisible();
  await expect(checks.getByText('Log is complete')).toBeVisible();
  await expect(
    page.getByText(
      'Replay proves every verdict matches the revealed rule and the round commitment. It does not prove the enclave kept the rule secret during the round.',
    ),
  ).toBeVisible();
});

test('live solo round 0 ledger is complete and verdict filtering narrows the plays', async ({ page }) => {
  await guideSeen(page);
  await page.goto('/play/solo/ledger?round=0');
  await expect(page.getByText('52 of 52 plays loaded')).toBeVisible({ timeout: 100_000 });
  await expect(page.getByRole('progressbar', { name: 'Completeness' })).toHaveAttribute(
    'aria-valuenow',
    '52',
  );
  await expect(page.getByText(/52 of 52 plays shown/)).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Verdict' }).getByRole('radio', { name: /yes/i }).click();
  const summary = page.getByText(/\d+ of 52 plays shown/);
  await expect
    .poll(async () => {
      const text = await summary.textContent();
      return Number(text?.match(/^(\d+) of 52 plays shown/)?.[1] ?? 52);
    })
    .toBeLessThan(52);
  await expect(page.getByRole('list', { name: 'Plays' }).getByRole('listitem').first()).toBeVisible();
  const names = await page.getByRole('list', { name: 'Plays' }).getByRole('button').allTextContents();
  expect(names.every(name => /yes/i.test(name))).toBe(true);
});

for (const route of [
  '/',
  '/play',
  '/play/solo',
  '/play/solo/ledger?round=0',
  '/play/solo/guess',
  '/play/solo/verify?round=0',
  '/play/team',
  '/play/team/ledger',
  '/play/team/guess',
  '/play/team/verify',
  '/play/team/crew',
  '/season',
  '/account',
  '/dev/states',
  '/not-a-route',
]) {
  test(`mobile width and navigation: ${route}`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile viewport check');
    await guideSeen(page);
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
    const bar = page.getByRole('navigation', { name: 'Game' });
    if (route === '/') await expect(bar).toHaveCount(0);
    else await expect(bar).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);
  });
}

test('keyboard can reach skip link, operate mode and room tabs with visible focus', async ({
  page,
  isMobile,
}) => {
  await guideSeen(page);
  await page.goto('/play/solo');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  const solo = page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Solo' });
  for (let i = 0; i < 20 && !(await solo.evaluate(el => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(solo).toBeFocused();
  const focusVisible = async (element: Locator) => {
    const style = await element.evaluate(el => {
      const css = getComputedStyle(el);
      return (css.outlineStyle !== 'none' && css.outlineWidth !== '0px') || css.boxShadow !== 'none';
    });
    expect(style).toBe(true);
  };
  await focusVisible(solo);
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/play\/team$/);
  const team = page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Team' });
  await expect(team).toBeFocused();
  const ledger = roomNav(page, isMobile).getByRole('link', { name: 'Ledger', exact: true });
  for (let i = 0; i < 30 && !(await ledger.evaluate(el => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(ledger).toBeFocused();
  await focusVisible(ledger);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/play\/team\/ledger$/);
  await expect(page.getByRole('heading', { level: 1, name: /The ledger/i })).toBeVisible();
});
