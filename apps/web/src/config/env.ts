/**
 * Public, build-time configuration. Every value is a public account id or URL, never a secret.
 * Defaults point at the key-retaining testnet rehearsal deployment (r2).
 */

export type NetworkId = 'testnet';

/** What a deployment honestly is. The UI label comes from this, never from guesswork. */
export type DeploymentKind =
  /** Production schedule, keys deleted after the ceremony. */
  | 'production'
  /** Compressed schedule, keys retained, published non-demo referee, no preselected rule (D32). */
  | 'rehearsal'
  /** The D17 demo instance: the rule is preselected. Always labeled "Demo Mode - preselected rule". */
  | 'demo';

export interface Deployment {
  kind: DeploymentKind;
  game: string;
  token: string;
}

const env = import.meta.env;

function read(name: string, fallback: string): string {
  const value = env[name] as string | undefined;
  return value && value.trim() !== '' ? value.trim() : fallback;
}

function kind(name: string, fallback: DeploymentKind): DeploymentKind {
  const value = read(name, fallback);
  if (value === 'production' || value === 'rehearsal' || value === 'demo') return value;
  throw new Error(`${name} must be production, rehearsal or demo, got "${value}"`);
}

export const config = {
  network: 'testnet' as NetworkId,
  rpcUrls: [
    read('VITE_RPC_URL', 'https://test.rpc.fastnear.com'),
    read('VITE_RPC_FALLBACK_URL', 'https://rpc.testnet.near.org'),
  ],
  explorerTx: (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`,
  explorerAccount: (account: string) => `https://testnet.nearblocks.io/address/${account}`,
  explorerBlock: (height: number | string) => `https://testnet.nearblocks.io/blocks/${height}`,
  main: {
    kind: kind('VITE_GAME_KIND', 'rehearsal'),
    game: read('VITE_GAME_ACCOUNT', 'game-r2.therule.testnet'),
    token: read('VITE_TOKEN_ACCOUNT', 'token-r2.therule.testnet'),
  } satisfies Deployment,
  /** Absent until the separate preselected-rule demo instance is deployed. */
  demo: ((): Deployment | null => {
    const game = read('VITE_DEMO_GAME_ACCOUNT', '');
    const token = read('VITE_DEMO_TOKEN_ACCOUNT', '');
    return game && token ? { kind: 'demo', game, token } : null;
  })(),
} as const;

export type DeploymentChoice = 'main' | 'demo';

const CHOICE_KEY = 'the-rule:deployment';

function readChoice(): DeploymentChoice {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(CHOICE_KEY) === 'demo'
      ? 'demo'
      : 'main';
  } catch {
    return 'main';
  }
}

/**
 * The deployment this page talks to. Fixed for the page's lifetime: switching reloads,
 * so cached reads from two instances can never mix. Demo is only reachable when configured.
 */
export const active: Deployment = readChoice() === 'demo' && config.demo ? config.demo : config.main;

/** Persist the choice and reload. Throws instead of pretending when no demo instance exists. */
export function chooseDeployment(choice: DeploymentChoice): void {
  if (choice === 'demo' && !config.demo) throw new Error('No demo instance is configured');
  localStorage.setItem(CHOICE_KEY, choice);
  location.reload();
}

/** The exact public label for each deployment kind. Copy is fixed by CLAUDE.md honesty rules. */
export function deploymentLabel(kind: DeploymentKind): string {
  switch (kind) {
    case 'demo':
      return 'Demo Mode - preselected rule';
    case 'rehearsal':
      return 'Testnet rehearsal · keys retained · no preselected rule';
    case 'production':
      return 'Testnet';
  }
}

/** The only trust sentence the product may use. */
export const TRUST_SENTENCE =
  'The deployed program does not disclose the rule before the authorized reveal, under the stated TEE trust model (Intel TDX, OutLayer worker measurements, the CKD keystore).';

/** Replay limit statement, shown wherever replay results are shown. */
export const REPLAY_LIMIT =
  'Replay proves every verdict matches the revealed rule and the round commitment. It does not prove the enclave kept the rule secret during the round.';
