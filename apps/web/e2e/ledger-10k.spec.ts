import { expect, test } from '@playwright/test';
import { syntheticRows } from './synthetic/ledger';

test('ledger at 10,000 rows: synthetic log, not chain data', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'data', description: 'synthetic log, not chain data' });
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('the-rule:guide-seen', '1');
    const tasks: number[] = [];
    (window as unknown as { __syntheticLongTasks: number[] }).__syntheticLongTasks = tasks;
    new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration))).observe({
      entryTypes: ['longtask'],
    });
  });
  const pages: number[] = [];
  await page.route('**/*', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    let body: {
      method?: string;
      id?: string;
      params?: { account_id?: string; method_name?: string; args_base64: string };
    };
    try {
      body = request.postDataJSON();
    } catch {
      return route.continue();
    }
    const params = body?.params;
    if (body?.method !== 'query' || params?.account_id !== 'game-r2.therule.testnet' || !params.args_base64)
      return route.continue();
    const args = JSON.parse(Buffer.from(params.args_base64, 'base64').toString());
    if (params.method_name === 'get_log' && args.mode === 0 && args.id === 0) {
      pages.push(args.from_idx);
      const result = Array.from(
        Buffer.from(JSON.stringify(syntheticRows.slice(args.from_idx, args.from_idx + args.limit))),
      );
      return route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: body.id,
          result: { result, logs: [], block_hash: 'synthetic', block_height: 0 },
        },
      });
    }
    if (params.method_name === 'get_round' && args.mode === 0 && args.id === 0) {
      const response = await route.fetch();
      const envelope = await response.json();
      const round = JSON.parse(Buffer.from(envelope.result.result).toString());
      round.log_len = syntheticRows.length;
      envelope.result.result = Array.from(Buffer.from(JSON.stringify(round)));
      return route.fulfill({ response, json: envelope });
    }
    return route.continue();
  });
  const start = Date.now();
  await page.goto('/play/solo/ledger?round=0');
  await expect(page.getByText('10,000 of 10,000 plays loaded')).toBeVisible({ timeout: 120_000 });
  const loadMs = Date.now() - start;
  expect(pages).toEqual(Array.from({ length: 50 }, (_, i) => i * 200));
  const list = page.getByRole('list', { name: 'Plays' });
  const countRows = () => list.getByRole('listitem').count();
  const domCounts = [await countRows()];
  for (const fraction of [0.5, 1]) {
    await list.evaluate((el, f) => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
    }, fraction);
    await page.waitForTimeout(150);
    domCounts.push(await countRows());
  }
  expect(Math.max(...domCounts)).toBeLessThan(200);
  // Newest-first is the default; the end of the list is row zero.
  await expect(list.getByRole('button', { name: /^Play 0:/ })).toBeVisible();
  const tasks = await page.evaluate(
    () => (window as unknown as { __syntheticLongTasks: number[] }).__syntheticLongTasks,
  );
  const blocking = tasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0);
  // 5 s total blocking allows browser startup and shared CI contention, but rejects sustained stalls.
  expect(blocking).toBeLessThan(5000);
  const search = page.getByRole('searchbox', { name: 'Search by number, word or player' });
  const summary = page.locator('[aria-live="polite"]').filter({ hasText: 'plays shown' });
  const word = 'otter'; // word_id 0 in rule-core's immutable catalogue
  await search.fill(word);
  const wordRows = syntheticRows.filter(r => r.play.word_id === 0);
  await expect(summary).toContainText(`${wordRows.length.toLocaleString('en-US')} of 10,000 plays shown`);
  await search.fill('123');
  const numberRows = syntheticRows.filter(
    r => String(r.play.number).padStart(3, '0').includes('123') || r.account.includes('123'),
  );
  await expect(summary).toContainText(`${numberRows.length.toLocaleString('en-US')} of 10,000 plays shown`);
  await search.fill(word);
  const verdict = page.getByRole('radiogroup', { name: 'Verdict' });
  for (const yes of [true, false]) {
    await verdict.getByRole('radio', { name: yes ? /yes/i : /no/i }).click();
    const expected = wordRows.filter(r => r.verdict === yes).reverse();
    await expect(summary).toContainText(`${expected.length.toLocaleString('en-US')} of 10,000 plays shown`);
    if (!yes) continue;
    const records = expected.map(r => ({
      log_idx: r.log_idx,
      seq: r.seq,
      account: r.account,
      number: String(r.play.number).padStart(3, '0'),
      word,
      word_id: r.play.word_id,
      minute_digit: r.play.minute_digit,
      verdict: 'YES',
      minted_base_units: r.minted,
    }));
    for (const format of ['JSON', 'CSV'] as const) {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: `Export ${format}` }).click();
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      if (format === 'JSON') expect(JSON.parse(text)).toEqual(records);
      else {
        const [header, ...lines] = text.split('\n');
        expect(header?.split(',')).toEqual(Object.keys(records[0]!));
        expect(
          lines.map(line =>
            [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1]!.replaceAll('""', '"')),
          ),
        ).toEqual(records.map(r => Object.values(r).map(String)));
      }
      console.log(
        `synthetic log, not chain data: ${format} export ${Buffer.byteLength(text)} bytes, ${records.length} rows`,
      );
    }
  }
  await search.fill('');
  await verdict.getByRole('radio', { name: /^all$/i }).click();
  const memory = async () =>
    page.evaluate(() => ({
      nodes: document.getElementsByTagName('*').length,
      heap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize,
    }));
  const before = await memory();
  for (let i = 0; i < 20; i++) {
    await verdict.getByRole('radio', { name: /yes/i }).click();
    await verdict.getByRole('radio', { name: /^all$/i }).click();
  }
  const after = await memory();
  expect(after.nodes - before.nodes).toBeLessThan(200);
  // Allow transient garbage; the ceiling catches a retained copy of the 10k log each toggle.
  if (before.heap && after.heap) expect(after.heap - before.heap).toBeLessThan(100_000_000);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  console.log(
    `synthetic log, not chain data: load ${loadMs}ms; rendered rows ${domCounts.join('/')}; long tasks ${tasks.length}, blocking ${blocking.toFixed(0)}ms; DOM ${before.nodes}->${after.nodes}; heap ${before.heap}->${after.heap}`,
  );
});
