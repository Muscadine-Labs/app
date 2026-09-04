/** Base.dev app id — verified via `<meta name="base:app_id">` in root layout. */
export const BASE_APP_ID = '6925cdc1547fca5d08131407';

/** Canonical product name for document title, Base.dev, Reown AppKit, and WalletConnect. */
export const APP_NAME = 'Muscadine Vaults';

type EthereumFlag = {
  isCoinbaseBrowser?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: EthereumFlag[];
};

function readEthereum(): EthereumFlag | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { ethereum?: EthereumFlag }).ethereum;
}

/**
 * True inside Coinbase / Base App in-app browsers (injected provider, not a
 * Farcaster mini-app host). Used to skip WalletConnect overlays that can
 * leave the WebView blank.
 */
export function isBaseAppWebView(): boolean {
  if (typeof window === 'undefined') return false;

  const ethereum = readEthereum();
  if (ethereum?.isCoinbaseBrowser) return true;
  if (ethereum?.providers?.some((provider) => provider.isCoinbaseBrowser)) {
    return true;
  }

  const ua = window.navigator.userAgent ?? '';
  return /CoinbaseWallet|CoinbaseBrowser|BaseApp/i.test(ua);
}

/** Prefer the injected Base/Coinbase wallet over WalletConnect in Base App. */
export function pickBaseAppConnector<
  T extends { id: string; type?: string; name?: string },
>(connectors: readonly T[]): T | undefined {
  const id = (value: string) =>
    connectors.find((connector) => connector.id.toLowerCase() === value);

  return (
    id('coinbasewalletsdk') ||
    id('baseaccount') ||
    connectors.find((connector) =>
      /coinbase/i.test(`${connector.id} ${connector.name ?? ''}`)
    ) ||
    connectors.find(
      (connector) => connector.id === 'injected' || connector.type === 'injected'
    )
  );
}
