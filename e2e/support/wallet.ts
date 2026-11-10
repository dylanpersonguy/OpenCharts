/**
 * A fake EIP-1193 browser wallet (announced through EIP-6963 and also set as
 * `window.ethereum`) whose private key lives in the TEST process. The page
 * only ever sees addresses and signatures. `eth_signTypedData_v4` produces
 * REAL signatures, and, like MetaMask, refuses to sign when the typed-data
 * chainId differs from the wallet's active chain.
 *
 * The key below is the public Hardhat/Anvil account #0 test key. It controls
 * nothing of value anywhere. Never replace it with a real key.
 */
import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

export const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export interface WalletRequest {
  method: string;
  params: unknown[];
  /** For eth_signTypedData_v4: the parsed typed data. */
  typedData?: {
    domain: { chainId?: number | string; name?: string };
    primaryType: string;
    message: Record<string, unknown>;
  };
}

interface WalletReply {
  result?: unknown;
  error?: { code: number; message: string };
}

export class TestWallet {
  readonly account = privateKeyToAccount(TEST_PRIVATE_KEY);
  readonly requests: WalletRequest[] = [];
  /** Active chain (hex). Starts on Ethereum mainnet so the app must ask for a switch. */
  chain = "0x1";
  /** When set, the next signature request is rejected like a user clicking "Reject". */
  rejectNextSignature = false;

  get address(): string {
    return this.account.address.toLowerCase();
  }

  signed(primaryType: string): WalletRequest[] {
    return this.requests.filter((r) => r.method === "eth_signTypedData_v4" && r.typedData?.primaryType === primaryType);
  }

  private async handle(method: string, params: unknown[]): Promise<WalletReply> {
    const entry: WalletRequest = { method, params };
    this.requests.push(entry);
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return { result: [this.account.address] };
      case "eth_chainId":
        return { result: this.chain };
      case "net_version":
        return { result: String(parseInt(this.chain, 16)) };
      case "wallet_switchEthereumChain": {
        const id = (params[0] as { chainId?: string } | undefined)?.chainId;
        if (!id) return { error: { code: -32602, message: "chainId missing" } };
        this.chain = id;
        return { result: null };
      }
      case "eth_signTypedData_v4": {
        const typed = JSON.parse(String(params[1])) as {
          domain: { chainId?: number | string; name?: string };
          types: Record<string, Array<{ name: string; type: string }>>;
          primaryType: string;
          message: Record<string, unknown>;
        };
        entry.typedData = { domain: typed.domain, primaryType: typed.primaryType, message: typed.message };
        if (this.rejectNextSignature) {
          this.rejectNextSignature = false;
          return { error: { code: 4001, message: "User rejected the request." } };
        }
        if (Number(typed.domain.chainId) !== parseInt(this.chain, 16)) {
          return {
            error: {
              code: -32603,
              message: `Provided chainId "${String(typed.domain.chainId)}" must match the active chainId "${parseInt(this.chain, 16)}"`,
            },
          };
        }
        const { EIP712Domain: _unused, ...types } = typed.types;
        void _unused;
        const signature = await this.account.signTypedData({
          domain: typed.domain,
          types,
          primaryType: typed.primaryType,
          message: typed.message,
        } as never);
        return { result: signature };
      }
      default:
        return { error: { code: -32601, message: `unsupported method ${method}` } };
    }
  }

  async install(page: Page): Promise<void> {
    await page.exposeFunction("__e2eWallet", (method: string, params: unknown[]) => this.handle(method, params ?? []));
    await page.addInitScript(() => {
      const call = (window as unknown as { __e2eWallet: (m: string, p: unknown[]) => Promise<WalletReply> }).__e2eWallet;
      const provider = {
        isE2EWallet: true,
        async request(args: { method: string; params?: unknown[] }) {
          const r = await call(args.method, args.params ?? []);
          if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
          return r.result;
        },
        on() {},
        removeListener() {},
      };
      (window as unknown as { ethereum: unknown }).ethereum = provider;
      const info = {
        uuid: "e2e-wallet-0001",
        name: "E2E Wallet",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        rdns: "test.e2e.wallet",
      };
      const announce = () =>
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });
  }
}
