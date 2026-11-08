import { NearConnector } from '@hot-labs/near-connect';
import { config } from '@/config/env';

let connector: NearConnector | undefined;
export function getConnector(): NearConnector {
  return (connector ??= new NearConnector({
    network: 'testnet',
    providers: { testnet: [...config.rpcUrls] },
  }));
}
export async function sendCall(
  receiverId: string,
  methodName: string,
  args: object,
  deposit = 0n,
  gas = 300_000_000_000_000n,
) {
  if (receiverId !== config.main.game && receiverId !== config.main.token)
    throw new Error('Unsupported transaction receiver');
  const wallet = await getConnector().wallet();
  return wallet.signAndSendTransaction({
    receiverId,
    actions: [
      {
        type: 'FunctionCall',
        params: { methodName, args, gas: gas.toString(), deposit: deposit.toString() },
      },
    ],
  });
}
