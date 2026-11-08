import { test, expect } from '../support/sandbox';
import { formatNear } from '../../src/chain/format';

// Every signature and view below targets the isolated sandbox with mock OutLayer, not testnet evidence.
test.describe('sandbox with mock OutLayer, not testnet evidence', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterEach(async ({ page }, info) => {
    if (info.status !== info.expectedStatus)
      console.error(
        'Sandbox with mock OutLayer, not testnet evidence — failure UI:\n' +
          (await page.locator('main').innerText()),
      );
  });

  test('Solo: wallet soft gate, credit, pending verdict, free duplicate, failure refund, ledger, guess, settlement, claim and replay', async ({
    page,
    control,
    view,
    actor,
    sandbox,
  }) => {
    test.setTimeout(240_000);
    const player = async () => (await view('get_player', { account: actor.accountId })) as { credit: string };
    const entity = async () =>
      (await view('get_entity', { mode: 0, id: 0, account: actor.accountId })) as {
        attempts: number;
        pending: boolean;
      };
    const log = async () => (await view('get_log', { mode: 0, id: 0, from_idx: 0, limit: 200 })) as unknown[];
    await test.step('no-round Solo has an empty ledger, never a spinner', async () => {
      await page.goto('/play/solo');
      await expect(page.getByRole('heading', { name: 'No round is open.', exact: true })).toBeVisible();
      await expect(page.getByText('No plays yet: no round exists.', { exact: true })).toBeVisible();
      await expect(page.getByText('Loading plays from the chain…', { exact: true })).not.toBeVisible();
      await control({ op: 'startSolo' });
    });
    await test.step('soft gate and insufficient credit explain recovery', async () => {
      await page.goto('/play/solo');
      await expect(page.getByRole('heading', { name: 'Make a play' })).toBeVisible();
      await expect(page.getByText('Your turn. Connect a testnet wallet to stamp a play.')).toBeVisible();
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
      await page.getByRole('button', { name: /STAMP!/ }).click();
      await expect(
        page.getByRole('heading', { name: /There is not enough credit or vault balance/ }).first(),
      ).toBeVisible();
      await expect(
        page.getByText('Add credit or fund the team vault, then try again.', { exact: true }).first(),
      ).toBeVisible();
      expect(await log()).toHaveLength(0);
    });
    await test.step('wallet signs the credit deposit', async () => {
      await page.goto('/account');
      await page.getByLabel('Deposit', { exact: true }).fill('2');
      await page.getByRole('button', { name: 'Deposit credit', exact: true }).click();
      await expect(
        page.getByText(
          'Deposit transaction accepted. Your game credit above updates when the chain shows it.',
        ),
      ).toBeVisible();
      await expect
        .poll(async () => BigInt((await player()).credit) > 1_900_000_000_000_000_000_000_000n)
        .toBe(true);
    });
    await test.step('fresh token storage payment and game registration use actual views', async () => {
      const registration = page.getByRole('region', { name: 'RULE registration' });
      expect(await view('storage_balance_of', { account_id: actor.accountId }, sandbox.token)).toBeNull();
      await expect(
        registration.getByRole('button', { name: 'Confirm RULE registration', exact: true }),
      ).toBeDisabled();
      const bounds = await view('storage_balance_bounds', {}, sandbox.token);
      expect(bounds).toHaveProperty('min');
      if (!bounds || typeof bounds !== 'object' || !('min' in bounds) || typeof bounds.min !== 'string')
        throw new Error('Invalid storage bounds');
      await registration
        .getByRole('button', {
          name: `Pay token storage · ${formatNear(BigInt(bounds.min), 24)} NEAR`,
          exact: true,
        })
        .click();
      await expect(
        registration.getByText('Token storage registered. Confirm it with the game next.', { exact: true }),
      ).toBeVisible();
      const stored = await view('storage_balance_of', { account_id: actor.accountId }, sandbox.token);
      expect(stored).toMatchObject({ total: bounds.min });
      await registration.getByRole('button', { name: 'Confirm RULE registration', exact: true }).click();
      await expect(
        registration.getByText('RULE registration confirmed by the game.', { exact: true }),
      ).toBeVisible();
      expect(await view('get_token_state', { account: actor.accountId })).toBe('registered');
    });
    await test.step('NO arrives only after a real pending state; duplicate is free', async () => {
      await page.goto('/play/solo');
      await control({ op: 'sameMinuteWindow' });
      await page.getByRole('button', { name: /STAMP!/ }).click(); // default 417: atom 0 is number even
      await expect(page.getByText('Waiting for the sealed program.', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('NO · the fee joined the pot', { exact: true }).first()).not.toBeVisible();
      expect(await log()).toHaveLength(0);
      await control({ op: 'resolve' });
      await expect(page.getByText('NO · the fee joined the pot', { exact: true }).first()).toBeVisible();
      expect(await log()).toHaveLength(1);
      const before = (await player()).credit;
      await page.getByRole('button', { name: /STAMP!/ }).click();
      await expect(page.getByText('Already tried: NO', { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/nothing charged · no log row/).first()).toBeVisible();
      expect((await player()).credit).toBe(before);
      expect(await log()).toHaveLength(1);
    });
    await test.step('forced mock enclave failure refunds fee/storage and restores attempt', async () => {
      const before = await player();
      const attempts = (await entity()).attempts;
      await page.getByRole('button', { name: '+1', exact: true }).click();
      await page.getByRole('button', { name: /STAMP!/ }).click();
      await expect(page.getByText('Waiting for the sealed program.', { exact: true }).first()).toBeVisible();
      await control({ op: 'resolve', fail: true });
      await expect(
        page.getByText('The sealed program could not answer. Your fee came back.', { exact: true }).first(),
      ).toBeVisible();
      expect((await player()).credit).toBe(before.credit);
      expect((await entity()).attempts).toBe(attempts);
      expect(await log()).toHaveLength(1);
      await page.getByRole('button', { name: /STAMP!/ }).click();
      await expect(page.getByText('Waiting for the sealed program.', { exact: true }).first()).toBeVisible();
      await control({ op: 'resolve' });
      await expect(page.getByText(/YES, logged/).first()).toBeVisible();
      expect(await log()).toHaveLength(2);
    });
    await test.step('earned RULE can lock for the next Solo slot', async () => {
      await page.goto('/account');
      const balance = BigInt(
        (await view('ft_balance_of', { account_id: actor.accountId }, sandbox.token)) as string,
      );
      expect(balance).toBeGreaterThanOrEqual(1_000_000_000_000_000_000n);
      await expect(page.getByRole('radio', { name: 'Solo round 1 · next slot', exact: true })).toBeChecked();
      await page.getByRole('radiogroup', { name: 'Lock tier' }).getByRole('radio').first().click();
      await page.getByRole('button', { name: 'Lock RULE', exact: true }).click();
      await expect
        .poll(async () => await view('get_lock', { mode: 0, round_id: 1, account: actor.accountId }))
        .toBe('1000000000000000000');
      await expect(page.getByText('Solo round 1 · your lock 1 RULE', { exact: true })).toBeVisible();
      const after = BigInt(
        (await view('ft_balance_of', { account_id: actor.accountId }, sandbox.token)) as string,
      );
      expect(balance - after).toBe(1_000_000_000_000_000_000n);
    });
    await test.step('ledger reads the two actual settled rows', async () => {
      await page.goto('/play/solo/ledger?round=0');
      await expect(page.getByText('2 of 2 plays loaded')).toBeVisible();
      await expect(page.getByRole('list', { name: 'Plays' }).getByRole('listitem')).toHaveCount(2);
    });
    await test.step('free guess check sends no transaction; commit and reveal are signed', async () => {
      await page.goto('/play/solo/guess');
      await page
        .getByRole('radiogroup', { name: 'Rule shape' })
        .getByRole('radio', { name: 'Single', exact: true })
        .click();
      await page
        .getByRole('radiogroup', { name: 'Atom atoms', exact: true })
        .getByRole('radio')
        .first()
        .click();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      const before = (await player()).credit;
      await page.getByRole('button', { name: 'Check against the ledger', exact: true }).click();
      await expect(page.getByText(/Consistent with all 2 logged verdicts/).first()).toBeVisible();
      expect((await player()).credit).toBe(before);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByRole('button', { name: 'Seal & commit', exact: true }).click();
      await expect(
        page.getByText(
          'Committed. Your guess is a hash on chain now. Reveal it in step 4 after the minimum delay.',
        ),
      ).toBeVisible();
      await control({ op: 'advance', blocks: 5 });
      await page.getByRole('button', { name: 'Skip to reveal', exact: true }).click();
      await page.getByRole('button', { name: 'Reveal this guess', exact: true }).click();
      await control({ op: 'resolve' });
      await expect(page.getByText('Correct', { exact: true })).toBeVisible();
    });
    await test.step('local harness keeper opens and settles; wallet claims into game credit', async () => {
      await control({ op: 'settle' });
      await expect
        .poll(async () => ((await view('get_round', { mode: 0, id: 0 })) as { phase: string }).phase)
        .toBe('Settled');
      await page.goto('/account');
      const before = BigInt((await player()).credit);
      await expect(page.getByRole('heading', { name: 'Claims', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Claim', exact: true }).click();
      await expect.poll(async () => BigInt((await player()).credit) > before).toBe(true);
      await expect(page.getByText('nothing to claim', { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText(/NEAR added to your play credit\. Withdraw credit separately/),
      ).toBeVisible();
      await expect(page.getByText(/payout transfer is a separate step/)).not.toBeVisible();
    });
    await test.step('browser shared wasm verifies commitment, verdicts and completeness', async () => {
      await page.goto('/play/solo/verify?round=0');
      await page.getByRole('button', { name: 'Break the seal', exact: true }).click();
      const checks = page.getByRole('list', { name: 'Checks' });
      await expect(checks.getByText('Day-1 commitment matches')).toBeVisible();
      await expect(checks.getByText('2 of 2 verdicts match')).toBeVisible();
      await expect(checks.getByText('Log is complete')).toBeVisible();
    });
  });

  test('Team: no-round explanation, create team, deposit vault and stamp shared line', async ({
    page,
    control,
    view,
    actor,
  }) => {
    await page.goto('/play/team');
    await expect(page.getByRole('heading', { name: 'No round is open.', exact: true })).toBeVisible();
    await expect(page.getByText('No plays yet: no round exists.', { exact: true })).toBeVisible();
    await expect(page.getByText('Loading plays from the chain…', { exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.goto('/play/team/crew');
    await page.getByLabel('Team name', { exact: true }).fill('Sandbox ink');
    await expect(page.getByRole('button', { name: 'Create team', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Use 3–24 ASCII lowercase letters, digits or hyphens.' }),
    ).toBeVisible();
    const unteamed = await view('get_player', { account: actor.accountId });
    expect(unteamed).toMatchObject({ team_id: null });
    await page.getByLabel('Team name', { exact: true }).fill('sandbox-ink');
    await page.getByRole('button', { name: 'Create team', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'sandbox-ink', exact: true })).toBeVisible();
    await page.getByLabel('Deposit to vault', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Deposit', exact: true }).click();
    await expect(
      page.getByText('Deposit transaction accepted. The vault above updates when the chain shows it.'),
    ).toBeVisible();
    await control({ op: 'startTeam' });
    await page.goto('/play/team');
    await page.getByRole('button', { name: /STAMP!/ }).click();
    await expect(page.getByText('Waiting for the sealed program.', { exact: true }).first()).toBeVisible();
    await control({ op: 'resolve' });
    await expect(page.getByText('NO · the fee joined the pot', { exact: true }).first()).toBeVisible();
    const player = (await view('get_player', { account: actor.accountId })) as { team_id: number };
    const team = (await view('get_team', { team_id: player.team_id })) as { vault: string };
    expect(BigInt(team.vault)).toBeLessThan(1_000_000_000_000_000_000_000_000n);
    const log = (await view('get_log', { mode: 1, id: 0, from_idx: 0, limit: 200 })) as unknown[];
    expect(log).toHaveLength(1);
  });

  test('Season: the HEAD get_season view is supported and rendered, not the r2 fallback', async ({
    page,
    view,
    control,
  }) => {
    await page.goto('/season');
    await expect(page.getByRole('heading', { name: 'Season index not ready', exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Season board', exact: true })).not.toBeVisible();
    await control({ op: 'indexSeason' });
    const season = await view('get_season', { mode: 0, season: 0, from: null, limit: 100 });
    expect(Array.isArray(season)).toBe(true);
    await page.goto('/season');
    await expect(page.getByRole('heading', { name: 'The season board' })).toBeVisible();
    await expect(page.getByText('This deployment keeps no season board')).not.toBeVisible();
    await expect(page.getByRole('table', { name: 'Season board', exact: true })).toBeVisible();
  });
});
