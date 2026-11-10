/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADAPTER?: string;
  readonly VITE_HL_NETWORK?: "mainnet" | "testnet";
  /** Our builder wallet; every order carries it. */
  readonly VITE_HL_BUILDER_ADDRESS?: string;
  /** Builder fee in tenths of a basis point, 0-100 (100 = 0.1%). */
  readonly VITE_HL_BUILDER_FEE?: string;
  /** Optional JSON URL for the remote fee kill switch. */
  readonly VITE_FEE_CONFIG_URL?: string;
  /** Optional URL returning {allowed:boolean,country?:string} for geo-blocking. */
  readonly VITE_GEO_CHECK_URL?: string;
  /** "open" | "closed" (default closed): behaviour when the geo endpoint fails. */
  readonly VITE_GEO_FAIL_MODE?: string;
  /** Comma-separated ISO-3166 alpha-2 codes that are always blocked. */
  readonly VITE_BLOCKED_COUNTRIES?: string;
  /** Wallet-screening endpoint: GET ?address=0x.. -> {allowed:boolean}. Never put vendor keys here. */
  readonly VITE_SCREEN_URL?: string;
  /** "open" | "closed" (default closed): behaviour when screening fails. */
  readonly VITE_SCREEN_FAIL_MODE?: string;
  /** Extra CSP connect-src origins, added at build time. */
  readonly VITE_CSP_EXTRA_CONNECT?: string;
  /** Demo only: "1" allows TradingView in the CSP. Never rendered in Hyperliquid mode. */
  readonly VITE_CSP_ALLOW_TRADINGVIEW?: string;
  /** Legacy demo-backend base URL (non-Hyperliquid builds). */
  readonly VITE_API_URL?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }): void;
  renderButton(element: HTMLElement, options: Record<string, string>): void;
  prompt(): void;
}

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
    };
  };
}
