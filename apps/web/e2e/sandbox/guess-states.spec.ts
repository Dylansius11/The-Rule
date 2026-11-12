import { test, expect } from '../support/sandbox';

type Commit = {
  commit_seq: number;
  actor: string;
  hash: string;
  stake: string;
  status: string;
};
type Player = { credit: string; checking_guesses: number };
type Ledger = { open_stakes: string; round_pots: string };

// One invocation starts one fresh sandbox. The mock OutLayer executes the local rule; this is not testnet evidence.
test('browser guesses move through Wrong, Refunded and Unrevealed with exact stake accounting', async ({
  page,
  control,
  view,
  actor,
}) => {
  test.setTimeout(240_000);
  const commits = async () =>
    (await view('get_commits', { mode: 0, id: 0, from: 0, limit: 200 })) as Commit[];
  const player = async () => (await view('get_player', { account: actor.accountId })) as Player;
  const ledger = async () => (await view('get_ledger')) as Ledger;
  const params = (await view('get_params')) as { storage_charge_per_play: string; wrong_return_bps: number };
  const storage = BigInt(params.storage_charge_per_play);
  const card = (seq: number) => page.getByRole('listitem').filter({ hasText: `commit #${seq}` });

  await control({ op: 'startSolo' });
  await page.goto('/play/solo');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
  await page.goto('/account');
  await page.getByLabel('Deposit', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Deposit credit', exact: true }).click();
  await expect(
    page.getByText('Deposit transaction accepted. Your game credit above updates when the chain shows it.'),
  ).toBeVisible();
  const funded = BigInt((await player()).credit);
  expect(funded).toBeGreaterThan(0n);

  await page.goto('/play/solo/guess');
  await page
    .getByRole('radiogroup', { name: 'Rule shape' })
    .getByRole('radio', { name: 'Single', exact: true })
    .click();
  // Fixture rule is atom 0 (number is even); its opposite is necessarily wrong.
  await page.getByRole('radiogroup', { name: 'Atom atoms', exact: true }).getByRole('radio').first().click();
  await page.getByRole('button', { name: 'Use the opposite', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  for (let count = 1; count <= 3; count++) {
    await page.getByRole('button', { name: 'Seal & commit', exact: true }).click();
    await expect.poll(async () => (await commits()).length).toBe(count);
    await expect(
      page.getByText(
        'Committed. Your guess is a hash on chain now. Reveal it in step 3 after the minimum delay.',
      ),
    ).toBeVisible();
  }
  const sealed = await commits();
  expect(sealed.map(c => c.commit_seq)).toEqual([0, 1, 2]);
  expect(sealed.map(c => c.status)).toEqual(['Committed', 'Committed', 'Committed']);
  expect(sealed.every(c => c.actor === actor.accountId)).toBe(true);
  expect(new Set(sealed.map(c => c.hash)).size).toBe(3);
  const stakes = sealed.map(c => BigInt(c.stake));
  const sum = stakes.reduce((a, b) => a + b, 0n);
  expect(BigInt((await player()).credit)).toBe(funded - sum - 3n * storage);
  expect(BigInt((await ledger()).open_stakes)).toBe(sum);

  await control({ op: 'advance', blocks: 5 });
  await page.getByRole('button', { name: 'Skip to reveal', exact: true }).click();
  for (let seq = 0; seq < 3; seq++)
    await expect(card(seq).getByText('Committed', { exact: true })).toBeVisible();

  const creditBeforeWrong = BigInt((await player()).credit);
  const beforeWrong = await ledger();
  await card(0).getByRole('button', { name: 'Reveal this guess', exact: true }).click();
  await expect.poll(async () => (await commits())[0]?.status).toBe('Checking');
  await expect(card(0).getByText('Checking', { exact: true })).toBeVisible();
  expect((await player()).checking_guesses).toBe(1);
  expect(BigInt((await player()).credit)).toBe(creditBeforeWrong);
  await control({ op: 'resolve' });
  await expect.poll(async () => (await commits())[0]?.status).toBe('Wrong');
  await expect(card(0).getByText('Wrong', { exact: true })).toBeVisible();
  const wrongReturn = (stakes[0]! * BigInt(params.wrong_return_bps)) / 10_000n;
  expect(BigInt((await player()).credit)).toBe(creditBeforeWrong + wrongReturn);
  expect((await player()).checking_guesses).toBe(0);
  const afterWrong = await ledger();
  expect(BigInt(afterWrong.open_stakes)).toBe(BigInt(beforeWrong.open_stakes) - stakes[0]!);
  expect(BigInt(afterWrong.round_pots)).toBe(BigInt(beforeWrong.round_pots) + stakes[0]! - wrongReturn);

  const creditBeforeRefund = BigInt((await player()).credit);
  await card(1).getByRole('button', { name: 'Reveal this guess', exact: true }).click();
  await expect.poll(async () => (await commits())[1]?.status).toBe('Checking');
  await expect(card(1).getByText('Checking', { exact: true })).toBeVisible();
  expect((await player()).checking_guesses).toBe(1);
  expect(BigInt((await player()).credit)).toBe(creditBeforeRefund);
  await control({ op: 'resolve', fail: true });
  await expect.poll(async () => (await commits())[1]?.status).toBe('Refunded');
  await expect(card(1).getByText('Refunded', { exact: true })).toBeVisible();
  await expect(card(1).getByRole('button', { name: 'Reveal this guess', exact: true })).toHaveCount(0);
  expect(BigInt((await player()).credit)).toBe(creditBeforeRefund + stakes[1]!);
  expect((await player()).checking_guesses).toBe(0);
  const afterRefund = await ledger();
  expect(BigInt(afterRefund.open_stakes)).toBe(BigInt(afterWrong.open_stakes) - stakes[1]!);
  expect(afterRefund.round_pots).toBe(afterWrong.round_pots);

  const creditBeforeSweep = BigInt((await player()).credit);
  await control({ op: 'enterReveal', mode: 0, roundId: 0 });
  await expect
    .poll(async () => {
      const round = await view('get_round', { mode: 0, id: 0 });
      return round && typeof round === 'object' && 'phase' in round ? round.phase : null;
    })
    .toBe('Reveal');
  expect((await commits())[2]?.status).toBe('Committed');
  await control({ op: 'settle', mode: 0, roundId: 0 });
  await expect
    .poll(async () => {
      const round = await view('get_round', { mode: 0, id: 0 });
      return round && typeof round === 'object' && 'phase' in round ? round.phase : null;
    })
    .toBe('Settled');
  await expect
    .poll(async () => (await commits()).map(c => c.status))
    .toEqual(['Wrong', 'Refunded', 'Unrevealed']);
  await expect(card(2).getByText('Unrevealed', { exact: true })).toBeVisible();
  await expect(card(2).getByRole('button', { name: 'Reveal this guess', exact: true })).toHaveCount(0);
  const unrevealedReturn = (stakes[2]! * BigInt(params.wrong_return_bps)) / 10_000n;
  expect(BigInt((await player()).credit)).toBe(creditBeforeSweep + unrevealedReturn);
  expect(BigInt((await ledger()).open_stakes)).toBe(0n);
});
