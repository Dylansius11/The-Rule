import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The in-app docs site against the dev server. The page list comes from the generated `public/docs/index.json`
 * (run `pnpm docs:build` first; `pnpm dev` does it). The trust sentence is read from its one source in
 * `src/config/env.ts`; it is not retyped here.
 */
const web = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
if (!existsSync(web('public/docs/index.json'))) throw new Error('Run `pnpm docs:build` before the docs e2e.');

interface Entry {
  slug: string;
  section: string;
  title: string;
  path: string;
}
const index = JSON.parse(readFileSync(web('public/docs/index.json'), 'utf8')) as {
  sections: { id: string; title: string; entries: Entry[] }[];
};
const entries = index.sections.flatMap(s => s.entries);
const TRUST = /export const TRUST_SENTENCE =\s*'([^']+)'/.exec(
  readFileSync(web('src/config/env.ts'), 'utf8'),
)![1]!;
const route = (e: Entry) => `/docs/${e.section}/${e.slug}`;
const page1 = (section: string) => entries.find(e => e.section === section)!;
const manifestCount = (readFileSync(web('src/art/manifest.ts'), 'utf8').match(/src: '/g) ?? []).length;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('the-rule:guide-seen', '1'));
});

/** What the page put on the clipboard. Windows stores line breaks as CRLF, so they are read back as LF. */
async function clipboard(page: Page): Promise<string> {
  const text = await page.evaluate(() => navigator.clipboard.readText());
  return text.replace(/\r\n/g, '\n');
}

