import { test, expect } from '../support/sandbox';
import { JsonRpcProvider } from 'near-api-js';

// Real local WASM/receipts with mock OutLayer; never external-wallet/testnet evidence.
test('Account: native completion and genuine applied/rejected token outcomes', async ({
  page,
  secondPage,
  actor,
  sandbox,
  control,
  view,
}) => {
  test.setTimeout(240_000);
  const player = async () =>
    (await view('get_player', { account: actor.accountId })) as {
      credit: string;
      pending_withdrawal: boolean;
    };
  const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
  const finalReceipts = async () => {
    const hash = await page
      .getByRole('button', { name: 'Copy transaction hash', exact: true })
      .last()
      .locator('..')
      .locator('code')
      .getAttribute('title');
    if (!hash) throw new Error('Missing actual initiating transaction hash');
    const result = await provider.viewTransactionStatusWithReceipts({
      txHash: hash,
      accountId: actor.accountId,
      waitUntil: 'FINAL',
    });
    expect(result.final_execution_status).toBe('FINAL');
    return result;
  };
  await page.goto('/account');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByLabel('Deposit', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Deposit credit', exact: true }).click();
  await expect(
    page.getByText('Deposit transaction accepted. Your game credit above updates when the chain shows it.'),
  ).toBeVisible();
  await expect.poll(async () => BigInt((await player()).credit)).toBeGreaterThan(0n);
  const beforeWithdrawal = BigInt((await player()).credit);
  await page.getByLabel('Withdraw', { exact: true }).fill('0.1');
  await page.getByRole('button', { name: 'Withdraw credit', exact: true }).click();
  await expect.poll(async () => (await player()).pending_withdrawal).toBe(false);
  await expect
    .poll(async () => BigInt((await player()).credit))
    .toBe(beforeWithdrawal - 100_000_000_000_000_000_000_000n);
  await expect(page.getByText(/No withdrawal is pending now/)).toBeVisible();

  const registration = page.getByRole('region', { name: 'RULE registration' });
  await registration.getByRole('button', { name: /Pay token storage/ }).click();
  await expect(registration.getByRole('button', { name: 'Confirm RULE registration' })).toBeEnabled();
  await registration.getByRole('button', { name: 'Confirm RULE registration' }).click();
  await expect.poll(() => view('get_token_state', { account: actor.accountId })).toBe('registered');
  await control({ op: 'startSolo' });
  await page.goto('/play/solo');
  // Fixture rule is atom0 (even); the browser submits a real paid play.
  await page.getByRole('button', { name: '+1', exact: true }).click();
  await page.getByRole('button', { name: /STAMP!/ }).click();
  await expect(page.getByText('Waiting for the sealed program.', { exact: true }).first()).toBeVisible();
  await control({ op: 'resolve' });
  await expect(page.getByText(/YES, logged/).first()).toBeVisible();

  type Outcome = { operation: { operation_id: number; account_id: string; amount: string }; status: string };
  const outcomes = async () => {
    const found: Outcome[] = [];
    // This fresh isolated fixture has fewer than16 requests. Discover actual IDs, never fabricate one.
    for (let id = 0; id < 16; id++) {
      const result = (await view('get_operation', { operation_id: id }, sandbox.token)) as Outcome | null;
      if (result?.operation.account_id === actor.accountId) found.push(result);
    }
    return found;
  };
  await expect.poll(async () => (await outcomes()).some(o => o.status === 'applied')).toBe(true);
  const applied = (await outcomes()).find(o => o.status === 'applied')!;
  const balance = await view('ft_balance_of', { account_id: actor.accountId }, sandbox.token);
  expect(BigInt(balance as string)).toBe(BigInt(applied.operation.amount));

  // Genuine race precondition: token storage removed after the game confirmed registration.
  // This is a sandbox-only signed NEP-145 action, not a fabricated token callback/result.
  // RULE forbids force-unregister: transfer the earned balance to the registered game first.
  await actor.callFunction({
    contractId: sandbox.token,
    methodName: 'ft_transfer',
    args: { receiver_id: sandbox.game, amount: balance },
    deposit: 1n,
    gas: 30_000_000_000_000n,
  });
  const unregister = await actor.callFunction({
    contractId: sandbox.token,
    methodName: 'storage_unregister',
    args: { force: false },
    deposit: 1n,
    gas: 30_000_000_000_000n,
  });
  expect(unregister).toBe(true);
  await page.getByRole('button', { name: '+1', exact: true }).click();
  await page.getByRole('button', { name: '+1', exact: true }).click();
  await page.getByRole('button', { name: /STAMP!/ }).click();
  await expect(page.getByText('Waiting for the sealed program.', { exact: true }).first()).toBeVisible();
  await control({ op: 'resolve' });
  await expect
    .poll(async () => (await outcomes()).some(o => o.status === 'receiver_unregistered'))
    .toBe(true);
  const rejected = (await outcomes()).find(o => o.status === 'receiver_unregistered')!;
  expect(await view('get_token_operation', { request_id: rejected.operation.operation_id })).toBeNull();

  const openRecovery = (p: typeof page) =>
    p.getByText('Advanced: recover a stuck RULE operation', { exact: true }).click();
  await page.goto('/account');
  await openRecovery(page);
  await page
    .getByLabel('Operation id (outcome)', { exact: true })
    .fill(String(applied.operation.operation_id));
  await expect(page.getByText('Applied: the token operation completed.', { exact: true })).toBeVisible();
  await page
    .getByLabel('Operation id (outcome)', { exact: true })
    .fill(String(rejected.operation.operation_id));
  await expect(page.getByText(/Rejected: the receiving account was not registered/)).toBeVisible();
  await page.getByLabel('Pending request id', { exact: true }).fill(String(rejected.operation.operation_id));
  await expect(page.getByText(/Not pending now/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry this operation', exact: true })).toHaveCount(0);
  // A genuine failed native callback cannot be released by restoring the export.
  const creditBeforeFault = BigInt((await player()).credit);
  await control({ op: 'callbackFault', kind: 'native' });
  await page.getByLabel('Withdraw', { exact: true }).fill('0.1');
  await page.getByRole('button', { name: 'Withdraw credit', exact: true }).click();
  await expect.poll(async () => (await player()).pending_withdrawal).toBe(true);
  await expect(page.getByRole('region', { name: 'Pending', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw credit', exact: true })).toBeDisabled();
  expect(BigInt((await player()).credit)).toBe(creditBeforeFault - 100_000_000_000_000_000_000_000n);
  const nativeFinal = await finalReceipts();
  expect(JSON.stringify(nativeFinal.receipts_outcome)).toContain('MethodNotFound');
  expect(
    nativeFinal.receipts_outcome.some(
      r => typeof r.outcome.status === 'object' && 'Failure' in r.outcome.status,
    ),
  ).toBe(true);
  await control({ op: 'callbackFault', kind: 'none' });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Pending', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw credit', exact: true })).toBeDisabled();
  expect((await player()).pending_withdrawal).toBe(true);

  // Re-register token storage, then fail only the real mint acknowledgement.
  await registration.getByRole('button', { name: /Pay token storage/ }).click();
  await expect
    .poll(() => view('storage_balance_of', { account_id: actor.accountId }, sandbox.token))
    .not.toBeNull();
  await control({ op: 'callbackFault', kind: 'token' });
  await page.goto('/play/solo');
  for (let step = 0; step < 5; step++) await page.getByRole('button', { name: '+1', exact: true }).click();
  await page.getByRole('button', { name: /STAMP!/ }).click();
  await expect(page.getByText('Waiting for the sealed program.', { exact: true }).first()).toBeVisible();
  await control({ op: 'resolve' });
  await expect(page.getByText(/YES, logged/).first()).toBeVisible();
  await expect.poll(async () => (await outcomes()).filter(o => o.status === 'applied').length).toBe(2);
  const pendingMint = (await outcomes()).find(
    o => o.status === 'applied' && o.operation.operation_id !== applied.operation.operation_id,
  )!;
  const requestId = pendingMint.operation.operation_id;
  await expect.poll(() => view('get_token_operation', { request_id: requestId })).not.toBeNull();
  const mintFinal = await finalReceipts();
  expect(JSON.stringify(mintFinal.receipts_outcome)).toContain('MethodNotFound');
  expect(
    mintFinal.receipts_outcome.some(
      r => typeof r.outcome.status === 'object' && 'Failure' in r.outcome.status,
    ),
  ).toBe(true);
  const mintedBeforeRetry = await view('ft_balance_of', { account_id: actor.accountId }, sandbox.token);
  const supplyBeforeRetry = await view('ft_total_supply', {}, sandbox.token);
  await page.goto('/account');
  await openRecovery(page);
  await page.getByLabel('Pending request id', { exact: true }).fill(String(requestId));
  await page.getByLabel('Operation id (outcome)', { exact: true }).fill(String(requestId));
  await expect(page.getByRole('button', { name: 'Retry this operation', exact: true })).toBeVisible();
  await expect(page.getByText('Applied: the token operation completed.', { exact: true })).toBeVisible();
  await secondPage.goto('/account');
  await secondPage.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await openRecovery(secondPage);
  await secondPage.getByLabel('Pending request id', { exact: true }).fill(String(requestId));
  await expect(
    secondPage.getByText('This operation belongs to another account, so recovery is not offered here.'),
  ).toBeVisible();
  await expect(secondPage.getByRole('button', { name: 'Retry this operation', exact: true })).toHaveCount(0);
  // Acknowledgement recovery replays the same immutable operation, never a second mint.
  await control({ op: 'callbackFault', kind: 'none' });
  await page.getByRole('button', { name: 'Retry this operation', exact: true }).click();
  await expect.poll(() => view('get_token_operation', { request_id: requestId })).toBeNull();
  await expect(page.getByText(/Not pending now/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry this operation', exact: true })).toHaveCount(0);
  expect(await view('ft_balance_of', { account_id: actor.accountId }, sandbox.token)).toBe(mintedBeforeRetry);
  expect(await view('ft_total_supply', {}, sandbox.token)).toBe(supplyBeforeRetry);
  expect((await player()).pending_withdrawal).toBe(true);
  console.log(
    'LOCAL Account: real native completion, permanently unknown native callback failure, remaining-credit YES play, token applied/rejected and same-id pending mint recovery without duplicate mint.',
  );
});
