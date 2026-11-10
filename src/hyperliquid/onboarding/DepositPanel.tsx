import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { formatUnits } from "viem";
import { Button } from "../../components/ui/button.tsx";
import { useHlSession } from "../session.ts";
import { humanizeError } from "../wallet/errors.ts";
import {
  BRIDGE_ADDRESS,
  MIN_DEPOSIT_USDC,
  USDC_DECIMALS,
  WITHDRAW_FEE_USDC,
  depositUsdc,
  getArbitrumUsdcBalance,
  moveUsdc,
  validateDeposit,
  validateAmountOnly,
  validateWithdraw,
  withdrawUsdc,
} from "../wallet/funds.ts";
import { useAccountSummary } from "./useAccountSummary.ts";

export interface DepositPanelProps {
  /** HIP-3 dexes the user may want to fund (e.g. xyz). `collateral` as reported by meta; non-USDC is flagged. */
  hip3Dexes?: { name: string; collateral?: string }[];
}

const inputCls = "h-8 w-full rounded-md border border-border bg-background px-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Msg({ kind, children }: { kind: "error" | "ok"; children: React.ReactNode }) {
  return (
    <div role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"} className={`min-h-4 text-xs ${kind === "error" ? "text-sell" : "text-success"}`}>
      {children}
    </div>
  );
}

