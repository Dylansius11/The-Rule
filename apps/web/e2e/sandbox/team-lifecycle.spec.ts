import { test, expect } from '../support/sandbox';
import type { Page } from '@playwright/test';

// Actual local game/token WASM with mock OutLayer; not testnet evidence.
test('two wallets exit the vault and claim the deleted team’s historical rewards once', async ({
  page,
  secondPage,
  actor,
  sandbox,
  control,
  view,
}) => {
  // The spec waits for the next scheduled slot. The default fixture's 24 h period never arrives in a
  // wall-clock test, so a default run would burn its whole wait budget and fail. Skip with a visible reason.
  test.skip(
    process.env.THE_RULE_E2E_PROFILE !== 'transitions',
    'needs THE_RULE_E2E_PROFILE=transitions (180 s slots)',
  );
  test.setTimeout(360_000);
  const bob = sandbox.accounts[1]!.accountId;
  const alice = actor.accountId;
  const unit = 1_000_000_000_000_000_000_000_000n;
  const player = async (account: string) =>
    (await view('get_player', { account })) as { credit: string; team_id: number | null };
  const team = async () =>
    (await view('get_team', { team_id: 0 })) as null | {
      members: string[];
      invites: string[];
      vault: string;
      weight: string;
      active_round: number | null;
      deposits: { account: string; weight: string }[];
    };
  const ledger = async () =>
    (await view('get_ledger')) as { vault: string; open_stakes: string; claimable: string };
  const depositCredit = async (p: Page) => {
    await p.goto('/play/team');
    await p.getByRole('button', { name: 'Connect', exact: true }).click();
    await p.goto('/account');
    await p.getByLabel('Deposit', { exact: true }).fill('1');
    await p.getByRole('button', { name: 'Deposit credit', exact: true }).click();
    await expect(
      p.getByText('Deposit transaction accepted. Your game credit above updates when the chain shows it.'),
    ).toBeVisible();
  };
  await depositCredit(page);
  await depositCredit(secondPage);
  await page.goto('/play/team/crew');
  await page.getByLabel('Team name', { exact: true }).fill('sandbox-ink');
  await page.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'sandbox-ink', exact: true })).toBeVisible();
  expect((await player(alice)).team_id).toBe(0);
  await page.getByLabel('Invite a member').fill(bob);
  await page.getByRole('button', { name: 'Send invite', exact: true }).click();
  await expect.poll(async () => (await team())?.invites).toContain(bob);
  await secondPage.goto('/play/team/crew');
  await secondPage.getByLabel('Team id', { exact: true }).first().fill('0');
  await secondPage.getByRole('button', { name: 'Join team', exact: true }).click();
  await expect(secondPage.getByRole('heading', { name: 'sandbox-ink', exact: true })).toBeVisible();
  expect((await team())?.members).toEqual([alice, bob]);
  for (const [p, amount] of [
    [page, '1'],
    [secondPage, '2'],
  ] as const) {
    await p.goto('/play/team/crew');
    await p.getByLabel('Deposit to vault', { exact: true }).fill(amount);
    await p.getByRole('button', { name: 'Deposit', exact: true }).click();
    await expect(
      p.getByText('Deposit transaction accepted. The vault above updates when the chain shows it.'),
    ).toBeVisible();
  }
  const funded = (await team())!;
  expect(BigInt(funded.vault)).toBe(3n * unit);
  expect(BigInt(funded.weight)).toBe(3n * unit);
  expect(funded.deposits).toEqual([
    { account: alice, weight: String(unit) },
    { account: bob, weight: String(2n * unit) },
  ]);
  await control({ op: 'startTeam' });
  await page.goto('/play/team');
  await page.getByRole('button', { name: /STAMP!/ }).click();
  await expect(page.getByText('Waiting for the sealed program.', { exact: true }).first()).toBeVisible();
  await control({ op: 'resolve' });
  await expect(page.getByText('NO · the fee joined the pot', { exact: true }).first()).toBeVisible();
  expect((await view('get_log', { mode: 1, id: 0, from_idx: 0, limit: 200 })) as unknown[]).toHaveLength(1);
  const afterPlay = (await team())!;
  const params = (await view('get_params')) as {
    play_fee: string;
    storage_charge_per_play: string;
  };
  expect(BigInt(afterPlay.vault)).toBe(
    3n * unit - BigInt(params.play_fee) - BigInt(params.storage_charge_per_play),
  );
  expect(afterPlay.active_round).toBe(0);
  await page.goto('/play/team/guess');
  await page
    .getByRole('radiogroup', { name: 'Rule shape' })
    .getByRole('radio', { name: 'Single', exact: true })
    .click();
  await page.getByRole('radiogroup', { name: 'Atom atoms', exact: true }).getByRole('radio').first().click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Seal & commit', exact: true }).click();
  await expect(
    page.getByText(
      'Committed. Your guess is a hash on chain now. Reveal it in step 4 after the minimum delay.',
    ),
  ).toBeVisible();
  const stake =
    BigInt(afterPlay.vault) - BigInt((await team())!.vault) - BigInt(params.storage_charge_per_play);
  expect(stake).toBeGreaterThan(0n);
  expect(BigInt((await ledger()).open_stakes)).toBe(stake);
  await control({ op: 'advance', blocks: 5 });
  await page.getByRole('button', { name: 'Skip to reveal', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal this guess', exact: true }).click();
  await control({ op: 'resolve' });
  await expect(page.getByText('Correct', { exact: true })).toBeVisible();
  const round = (await view('get_round', { mode: 1, id: 0 })) as { pot: string };
  const pot = BigInt(round.pot);
  await control({ op: 'settle', mode: 1, roundId: 0 });
  await expect
    .poll(async () => ((await view('get_round', { mode: 1, id: 0 })) as { phase: string }).phase)
    .toBe('Settled');
  await page.goto('/play/team/crew');
  const desk = page.getByRole('heading', { name: 'After the round' }).locator('..');
  await desk.getByText('Use another round or team').click();
  await desk.getByLabel('Team id', { exact: true }).fill('0');
  await desk.getByLabel('Round id', { exact: true }).fill('0');
  await desk.getByRole('button', { name: 'Unlock team', exact: true }).click();
  await expect.poll(async () => (await team())?.active_round).toBeNull();
  expect(BigInt((await team())!.vault)).toBe(
    BigInt(afterPlay.vault) - BigInt(params.storage_charge_per_play),
  );
  expect(BigInt((await ledger()).open_stakes)).toBe(0n);
  const claimEach = (pot * 4000n) / 10000n / 2n + (pot * 4000n) / 10000n / 2n;
  expect(claimEach).toBeGreaterThan(0n);
  expect(BigInt((await ledger()).claimable)).toBe(2n * claimEach);
  const aliceBefore = BigInt((await player(alice)).credit);
  const bobBefore = BigInt((await player(bob)).credit);
  const vault = BigInt((await team())!.vault);
  await page.getByRole('button', { name: 'Withdraw my share', exact: true }).click();
  await expect.poll(async () => BigInt((await player(alice)).credit)).toBe(aliceBefore + vault / 3n);
  await secondPage.goto('/play/team/crew');
  await secondPage.getByRole('button', { name: 'Withdraw my share', exact: true }).click();
  await expect.poll(async () => BigInt((await player(bob)).credit)).toBe(bobBefore + vault - vault / 3n);
  expect(BigInt((await team())!.vault)).toBe(0n);
  expect(BigInt((await team())!.weight)).toBe(0n);
  expect(BigInt((await ledger()).vault)).toBe(0n);
  await secondPage.getByRole('button', { name: 'Leave team', exact: true }).click();
  await expect.poll(async () => (await player(bob)).team_id).toBeNull();
  await page.getByRole('button', { name: 'Leave team', exact: true }).click();
  await expect.poll(team).toBeNull();
  expect((await player(alice)).team_id).toBeNull();
  // Observe actual chain time at the next scheduled slot; blocks are not elapsed seconds.
  await control({ op: 'enterNextSlot', mode: 1 });
  await control({ op: 'startTeam' });
  const latest = (await view('get_round', { mode: 1, id: null })) as { round_id: number };
  expect(latest.round_id).toBeGreaterThan(0);
  for (const [p, account] of [
    [page, alice],
    [secondPage, bob],
  ] as const) {
    await p.goto('/play/team/crew');
    const claims = p.getByRole('heading', { name: 'After the round' }).locator('..');
    await expect(claims.getByText(`Team round ${latest.round_id} ·`, { exact: false })).toBeVisible();
    await claims.getByText('Use another round or team').click();
    await claims.getByLabel('Round id', { exact: true }).fill('4294967296');
    await claims.getByLabel('Team id', { exact: true }).fill('0');
    await expect(claims.getByRole('button', { name: 'Claim my reward', exact: true })).toBeDisabled();
    await claims.getByLabel('Round id', { exact: true }).fill('0');
    await expect(claims.getByText('Team round 0 ·', { exact: false })).toBeVisible();
    await claims.getByLabel('Team id', { exact: true }).fill('4294967296');
    await expect(claims.getByRole('button', { name: 'Claim my reward', exact: true })).toBeDisabled();
    await claims.getByLabel('Round id', { exact: true }).fill('0');
    await claims.getByLabel('Team id', { exact: true }).fill('0');
    const before = BigInt((await player(account)).credit);
    await claims.getByRole('button', { name: 'Claim my reward', exact: true }).click();
    await expect.poll(async () => BigInt((await player(account)).credit)).toBe(before + claimEach);
    await expect(
      claims.getByText(
        'Reward added to your play credit. Withdraw credit separately to move it to your wallet.',
      ),
    ).toBeVisible();
    await claims.getByRole('button', { name: 'Claim my reward', exact: true }).click();
    await expect(claims.getByRole('alert')).toBeVisible();
    expect(BigInt((await player(account)).credit)).toBe(before + claimEach);
  }
  expect(BigInt((await ledger()).claimable)).toBe(0n);
});
