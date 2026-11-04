import { Account, JsonRpcProvider, KeyPair, encodeTransaction, actions } from 'near-api-js';

// Isolated, in-process stub: this harness never contacts a NEAR network.
export default {
  async fetch(): Promise<Response> {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const rpc = await request.json() as { id: number; method: string };
      calls++;
      if (rpc.method === 'block') return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { header: { hash: '11111111111111111111111111111111', height: 1 } } });
      if (rpc.method === 'query') return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { nonce: 1, permission: 'FullAccess', block_hash: '11111111111111111111111111111111', block_height: 1 } });
      throw new Error(`unexpected method ${rpc.method}`);
    };
    try {
      const key = KeyPair.fromRandom('ed25519');
      const account = new Account('keeper.testnet', new JsonRpcProvider({ url: 'http://stub.invalid' }), key.toString());
      const signed = await account.createSignedTransaction({ receiverId: 'game.testnet', actions: [actions.functionCall('advance', { mode: 0 }, 30000000000000n, 0n)] });
      const bytes = encodeTransaction(signed);
      return Response.json({ calls, serialized_bytes: bytes.length, signature_bytes: signed.signature.data.length, crypto: typeof crypto.subtle, fetch: typeof original, ok: calls > 0 && bytes.length > 0 });
    } finally { globalThis.fetch = original; }
  },
};
