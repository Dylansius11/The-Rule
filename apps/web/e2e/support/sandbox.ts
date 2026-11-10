// Sandbox with mock OutLayer, not testnet evidence. No secret key ever enters the browser.
import { test as base, expect, type Page } from '@playwright/test';
import { Account, JsonRpcProvider, actions, type KeyPairString } from 'near-api-js';
import { readConfig, type SandboxConfig } from './global-setup';

type WalletTransaction = {
  receiverId: string;
  actions: {
    type: string;
    params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
  }[];
};
export async function configureSandboxPage(page: Page, sandbox: SandboxConfig, actor: Account) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/rpc$/.test(sandbox.rpcUrl) || sandbox.networkId !== 'sandbox')
    throw new Error('Signing is restricted to the isolated sandbox');
  const account = sandbox.accounts.find(candidate => candidate.accountId === actor.accountId);
  if (!account) throw new Error('Sandbox player missing');
  const signer = new Account(
    account.accountId,
    new JsonRpcProvider({ url: sandbox.rpcUrl }),
    account.secretKey as KeyPairString,
  );
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.protocol === 'data:' || url.protocol === 'blob:')
      return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.exposeFunction('__sandboxSign', async (transaction: WalletTransaction) => {
    if (![sandbox.game, sandbox.token].includes(transaction.receiverId))
      throw new Error('Receiver outside fixture');
    const result = await signer.signAndSendTransaction({
      // A yielded mock descendant must not delay the wallet's root game acknowledgement.
      waitUntil: 'INCLUDED_FINAL',
      throwOnFailure: false,
      receiverId: transaction.receiverId,
      actions: transaction.actions.map(action => {
        if (action.type !== 'FunctionCall') throw new Error('Only function calls are allowed');
        const { methodName, args, gas, deposit } = action.params;
        return actions.functionCall(methodName, args, BigInt(gas), BigInt(deposit));
      }),
    });
    const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
    let observed = result;
    for (let poll = 0; poll < 100; poll++) {
      const receiptId = observed.transaction_outcome?.outcome.receipt_ids[0];
      const receipt = observed.receipts_outcome?.find(item => item.id === receiptId);
      if (
        receipt &&
        typeof receipt.outcome.status === 'object' &&
        ('SuccessValue' in receipt.outcome.status || 'Failure' in receipt.outcome.status)
      ) {
        const receiptBlock = await provider.viewBlock({ blockId: receipt.block_hash });
        const finalBlock = await provider.viewBlock({ finality: 'final' });
        if (finalBlock.header.height < receiptBlock.header.height) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        // NEAR Connect-shaped result, using the actual root receipt (not a mock success).
        return JSON.parse(
          JSON.stringify({ ...observed, status: receipt.outcome.status }, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
        );
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      observed = await provider.viewTransactionStatusWithReceipts({
        txHash: result.transaction.hash,
        accountId: actor.accountId,
        waitUntil: 'INCLUDED_FINAL',
      });
    }
    throw new Error('Sandbox root action receipt did not complete');
  });
  await page.addInitScript(
    ({ rpcUrl, game, token, accountId }) => {
      localStorage.setItem('the-rule:guide-seen', '1');
      localStorage.setItem(
        'the-rule:sound',
        JSON.stringify({ enabled: false, volume: 0.6, music: { enabled: false, volume: 0.3 } }),
      );
      const browser = globalThis as typeof globalThis & {
        __THE_RULE_E2E__?: unknown;
        __sandboxSign(transaction: unknown): Promise<unknown>;
      };
      const listeners = new Map<string, Set<(value: unknown) => void>>();
      const accounts = () => [{ accountId }];
      const wallet = {
        getAccounts: async () => accounts(),
        signAndSendTransaction: (transaction: unknown) => browser.__sandboxSign(transaction),
      };
      browser.__THE_RULE_E2E__ = {
        rpcUrl,
        game,
        token,
        connector: {
          whenManifestLoaded: Promise.resolve(),
          on: (event: string, fn: (value: unknown) => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(fn);
          },
          off: (event: string, fn: (value: unknown) => void) => listeners.get(event)?.delete(fn),
          getConnectedWallet: async () => ({
            accounts: sessionStorage.getItem('sandbox-connected') ? accounts() : [],
          }),
          connect: async () => {
            sessionStorage.setItem('sandbox-connected', '1');
            for (const fn of listeners.get('wallet:signIn') ?? []) fn({ accounts: accounts() });
            return wallet;
          },
          wallet: async () => {
            if (!sessionStorage.getItem('sandbox-connected')) throw new Error('Wallet disconnected');
            return wallet;
          },
          disconnect: async () => {
            sessionStorage.removeItem('sandbox-connected');
            for (const fn of listeners.get('wallet:signOut') ?? []) fn({});
          },
        },
      };
    },
    { rpcUrl: sandbox.rpcUrl, game: sandbox.game, token: sandbox.token, accountId: actor.accountId },
  );
}

export const test = base.extend<{
  sandbox: SandboxConfig;
  actor: Account;
  control(command: object): Promise<unknown>;
  view(method: string, args?: Record<string, unknown>, contractId?: string): Promise<unknown>;
  secondPage: Page;
}>({
  sandbox: async ({}, use) => {
    await use(await readConfig());
  },
  actor: async ({ sandbox }, use) => {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/rpc$/.test(sandbox.rpcUrl) || sandbox.networkId !== 'sandbox')
      throw new Error('Signing is restricted to the isolated sandbox');
    const account = sandbox.accounts[0];
    if (!account) throw new Error('Sandbox player missing');
    await use(
      new Account(
        account.accountId,
        new JsonRpcProvider({ url: sandbox.rpcUrl }),
        account.secretKey as KeyPairString,
      ),
    );
  },
  control: async ({ sandbox }, use) => {
    await use(async command => {
      const response = await fetch(sandbox.controlUrl, { method: 'POST', body: JSON.stringify(command) });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error ?? 'Harness control failed');
      return body.result;
    });
  },
  view: async ({ sandbox }, use) => {
    const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
    await use((method, args = {}, contractId = sandbox.game) =>
      provider.callFunction({ contractId, method, args }),
    );
  },
  page: async ({ page, sandbox, actor }, use) => {
    await configureSandboxPage(page, sandbox, actor);
    await use(page);
  },
  secondPage: async ({ browser, sandbox, baseURL }, use) => {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/rpc$/.test(sandbox.rpcUrl) || sandbox.networkId !== 'sandbox')
      throw new Error('Signing is restricted to the isolated sandbox');
    const account = sandbox.accounts[1];
    if (!account) throw new Error('Second sandbox player missing');
    const actor = new Account(
      account.accountId,
      new JsonRpcProvider({ url: sandbox.rpcUrl }),
      account.secretKey as KeyPairString,
    );
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await configureSandboxPage(page, sandbox, actor);
      await use(page);
    } finally {
      await context.close();
    }
  },
});
export { expect };
