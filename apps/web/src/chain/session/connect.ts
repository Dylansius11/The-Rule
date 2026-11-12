import type { NearConnector } from '@hot-labs/near-connect';
import { active, e2e } from '@/config/env';
import { generateKey, supportsSessionKeys } from './keystore';
import { SESSION_ALLOWANCE, SESSION_METHODS } from './policy';
import { adoptConnectKey } from './state';

/**
 * Connect a wallet. When the chosen wallet can add a function-call key at sign-in, the same approval
 * also grants the session key; otherwise this is a plain connect and the player can enable the key
 * later with one more approval. The wallet list is never filtered, so no wallet is lost to this.
 */
export async function connectWallet(connector: NearConnector) {
  if (e2e || !(await supportsSessionKeys())) return connector.connect();
  const walletId = await connector.selectWallet();
  const canAddKey =
    connector.wallets.find(wallet => wallet.manifest.id === walletId)?.manifest.features
      .signInWithFunctionCallKey === true;
  if (!canAddKey) return connector.connect({ walletId });
  const key = await generateKey();
  const wallet = await connector.connect({
    walletId,
    addFunctionCallKey: {
      contractId: active.game,
      publicKey: key.publicKey,
      allowMethods: { anyMethod: false, methodNames: [...SESSION_METHODS] },
      gasAllowance: { kind: 'limited', amount: SESSION_ALLOWANCE.toString() },
    },
  });
  const accounts = await wallet.getAccounts();
  if (accounts[0]) await adoptConnectKey(accounts[0].accountId, key);
  return wallet;
}