/** Console errors and uncaught exceptions of the page, collected from now on. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test.describe('home', () => {
  test('lists every section and page from index.json, and the trust sentence once', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('DOCS');
    expect(await page.title()).toBe('Docs · THE RULE');
    for (const section of index.sections) {
      const card = page.locator(`#section-${section.id}`);
      await expect(card.getByRole('heading', { level: 3, name: section.title })).toBeVisible();
      await expect(card.locator('.doc-card-list a')).toHaveCount(section.entries.length);
      for (const e of section.entries) {
        await expect(card.getByRole('link', { name: e.title })).toHaveAttribute('href', route(e));
      }
    }
    await expect(page.locator('.doc-card-list a')).toHaveCount(entries.length);
    await expect(page.getByTestId('trust-sentence')).toHaveText(TRUST);
    await expect(page.getByTestId('trust-sentence')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('the agent card shows the real size of CONTEXT.md and the raw, download and machine links', async ({
    page,
    request,
  }) => {
    const context = await (await request.get('/CONTEXT.md')).text();
    await page.goto('/docs');
    const kb = (Buffer.byteLength(context) / 1024).toFixed(1);
    await expect(page.getByTestId('context-size')).toHaveText(`${kb} kB`);
    await expect(page.getByRole('link', { name: 'Open raw' })).toHaveAttribute('href', '/CONTEXT.md');
    const download = page.getByRole('link', { name: 'Download' });
    await expect(download).toHaveAttribute('href', '/CONTEXT.md');
    await expect(download).toHaveAttribute('download', 'CONTEXT.md');
    await expect(page.getByRole('link', { name: 'llms.txt' })).toHaveAttribute('href', '/llms.txt');
    await expect(page.getByRole('link', { name: 'grammar.json' })).toHaveAttribute('href', '/grammar.json');
  });

  test('Copy CONTEXT.md writes the real file to the clipboard', async ({ page, context, request }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const file = await (await request.get('/CONTEXT.md')).text();
    await page.goto('/docs');
    await page.getByRole('button', { name: 'Copy CONTEXT.md' }).click();
    await expect(page.getByTestId('copy-status')).toHaveText('Copied CONTEXT.md to the clipboard.');
    const copied = await clipboard(page);
    expect(copied).toBe(file);
    expect(copied.startsWith('# ')).toBe(true);
    expect(copied.split(TRUST).length - 1).toBe(1);
  });

  test('a clipboard that refuses is reported, never silent', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      });
      document.execCommand = () => false;
    });
    await page.goto('/docs');
    await page.getByRole('button', { name: 'Copy CONTEXT.md' }).click();
    await expect(page.getByTestId('copy-status')).toContainText('Could not copy CONTEXT.md');
    await expect(page.getByTestId('copy-status')).toContainText('Open raw');
  });

  test('the machine files are served as text and the grammar has 90 atoms', async ({ request }) => {
    const context = await request.get('/CONTEXT.md');
    expect(context.ok()).toBe(true);
    expect(context.headers()['content-type']).toMatch(/^text\//);
    expect((await context.text()).startsWith('# ')).toBe(true);
    const llms = await request.get('/llms.txt');
    expect(llms.ok()).toBe(true);
    expect(llms.headers()['content-type']).toMatch(/^text\//);
    const grammar = await request.get('/grammar.json');
    expect(grammar.ok()).toBe(true);
    const parsed = (await grammar.json()) as { atoms: unknown[]; grammar: string };
    expect(parsed.grammar).toBe('g1');
    expect(parsed.atoms).toHaveLength(90);
  });
});

test.describe('every page', () => {
  for (const e of entries) {
    test(`${e.section}/${e.slug}: loads with an H1, its title, focus on the heading, no console errors`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await page.goto(route(e));
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveText(e.title);
      await expect(h1).toBeFocused();
      expect(await page.title()).toBe(
        `${e.title} · ${index.sections.find(s => s.id === e.section)!.title} · Docs · THE RULE`,
      );
      await expect(page.locator('.doc-prose').first()).not.toBeEmpty();
      await expect(page.getByRole('link', { name: 'Open raw .md' })).toHaveAttribute('href', e.path);
      await expect(page.getByRole('button', { name: 'Copy page as Markdown' })).toBeVisible();
      // The trust sentence callout belongs to the Trust section only.
      await expect(page.getByTestId('trust-sentence')).toHaveCount(e.section === 'trust' ? 1 : 0);
      if (e.section === 'trust') await expect(page.getByTestId('trust-sentence')).toHaveText(TRUST);
      expect(errors).toEqual([]);
    });
  }

  test('the raw Markdown is served raw while the same address without .md is the app', async ({
    page,
    request,
  }) => {
    const raw = await request.get('/docs/play/how-to-play.md');
    expect(raw.headers()['content-type']).not.toMatch(/html/);
    expect((await raw.text()).startsWith('---\ntitle:')).toBe(true);
    await page.goto('/docs/play/how-to-play');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to play');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to play');
  });

  test('Copy page as Markdown copies the raw file', async ({ page, context, request }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const e = page1('play');
    const raw = await (await request.get(e.path)).text();
    await page.goto(route(e));
    await page.getByRole('button', { name: 'Copy page as Markdown' }).click();
    await expect(page.getByTestId('copy-status')).toHaveText(
      'Copied this page as Markdown to the clipboard.',
    );
    expect(await clipboard(page)).toBe(raw);
  });

  test('previous and next walk the whole docs in order', async ({ page }) => {
    await page.goto(route(entries[0]!));
    await expect(page.getByRole('link', { name: /Previous/ })).toHaveCount(0);
    for (let i = 1; i < entries.length; i++) {
      await page.getByRole('link', { name: /Next/ }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(entries[i]!.title);
    }
    await expect(page.getByRole('link', { name: /Next/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Previous/ })).toHaveCount(1);
  });

  test('an unknown address says so, offers search and the way home, and a bare section opens its first page', async ({
    page,
  }) => {
    await page.goto('/docs/play/nope');
    await expect(page.getByRole('heading', { name: 'No such page in the docs' })).toBeVisible();
    expect(await page.title()).toBe('No such page · Docs · THE RULE');
    await expect(page.getByRole('combobox', { name: 'Search the docs' })).toBeVisible();
    await page.getByRole('link', { name: 'Docs home' }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await page.goto('/docs/nope');
    await expect(page.getByRole('heading', { name: 'No such page in the docs' })).toBeVisible();
    await page.goto('/docs/a/b/c');
    await expect(page.getByRole('heading', { name: 'No such page in the docs' })).toBeVisible();
    await page.goto('/docs/play');
    await expect(page).toHaveURL(new RegExp(`${route(page1('play'))}$`));
  });

  test('external links open in a new tab safely, and the Source page links the repository', async ({
    page,
  }) => {
    await page.goto('/docs/brand/source-and-collaboration');
    const link = page.locator('.doc-prose a[href^="https://"]').first();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);
  });

  test('internal links go through the router (no full reload)', async ({ page }) => {
    await page.goto('/docs/play/how-to-play');
    await page.evaluate(() => Object.assign(window, { docsMarker: true }));
    await page.locator('.doc-prose a[href="/docs/play/costs-and-payouts"]').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Costs and payouts');
    expect(await page.evaluate(() => 'docsMarker' in window)).toBe(true);
  });

  test('a heading anchor copies a deep link and the deep link scrolls to the heading', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/play/faq');
    const heading = page.getByRole('heading', { level: 3, name: 'What is the storage charge?' });
    await heading.hover();
    await page.getByRole('button', { name: 'Copy link to “What is the storage charge?”' }).click();
    const link = await clipboard(page);
    expect(link).toMatch(/\/docs\/play\/faq#what-is-the-storage-charge$/);
    await page.goto(link);
    await expect(heading).toBeInViewport();
  });

  test('code blocks have a working copy button and scroll inside themselves', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/agents/agent-quickstart');
    const block = page.locator('.doc-code').first();
    const code = (await block.locator('pre code').textContent())!;
    await block.getByRole('button', { name: /^Copy .* block$/ }).click();
    await expect(block.getByRole('button', { name: /^Copy .* block$/ })).toHaveText('Copied');
    expect(await clipboard(page)).toBe(code);
  });
});

test.describe('search', () => {
  test('"storage charge" finds the FAQ question and opens it with Enter', async ({ page }) => {
    await page.goto('/docs');
    const box = page.getByRole('combobox', { name: 'Search the docs' });
    await box.fill('storage charge');
    const options = page.getByRole('option');
    await expect(options.first()).toContainText('What is the storage charge?');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.doc-mark').first()).toBeVisible();
    await box.press('Enter');
    await expect(page).toHaveURL(/\/docs\/play\/faq#what-is-the-storage-charge$/);
    await expect(
      page.getByRole('heading', { level: 3, name: 'What is the storage charge?' }),
    ).toBeInViewport();
  });

  test('"attempts" is grouped by section; arrows move the selection; Enter opens the selected page', async ({
    page,
  }) => {
    await page.goto('/docs');
    const box = page.getByRole('combobox', { name: 'Search the docs' });
    await box.fill('attempts');
    await expect(page.locator('.doc-group-label').first()).toBeVisible();
    const options = page.getByRole('option');
    expect(await options.count()).toBeGreaterThan(2);
    await box.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(box).toHaveAttribute('aria-activedescendant', (await options.nth(1).getAttribute('id'))!);
    await box.press('ArrowUp');
    await box.press('ArrowUp');
    await expect(options.last()).toHaveAttribute('aria-selected', 'true');
    await box.press('ArrowDown');
    const label = await options.first().getAttribute('aria-label');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/docs\/[a-z]+\/[a-z-]+/);
    const title = label!.split(': ')[1]!.split(',')[0]!;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  });

  test('"/" focuses search from anywhere, Esc closes the list and then clears the field', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'keyboard shortcut');
    await page.goto('/docs/trust/trust-model');
    await page.getByRole('heading', { level: 1 }).click();
    await page.keyboard.press('/');
    const box = page.getByRole('combobox', { name: 'Search the docs' });
    await expect(box).toBeFocused();
    await page.keyboard.type('replay');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(box).toHaveValue('replay');
    await page.keyboard.press('Escape');
    await expect(box).toHaveValue('');
  });

  test('"/" inside a text field types a slash instead of stealing focus', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcut');
    await page.goto('/docs');
    const box = page.getByRole('combobox', { name: 'Search the docs' });
    await box.focus();
    await page.keyboard.type('a/b');
    await expect(box).toHaveValue('a/b');
  });

  test('a search with no match says so', async ({ page }) => {
    await page.goto('/docs');
    await page.getByRole('combobox', { name: 'Search the docs' }).fill('zzzzqqqq');
    await expect(page.getByText('No page matches “zzzzqqqq”')).toBeVisible();
  });
});

test.describe('layout', () => {
  test('1280 px: three columns, nav with the current page marked, contents list follows the scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/docs/play/faq');
    const nav = page.getByRole('navigation', { name: 'Docs pages' });
    await expect(nav.getByRole('link', { name: 'Frequently asked questions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await nav.getByRole('button', { name: 'Trust' }).click();
    await expect(nav.getByRole('link', { name: 'Trust model' })).toBeVisible();
    await nav.getByRole('button', { name: 'Trust' }).click();
    await expect(nav.getByRole('link', { name: 'Trust model' })).toBeHidden();
    const toc = page.getByRole('navigation', { name: 'On this page' });
    await expect(toc.getByRole('link', { name: 'Plays and guesses' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    await toc.getByRole('link', { name: 'What is the storage charge?' }).click();
    await expect(toc.getByRole('link', { name: 'What is the storage charge?' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    // article text: reading font, 18px, 1.7 line height; display font only on headings
    const prose = await page
      .locator('.doc-prose p')
      .first()
      .evaluate(el => {
        const s = getComputedStyle(el);
        return {
          size: s.fontSize,
          line: s.lineHeight,
          family: s.fontFamily,
          width: el.getBoundingClientRect().width,
        };
      });
    expect(prose.size).toBe('18px');
    expect(parseFloat(prose.line) / parseFloat(prose.size)).toBeCloseTo(1.7, 1);
    expect(prose.family).toContain('Nunito');
    expect(prose.family).not.toContain('Londrina');
    const columns = await page.evaluate(() => ({
      side: document.querySelector('.doc-side')!.getBoundingClientRect().right,
      article: document.querySelector('.doc-article')!.getBoundingClientRect().left,
      toc: document.querySelector('.doc-toc')!.getBoundingClientRect().left,
    }));
    expect(columns.side).toBeLessThan(columns.article);
    expect(columns.toc).toBeGreaterThan(columns.article + 400);
  });

  test('390 px: a page bar opens the picker sheet, the contents list folds, tap targets are 44 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/docs/play/costs-and-payouts');
    await expect(page.getByRole('navigation', { name: 'Docs pages' })).toHaveCount(0);
    const fold = page.getByRole('button', { name: 'On this page' });
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await fold.click();
    await expect(page.getByRole('link', { name: 'Guess stakes' })).toBeVisible();
    await page.getByRole('link', { name: 'Guess stakes' }).click();
    await expect(page.getByRole('link', { name: 'Guess stakes' })).toBeHidden();

    const bar = page.getByRole('button', { name: /Docs · Play/ });
    await bar.click();
    const sheet = page.getByRole('dialog', { name: 'Docs' });
    await expect(sheet).toBeVisible();
    const links = sheet.getByRole('navigation', { name: 'Docs pages' }).getByRole('link');
    for (const link of await links.all())
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await sheet.getByRole('button', { name: 'Trust' }).click();
    await sheet.getByRole('link', { name: 'What replay proves' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What replay proves');
    await expect(page.getByTestId('trust-sentence')).toHaveText(TRUST);

    for (const name of ['Copy page as Markdown', 'Open raw .md']) {
      const target = page.getByRole(name === 'Open raw .md' ? 'link' : 'button', { name });
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('390 px: the search button opens the sheet with the field focused', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/docs/play/faq');
    await page.getByRole('button', { name: 'Search the docs' }).click();
    const box = page.getByRole('dialog').getByRole('combobox', { name: 'Search the docs' });
    await expect(box).toBeFocused();
    await box.fill('signing');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.getByRole('option').first().click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('390 px: a long table scrolls inside its own frame with a hint, the page does not', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/docs/agents/contract-reference');
    const scroller = page.locator('.doc-table-scroll').first();
    await expect(scroller).toBeVisible();
    const sizes = await scroller.evaluate(el => ({ inner: el.scrollWidth, outer: el.clientWidth }));
    expect(sizes.inner).toBeGreaterThan(sizes.outer);
    const hint = page.locator('.doc-table').first().locator('.doc-table-hint');
    await expect(hint).toBeVisible();
    const doc = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: document.documentElement.clientWidth,
    }));
    expect(doc.scroll).toBeLessThanOrEqual(doc.width);
    await scroller.evaluate(el => (el.scrollLeft = el.scrollWidth));
    await expect(hint).toBeHidden();
  });

  for (const width of [390, 768, 1280, 1568]) {
    test(`${width} px: no horizontal overflow on the home and one page per section`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const addresses = ['/docs', ...index.sections.map(s => route(page1(s.id)))];
      addresses.push('/docs/agents/contract-reference', '/docs/brand/assets');
      for (const address of addresses) {
        await page.goto(address);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const sizes = await page.evaluate(() => ({
          html: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          view: document.documentElement.clientWidth,
        }));
        expect(sizes.html, `${address} html`).toBeLessThanOrEqual(sizes.view);
        expect(sizes.body, `${address} body`).toBeLessThanOrEqual(sizes.view);
      }
    });
  }
});

test.describe('brand assets', () => {
  test('the gallery shows every manifest image with an informative alt, path, size and a copy button', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/brand/assets');
    const tiles = page.locator('.doc-gallery-grid li');
    await expect(tiles).toHaveCount(manifestCount);
    const first = tiles.first();
    await first.scrollIntoViewIfNeeded();
    const img = first.locator('img');
    const alt = await img.getAttribute('alt');
    expect(alt).toBe('blot/hero');
    await expect(first.locator('.doc-gallery-meta')).toHaveText('918 × 960');
    await expect(first.locator('code')).toHaveText('/art/blot/hero.webp');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    for (const alt of await page
      .locator('.doc-gallery-grid img')
      .evaluateAll(els => els.map(e => e.getAttribute('alt')))) {
      expect(alt).toBeTruthy();
    }
    await first.getByRole('button', { name: 'Copy path /art/blot/hero.webp' }).click();
    expect(await clipboard(page)).toBe('/art/blot/hero.webp');
  });
});

test.describe('entry points', () => {
  test('header, footer and (on a phone) the More sheet reach the docs', async ({ page, isMobile }) => {
    await page.goto('/season');
    if (isMobile) {
      await page.getByRole('button', { name: 'More' }).click();
      await page.getByRole('dialog').getByRole('link', { name: /^Docs/ }).click();
    } else {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Docs' }).click();
    }
    await expect(page).toHaveURL(/\/docs$/);
    await page.goto('/season');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test('the landing band links the docs and copies the same CONTEXT.md', async ({
    page,
    context,
    request,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    const band = page.getByRole('region', { name: 'For humans and agents' });
    await band.scrollIntoViewIfNeeded();
    await band.getByRole('button', { name: 'Copy for agent' }).click();
    await expect(band.getByRole('status')).toHaveText('Copied CONTEXT.md to the clipboard.');
    expect(await clipboard(page)).toBe(await (await request.get('/CONTEXT.md')).text());
    await band.getByRole('link', { name: 'Read the docs' }).click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test('the last step of the guide links the docs', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('the-rule:guide-seen'));
    await page.goto('/play/solo');
    const guide = page.getByRole('dialog');
    await expect(guide).toBeVisible();
    await expect(guide.getByRole('link', { name: /Read the docs/ })).toHaveCount(0);
    for (let i = 0; i < 4; i++) await guide.getByRole('button', { name: 'Next' }).click();
    await guide.getByRole('link', { name: /Read the docs/ }).click();
    await expect(page).toHaveURL(/\/docs\/play\/how-to-play$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to play');
  });

  test('a glossary term offers Read more, reachable by keyboard, into the right docs page', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'keyboard path');
    await page.goto('/play/solo');
    const term = page.getByRole('button', { name: 'attempt', exact: true }).first();
    await term.focus();
    await page.keyboard.press('Enter');
    const tip = page.getByRole('tooltip').filter({ hasText: 'One paid play you may still make' });
    await expect(tip).toBeVisible();
    await page.keyboard.press('Tab');
    const more = tip.getByRole('link', { name: /Read more/ });
    await expect(more).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/docs\/rule\/locking-for-attempts$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Locking for attempts');
  });

  test('the skip link jumps to the content and the page heading takes focus after navigating', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'keyboard path');
    await page.goto('/docs/trust/trust-model');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await page
      .getByRole('navigation', { name: 'Docs pages' })
      .getByRole('link', { name: 'Verify a round' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  });
});
