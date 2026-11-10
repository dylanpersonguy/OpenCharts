/** Turn wallet / HL / network failures into short human messages. */

export class UserRejectedError extends Error {
  constructor(message = "You rejected the request in your wallet.") {
    super(message);
    this.name = "UserRejectedError";
  }
}

/** An error whose message is already written for end users; humanizeError passes it through untouched. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Every `code` found on the error and its `cause` / `data.originalError` chain (wallets and viem nest them). */
export function codesOf(e: unknown): (number | string)[] {
  const out: (number | string)[] = [];
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number): void => {
    if (typeof x !== "object" || x === null || seen.has(x) || depth > 6) return;
    seen.add(x);
    const o = x as { code?: unknown; cause?: unknown; data?: unknown; error?: unknown; info?: unknown };
    if (typeof o.code === "number" || typeof o.code === "string") out.push(o.code);
    walk(o.cause, depth + 1);
    walk(o.error, depth + 1);
    walk(o.info, depth + 1);
    const d = o.data as { originalError?: unknown } | undefined;
    if (typeof d === "object" && d !== null) walk(d.originalError, depth + 1);
  };
  walk(e, 0);
  return out;
}

export const hasErrorCode = (e: unknown, code: number | string): boolean => codesOf(e).includes(code);

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message);
  return "";
}

export function isUserRejection(e: unknown): boolean {
  if (e instanceof UserRejectedError) return true;
  if (hasErrorCode(e, 4001) || hasErrorCode(e, "ACTION_REJECTED")) return true;
  const m = messageOf(e).toLowerCase();
  return /user (rejected|denied)|rejected the request|request rejected|cancell?ed by user/.test(m);
}

/** Human-readable message for any error raised during setup / funding. */
export function humanizeError(e: unknown): string {
  if (e instanceof UserFacingError) return e.message;
  if (isUserRejection(e)) return "You rejected the request in your wallet. Nothing was changed - try again when you are ready.";
  if (hasErrorCode(e, -32002)) return "Your wallet already has a pending request. Open it and approve or reject it first.";
  if (hasErrorCode(e, 4902)) return "Your wallet does not know the required network. Add it in your wallet and retry.";
  if (hasErrorCode(e, 4900) || hasErrorCode(e, 4901)) return "Your wallet is disconnected from the network. Reconnect and retry.";
  const m = messageOf(e);
  const l = m.toLowerCase();
  if (l.includes("builder fee approvals limit") || l.includes("too many builder") || l.includes("approvals limit"))
    return "Hyperliquid limits how many builder fee approvals an account can have. Revoke an unused one on Hyperliquid and retry.";
  if (l.includes("insufficient funds") || l.includes("gas required exceeds") || l.includes("exceeds the balance of the account"))
    return "Not enough ETH on Arbitrum to pay the network gas fee.";
  if (l.includes("transfer amount exceeds balance") || l.includes("exceeds balance"))
    return "Your wallet does not hold enough USDC for this amount.";
  if (l.includes("insufficient") && (l.includes("volume") || l.includes("balance")))
    return "Hyperliquid rejected this action because the account has not met its minimum balance or trading volume requirement. Deposit funds first.";
  if (l.includes("must deposit before") || l.includes("does not exist"))
    return "This wallet has no Hyperliquid account yet. Deposit USDC first, then enable trading.";
  if (l.includes("failed to fetch") || l.includes("networkerror") || l.includes("network request failed") || l.includes("timeout") || l.includes("timed out"))
    return "Could not reach Hyperliquid. Check your connection and retry.";
  return m ? `Something went wrong: ${m.slice(0, 200)}` : "Something went wrong. Please try again.";
}
