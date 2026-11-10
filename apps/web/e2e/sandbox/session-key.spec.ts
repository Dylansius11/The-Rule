import { JsonRpcProvider } from 'near-api-js';
import type { Page } from '@playwright/test';
import { test, expect, walletCalls } from '../support/sandbox';

// Sandbox with mock OutLayer, not testnet evidence. The browser signs plays with its own function-call
// key against a real local NEAR chain; only the wallet popup is a bridge.
const publicKeyInBrowser = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('the-rule-session');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('keys').objectStore('keys').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            const record: { publicKey: string } = all.result[0];
            resolve(record.publicKey);
          };
        };
      }),
  );

test('session key: one approval, then plays sign locally; deposits stay with the wallet; a dead key falls back once', async ({
  page,
  actor,
  sandbox,
  control,
  view,
}) => {
  test.setTimeout(240_000);
  const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
  const allowanceOf = async (publicKey: string) => {
    const key = await provider.viewAccessKey({ accountId: actor.accountId, publicKey });
    if (typeof key.permission === 'string' || !('FunctionCall' in key.permission))
      throw new Error('Not a function-call key');
    return BigInt(key.permission.FunctionCall.allowance!);
  };
  const credit = async () => {
    const player = (await view('get_player', { account: actor.accountId })) as { credit: string };
    return BigInt(player.credit);
  };
  const log = async () => (await view('get_log', { mode: 0, id: 0, from_idx: 0, limit: 200 })) as unknown[];
  const stamp = async () => {
    await page.getByRole('button', { name: /STAMP!/ }).click();
    await expect(page.getByText('Waiting for the sealed program.', { exact: true }).first()).toBeVisible();
    await control({ op: 'resolve' });
    await expect(page.getByText(/the fee joined the pot|YES, logged/).first()).toBeVisible();
  };

  await control({ op: 'startSolo' });
  await control({ op: 'sameMinuteWindow' });

  await test.step('connect: with no key yet the panel offers one approval', async () => {
    await page.goto('/account');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Session key' });
    await expect(panel.getByText('Off', { exact: true })).toBeVisible();
    await expect(panel.getByText(/No session key on this device/)).toBeVisible();
    expect(walletCalls(page)).toEqual([]);
  });

  await test.step('the wallet is asked for the deposit, as always', async () => {
    await page.getByLabel('Deposit', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Deposit credit', exact: true }).click();
    await expect(page.getByText(/Deposit transaction accepted/)).toBeVisible();
    expect(walletCalls(page)).toEqual([`${sandbox.game}.deposit_credit`]);
  });

  let publicKey = '';
  let allowanceBefore = 0n;
  await test.step('one approval adds a game-scoped key with the declared methods and allowance', async () => {
    const panel = page.getByRole('region', { name: 'Session key' });
    await panel.getByRole('button', { name: 'Enable session key (one approval)' }).click();
    await expect(panel.getByText('Active', { exact: true })).toBeVisible();
    publicKey = await publicKeyInBrowser(page);
    const onChain = await provider.viewAccessKey({ accountId: actor.accountId, publicKey });
    expect(onChain.permission).toMatchObject({
      FunctionCall: {
        receiver_id: sandbox.game,
        method_names: expect.arrayContaining(['play', 'commit_guess', 'reveal_guess', 'claim']),
      },
    });
    const permission = onChain.permission;
    if (typeof permission === 'string' || !('FunctionCall' in permission))
      throw new Error('Not a function-call key');
    const methods = permission.FunctionCall.method_names;
    // Nothing that carries a deposit or touches the token is ever granted.
    for (const forbidden of [
      'deposit_credit',
      'withdraw_credit',
      'unlock',
      'team_deposit',
      'ft_transfer_call',
    ])
      expect(methods).not.toContain(forbidden);
    allowanceBefore = await allowanceOf(publicKey);
    expect(walletCalls(page)).toEqual([`${sandbox.game}.deposit_credit`, `${actor.accountId}.AddKey`]);
  });

  await test.step('plays sign in the browser: no wallet call, real verdict, allowance debited', async () => {
    await page.goto('/play/solo');
    const creditBefore = await credit();
    await stamp();
    expect(await log()).toHaveLength(1);
    expect(await credit()).toBeLessThan(creditBefore);
    expect(walletCalls(page)).toEqual([`${sandbox.game}.deposit_credit`, `${actor.accountId}.AddKey`]);
    const burned = allowanceBefore - (await allowanceOf(publicKey));
    console.log(`SESSION KEY: one 300 Tgas play debited ${burned} yoctoNEAR of allowance (sandbox)`);
    expect(burned).toBeGreaterThan(0n);
    expect(burned).toBeLessThan(40_000_000_000_000_000_000_000n);
  });

  await test.step('a second deposit still goes to the wallet while the key is active', async () => {
    await page.goto('/account');
    await page.getByLabel('Deposit', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Deposit credit', exact: true }).click();
    await expect(page.getByText(/Deposit transaction accepted/)).toBeVisible();
    expect(walletCalls(page).at(-1)).toBe(`${sandbox.game}.deposit_credit`);
  });

  await test.step('revoked behind the app’s back: the next play tells the player and asks the wallet once', async () => {
    await actor.deleteKey(publicKey);
    // In-app navigation keeps the page alive, so the app still believes the key is active.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Play' }).click();
    await page.getByRole('button', { name: '+1', exact: true }).click();
    const before = walletCalls(page).length;
    await stamp();
    expect(walletCalls(page).slice(before)).toEqual([`${sandbox.game}.play`]);
    await expect(page.getByRole('alert').filter({ hasText: /Nothing was sent/ })).toBeVisible();
    expect(await log()).toHaveLength(2);
    await page.goto('/account');
    const panel = page.getByRole('region', { name: 'Session key' });
    await expect(panel.getByText('Off', { exact: true })).toBeVisible();
    await expect(panel.getByText(/No session key on this device/)).toBeVisible();
  });

  await test.step('sign-out deletes the key from the browser', async () => {
    await page.getByRole('button', { name: 'Enable session key (one approval)' }).click();
    await expect(
      page.getByRole('region', { name: 'Session key' }).getByText('Active', { exact: true }),
    ).toBeVisible();
    const fresh = await publicKeyInBrowser(page);
    expect(fresh).not.toBe(publicKey);
    await page.getByRole('button', { name: 'Disconnect' }).first().click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<number>(resolve => {
              const open = indexedDB.open('the-rule-session');
              open.onsuccess = () => {
                const count = open.result.transaction('keys').objectStore('keys').count();
                count.onsuccess = () => resolve(count.result);
              };
            }),
        ),
      )
      .toBe(0);
  });
});
