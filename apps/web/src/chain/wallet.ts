import { active } from '@/config/env';
import { getConnector, type WalletOutcome } from './connector';
import { routeCall } from './session/policy';
import { markVia, trySend } from './session/state';

/**
 * Send one function call. Zero-deposit game calls on the session-key list sign locally when a usable
 * key exists; everything else, and every fallback, goes to the wallet for approval.
 */
export async function sendCall(
  receiverId: string,
  methodName: string,
  args: object,
  deposit = 0n,
  gas = 300_000_000_000_000n,
): Promise<WalletOutcome> {
  if (receiverId !== active.game && receiverId !== active.token)
    throw new Error('Unsupported transaction receiver');
  if (routeCall({ receiverId, methodName, deposit }, active.game) === 'session') {
    const sent = await trySend({ methodName, args, gas });
    if (sent) return sent;
  }
  markVia('wallet');
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
