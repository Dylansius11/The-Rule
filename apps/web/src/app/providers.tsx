import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getConnector } from '@/chain/connector';
import { connectWallet } from '@/chain/session/connect';
import { attach, detach } from '@/chain/session/state';
import { SoundProvider } from '@/audio';
import type { WalletState } from '@/game/types';

type WalletContextValue = WalletState & { connect(): Promise<void>; disconnect(): Promise<void> };
const WalletContext = createContext<WalletContextValue | null>(null);
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true } },
});
function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({ status: 'loading', accountId: null });
  useEffect(() => {
    const connector = getConnector();
    const signedIn = (event: { accounts: { accountId: string }[] }) => {
      const accountId = event.accounts[0]?.accountId ?? null;
      setState({ status: 'connected', accountId });
      if (accountId) void attach(accountId);
    };
    const signedOut = () => {
      setState({ status: 'disconnected', accountId: null });
      void detach();
    };
    connector.on('wallet:signIn', signedIn);
    connector.on('wallet:signOut', signedOut);
    connector.whenManifestLoaded
      .then(() => connector.getConnectedWallet())
      .then(({ accounts }) => (accounts.length ? signedIn({ accounts }) : signedOut()))
      .catch(signedOut);
    return () => {
      connector.off('wallet:signIn', signedIn);
      connector.off('wallet:signOut', signedOut);
    };
  }, []);
  async function connect() {
    setState(s => ({ ...s, status: 'connecting' }));
    try {
      const connector = getConnector();
      await connector.whenManifestLoaded;
      const wallet = await connectWallet(connector);
      const accounts = await wallet.getAccounts();
      setState({
        status: accounts.length ? 'connected' : 'disconnected',
        accountId: accounts[0]?.accountId ?? null,
      });
    } catch (error) {
      setState({ status: 'disconnected', accountId: null });
      throw error;
    }
  }
  async function disconnect() {
    await getConnector().disconnect();
    setState({ status: 'disconnected', accountId: null });
  }
  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect }}>{children}</WalletContext.Provider>
  );
}
export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error('Wallet provider missing');
  return value;
}
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SoundProvider>
        <WalletProvider>{children}</WalletProvider>
      </SoundProvider>
    </QueryClientProvider>
  );
}