export function DepositPanel({ hip3Dexes = [{ name: "xyz" }] }: DepositPanelProps) {
  const address = useHlSession((s) => s.address);
  const network = useHlSession((s) => s.network);
  const { summary, refresh } = useAccountSummary();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<"deposit" | "withdraw" | "move" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [wAmount, setWAmount] = useState("");
  const [mAmount, setMAmount] = useState("");
  const [dex, setDex] = useState(hip3Dexes[0]?.name ?? "");
  const [dir, setDir] = useState<"in" | "out">("in");
  /** The action awaiting an explicit "Confirm" click; always shows exactly what will be signed. */
  const [confirmRaw, setConfirm] = useState<{ owner: string; kind: "deposit" | "withdraw" | "move"; text: string; go: () => Promise<string> } | null>(null);

  useEffect(() => {
    if (!address) return;
    let live = true;
    getArbitrumUsdcBalance(address, network)
      .then((b) => live && setBalance(b))
      .catch(() => live && setBalance(null));
    return () => {
      live = false;
    };
  }, [address, network, ok]);

  const run = useCallback(async (kind: "deposit" | "withdraw" | "move", fn: () => Promise<string>) => {
    setBusy(kind);
    setConfirm(null);
    setErr(null);
    setOk(null);
    try {
      setOk(await fn());
      refresh();
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  if (!address) return <p className="p-3 text-xs text-muted-foreground">Connect your wallet to deposit or withdraw.</p>;

  // A pending confirmation belongs to one account/network: ignore it if either changed.
  const confirm = confirmRaw && confirmRaw.owner === `${network}:${address}` ? confirmRaw : null;
  const dCheck = validateDeposit(amount, balance ?? undefined);
  const wCheck = validateWithdraw(wAmount, summary?.freeMargin);
  const mCheck = validateAmountOnly(mAmount);
  const dexInfo = hip3Dexes.find((d) => d.name === dex);
  const nonUsdc = dexInfo?.collateral !== undefined && dexInfo.collateral !== "USDC";
  const unified = summary?.abstraction === "unifiedAccount" || summary?.abstraction === "portfolioMargin";
  const chainName = network === "mainnet" ? "Arbitrum One" : "Arbitrum Sepolia (testnet)";

  return (
    <div className="space-y-4 p-3 text-xs">
      <section aria-labelledby="dep-h">
        <h3 id="dep-h" className="mb-1 font-semibold">Deposit USDC</h3>
        <p className="mb-2 text-muted-foreground">
          Wallet balance on {chainName}: <span className="font-mono">{balance === null ? "…" : formatUnits(balance, USDC_DECIMALS)} USDC</span>. Funds are sent to the Hyperliquid bridge
          (<span className="font-mono">{BRIDGE_ADDRESS[network].slice(0, 8)}…</span>) and credited to this wallet in about a minute.
        </p>
        <div className="mb-2 flex items-start gap-1 rounded border border-warning/50 bg-warning/10 p-2" role="note">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
          <span>Minimum deposit is {MIN_DEPOSIT_USDC} USDC. Anything smaller is not credited and is lost. Send native USDC on {chainName} only.</span>
        </div>
        <div className="flex gap-2">
          <input aria-label="Deposit amount in USDC" inputMode="decimal" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`${MIN_DEPOSIT_USDC}.00`} />
          <Button size="sm" disabled={busy !== null || !dCheck.ok} onClick={() => dCheck.ok && setConfirm({ owner: `${network}:${address}`, kind: "deposit", text: `Send ${dCheck.amountStr} USDC from ${address} to the Hyperliquid bridge ${BRIDGE_ADDRESS[network]} on ${chainName}. This is an on-chain transaction: your wallet will show it and you pay Arbitrum gas (ETH).`, go: async () => `Deposit sent (tx ${(await depositUsdc(amount)).slice(0, 10)}…). It will appear in your account shortly.` })}>
            {busy === "deposit" && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}Deposit
          </Button>
        </div>
        {amount !== "" && !dCheck.ok && <p className="mt-1 text-sell" role="alert">{dCheck.error}</p>}
      </section>

      <section aria-labelledby="mv-h">
        <h3 id="mv-h" className="mb-1 font-semibold">Move funds to a market group</h3>
        <p className="mb-2 text-muted-foreground">
          {unified
            ? "Your account is unified: your USDC is shared across markets automatically, no transfer needed."
            : "Deposits arrive in your main perp balance. Core crypto perps use it directly. Markets on a HIP-3 dex such as xyz keep their own margin balance, so move USDC there before trading them."}
        </p>
        {!unified && (
          <>
            <div className="flex flex-wrap gap-2">
              <select aria-label="HIP-3 dex" className={inputCls + " w-24"} value={dex} onChange={(e) => setDex(e.target.value)}>
                {hip3Dexes.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
              <select aria-label="Direction" className={inputCls + " w-36"} value={dir} onChange={(e) => setDir(e.target.value as "in" | "out")}>
                <option value="in">Core perps → {dex}</option>
                <option value="out">{dex} → Core perps</option>
              </select>
              <input aria-label="Transfer amount in USDC" inputMode="decimal" className={inputCls + " w-24"} value={mAmount} onChange={(e) => setMAmount(e.target.value)} placeholder="0.00" />
              <Button size="sm" variant="secondary" disabled={busy !== null || nonUsdc || !mCheck.ok} onClick={() => mCheck.ok && setConfirm({ owner: `${network}:${address}`, kind: "move", text: `Move ${mCheck.amountStr} USDC ${dir === "in" ? `from core perps to ${dex}` : `from ${dex} to core perps`} inside your Hyperliquid account. Your wallet will ask you to sign this request (no gas).`, go: async () => { await moveUsdc(dir === "in" ? "" : dex, dir === "in" ? dex : "", mAmount, dir === "in" && summary ? { available: summary.freeMargin } : {}); return "Transfer complete."; } })}>
                {busy === "move" && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}Move
              </Button>
            </div>
            {mAmount !== "" && !mCheck.ok && <p className="mt-1 text-sell" role="alert">{mCheck.error}</p>}
            {nonUsdc && <p className="mt-1 text-warning" role="alert">{dex} uses {dexInfo?.collateral} as collateral, not USDC. This panel can only move USDC; swap on Hyperliquid first.</p>}
          </>
        )}
      </section>

      <section aria-labelledby="wd-h">
        <h3 id="wd-h" className="mb-1 font-semibold">Withdraw</h3>
        <p className="mb-2 text-muted-foreground">
          Sends USDC from your free margin ({summary ? summary.freeMargin.toFixed(2) : "…"} USDC) back to your wallet on {chainName}. Hyperliquid charges a flat {WITHDRAW_FEE_USDC} USDC fee; it usually arrives within minutes.
        </p>
        <div className="flex gap-2">
          <input aria-label="Withdraw amount in USDC" inputMode="decimal" className={inputCls} value={wAmount} onChange={(e) => setWAmount(e.target.value)} placeholder="0.00" />
          <Button size="sm" variant="secondary" disabled={busy !== null || !wCheck.ok} onClick={() => wCheck.ok && setConfirm({ owner: `${network}:${address}`, kind: "withdraw", text: `Withdraw ${wCheck.amountStr} USDC from Hyperliquid to your own wallet ${address} on ${chainName}. Hyperliquid charges a ${WITHDRAW_FEE_USDC} USDC fee. Your wallet will ask you to sign this request (no gas).`, go: async () => { await withdrawUsdc(wAmount, summary?.freeMargin ?? 0); return "Withdrawal requested."; } })}>
            {busy === "withdraw" && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}Withdraw
          </Button>
        </div>
        {wAmount !== "" && !wCheck.ok && <p className="mt-1 text-sell" role="alert">{wCheck.error}</p>}
      </section>

      {confirm && (
        <div role="group" aria-label="Confirm action" className="space-y-2 rounded border border-primary/50 bg-primary/5 p-2">
          <p>{confirm.text}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void run(confirm.kind, confirm.go)}>
              Confirm {confirm.kind}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {err && <Msg kind="error">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}
    </div>
  );
}
