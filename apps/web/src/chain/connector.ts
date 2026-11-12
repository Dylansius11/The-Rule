import { NearConnector } from '@hot-labs/near-connect';
import { config, e2e } from '@/config/env';

let connector: NearConnector | undefined;
export function getConnector(): NearConnector {
  if (e2e) return e2e.connector;
  return (connector ??= new NearConnector({
    network: 'testnet',
    providers: { testnet: [...config.rpcUrls] },
  }));
}

/** What the wallet returns for a signed and sent transaction; session-key sends mirror this shape. */
export type WalletOutcome = Awaited<
  ReturnType<Awaited<ReturnType<NearConnector['wallet']>>['signAndSendTransaction']>
>;
