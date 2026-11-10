import { loadAgent, needsRotation, revokeAgent, type KeyVault } from "../agentKey.ts";
import { getBuilderAddress, getBuilderFeeTenthsBp, getBuilderParam, type Address } from "../config.ts";
import { hlSession, type SessionStatus } from "../session.ts";
import { createInfoApi, type HlInfoApi } from "./clients.ts";
import { humanizeError } from "./errors.ts";
import { walletUi } from "./state.ts";

export interface ResolveDeps {
  info?: HlInfoApi;
  vault?: KeyVault;
  now?: number;
}

export interface ResolveResult {
  status: SessionStatus;
  rotationDue: boolean;
}

/**
 * Work out what the connected wallet still needs and write it into hlSession.
 *
 *  no usable agent                      -> needs-agent
 *  agent ok, builder fee < configured   -> needs-builder-approval
 *  otherwise                            -> ready
 *
 * The local agent is only trusted if HL's `extraAgents` still lists it and it
 * has not expired. `silent` (periodic / focus re-checks) never downgrades the
 * session on a transient network failure.
 */
/** Monotonic id of the latest resolve; only the most recently STARTED resolve may write session state. */
let latest = 0;

export async function resolveSessionStatus(
  address: Address,
  deps: ResolveDeps & { silent?: boolean } = {},
): Promise<ResolveResult> {
  const session = hlSession.getState();
  const network = session.network;
  const info = deps.info ?? createInfoApi(network);
  const now = deps.now ?? Date.now();
  const user = address.toLowerCase() as Address;
  const mine = ++latest;
  // Stale = the account/network changed meanwhile, or a newer resolve started (its answer is fresher).
  const stale = () =>
    hlSession.getState().address?.toLowerCase() !== user || hlSession.getState().network !== network || mine !== latest;

  try {
    let agent = await loadAgent(network, user, { vault: deps.vault, now });
    if (agent) {
      const approved = await info.extraAgents({ user });
      if (stale()) return { status: hlSession.getState().status, rotationDue: false };
      const match = approved.find(
        (a) => a.address.toLowerCase() === agent?.address.toLowerCase() && (a.validUntil === null || a.validUntil > now),
      );
      if (!match) {
        await revokeAgent(network, user, { vault: deps.vault }); // revoked / replaced / expired on HL
        agent = null;
      }
    }

    const builder = getBuilderAddress();
    let approvedFee: number | null = null;
    if (getBuilderParam() && builder) approvedFee = await info.maxBuilderFee({ user, builder });
    if (stale()) return { status: hlSession.getState().status, rotationDue: false };

    if (!agent) {
      hlSession.getState().patch({ address: user, agent: null, status: "needs-agent", error: null, approvedBuilderFee: approvedFee });
      walletUi.getState().patch({ rotationDue: false });
      return { status: "needs-agent", rotationDue: false };
    }

    const rotationDue = needsRotation(agent.validUntil, now);
    const status: SessionStatus =
      approvedFee !== null && approvedFee < getBuilderFeeTenthsBp() ? "needs-builder-approval" : "ready";
    hlSession.getState().patch({ address: user, agent, status, error: null, approvedBuilderFee: approvedFee });
    walletUi.getState().patch({ rotationDue });
    return { status, rotationDue };
  } catch (e) {
    if (stale()) return { status: hlSession.getState().status, rotationDue: walletUi.getState().rotationDue };
    if (!deps.silent) {
      hlSession.getState().patch({ status: "error", error: humanizeError(e) });
      return { status: "error", rotationDue: false };
    }
    // Transient failure on a background re-check: keep ready/needs-* as is, but never leave the UI stuck on "connecting".
    if (hlSession.getState().status === "connecting") {
      hlSession.getState().patch({ status: "error", error: humanizeError(e) });
      return { status: "error", rotationDue: false };
    }
    return { status: hlSession.getState().status, rotationDue: walletUi.getState().rotationDue };
  }
}
