import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { createWalletClient, custom, recoverTypedDataAddress, type WalletClient } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import type { Address, HlNetwork } from "../config.ts";
import type { Eip1193Provider } from "./providers.ts";

/** The subset of the SDK info API this module depends on (mockable in tests). */
export type HlInfoApi = Pick<
  InfoClient,
  "extraAgents" | "maxBuilderFee" | "clearinghouseState" | "spotClearinghouseState" | "userAbstraction"
>;

export function createInfoApi(network: HlNetwork): HlInfoApi {
  return new InfoClient({ transport: new HttpTransport({ isTestnet: network === "testnet" }) });
}

/**
 * Chain used for user-signed EIP-712 actions. HL's docs use Arbitrum (0xa4b1 on
 * mainnet, 0x66eee = Arbitrum Sepolia on testnet). The signature domain's
 * chainId must match the wallet's active chain, so we switch the wallet there.
 */
export function signatureChain(network: HlNetwork) {
  return network === "mainnet" ? arbitrum : arbitrumSepolia;
}
export const signatureChainIdHex = (network: HlNetwork): `0x${string}` =>
  `0x${signatureChain(network).id.toString(16)}`;

export function createWalletClientFor(provider: Eip1193Provider, account: Address, network: HlNetwork): WalletClient {
  return createWalletClient({
    account,
    chain: signatureChain(network),
    transport: custom(provider as Parameters<typeof custom>[0]),
  });
}

/**
 * Minimal viem-JSON-RPC-shaped wallet for the SDK: signs EIP-712 through the
 * browser wallet's `eth_signTypedData_v4`. The main key never leaves the wallet.
 */
export function createBrowserSigner(provider: Eip1193Provider, account: Address) {
  return {
    signTypedData: async (params: {
      domain: unknown;
      types: unknown;
      primaryType: string;
      message: unknown;
    }): Promise<`0x${string}`> => {
      const sig = await provider.request({
        method: "eth_signTypedData_v4",
        params: [
          account,
          JSON.stringify({
            domain: params.domain,
            types: params.types,
            primaryType: params.primaryType,
            message: params.message,
          }),
        ],
      });
      if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error("Wallet returned an invalid signature.");
      // Hyperliquid acts for whoever the signature recovers to. Make sure that is the account the user
      // is connected as, so a misbehaving wallet can never authorise an action for a different account.
      const recovered = await recoverTypedDataAddress({
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
        signature: sig as `0x${string}`,
      } as unknown as Parameters<typeof recoverTypedDataAddress>[0]).catch(() => null);
      if (!recovered || recovered.toLowerCase() !== account.toLowerCase())
        throw new Error("The signature came from a different account than the one connected. Nothing was sent.");
      return sig as `0x${string}`;
    },
    getAddresses: (): Promise<`0x${string}`[]> => Promise.resolve([account]),
    getChainId: async (): Promise<number> => {
      const hex = await provider.request({ method: "eth_chainId" });
      return typeof hex === "string" ? parseInt(hex, 16) : 0;
    },
  };
}

/** SDK ExchangeClient where the MAIN wallet (browser wallet) signs user-signed actions. */
export function createUserExchange(
  provider: Eip1193Provider,
  account: Address,
  network: HlNetwork,
  signatureChainId: `0x${string}`,
) {
  return new ExchangeClient({
    transport: new HttpTransport({ isTestnet: network === "testnet" }),
    wallet: createBrowserSigner(provider, account),
    signatureChainId,
  });
}
