/** EIP-1193 provider + EIP-6963 multi-wallet discovery. No wallet SDK; just the browser standards. */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
}

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

/** Legacy `window.ethereum` surfaced in the same shape as a discovered wallet. */
export const INJECTED_INFO: Eip6963ProviderInfo = {
  uuid: "injected",
  name: "Browser wallet",
  icon: "",
  rdns: "injected",
};

function injected(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
}

/**
 * Discover wallets via EIP-6963. Resolves after `waitMs` with every announced
 * wallet, falling back to `window.ethereum` if none announced.
 */
export function discoverWallets(waitMs = 150): Promise<Eip6963ProviderDetail[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  const found = new Map<string, Eip6963ProviderDetail>();
  const onAnnounce = (e: Event): void => {
    const detail = (e as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.info?.uuid && detail.provider) found.set(detail.info.uuid, detail);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return new Promise((resolve) => {
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const list = [...found.values()];
      const legacy = injected();
      if (list.length === 0 && legacy) list.push({ info: INJECTED_INFO, provider: legacy });
      resolve(list);
    }, waitMs);
  });
}
