import { useCallback, useState } from "react";
import { Check, CircleDashed, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { cn } from "../../lib/utils.ts";
import { DEFAULT_AGENT_TTL_MS, useAgentVaultStore } from "../agentKey.ts";
import { getBuilderParam } from "../config.ts";
import { useHlSession } from "../session.ts";
import { connectWallet } from "../wallet/connect.ts";
import { humanizeError } from "../wallet/errors.ts";
import { enableTrading, type SetupStepId, type SetupStepState } from "../wallet/setup.ts";
import { walletUi } from "../wallet/state.ts";
import { feeDisclosure } from "./feeCopy.ts";
import { Modal } from "./Modal.tsx";

type Visual = "idle" | "pending" | "done" | "error";

function StepRow({ n, title, state, children }: { n: number; title: string; state: Visual; children: React.ReactNode }) {
  const label = { idle: "not started", pending: "in progress", done: "done", error: "failed" }[state];
  return (
    <li className="flex gap-3" data-testid={`step-${n}`} data-state={state}>
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
          state === "done" && "border-success bg-success text-white",
          state === "error" && "border-sell text-sell",
          state === "pending" && "border-primary text-primary",
        )}
      >
        {state === "done" ? <Check className="h-3 w-3" aria-hidden /> : state === "pending" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : state === "error" ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <CircleDashed className="h-3 w-3" aria-hidden />}
      </span>
      <div className="min-w-0 text-xs">
        <div className="font-medium">
          {n}. {title} <span className="sr-only">({label})</span>
        </div>
        <div className="mt-0.5 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

export interface SetupDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SetupDialog({ open, onClose }: SetupDialogProps) {
  const status = useHlSession((s) => s.status);
  const address = useHlSession((s) => s.address);
  const rotationDue = walletUi((s) => s.rotationDue);
  const [steps, setSteps] = useState<Partial<Record<SetupStepId, SetupStepState>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const volatileNotice = useAgentVaultStore((s) => s.notice);
  const ttlDays = Math.round(DEFAULT_AGENT_TTL_MS / 86_400_000);
  const fee = feeDisclosure();
  const hasBuilder = getBuilderParam() !== undefined;

  const connected = address !== null;
  const agentOk = status === "needs-builder-approval" || status === "ready";
  const feeOk = status === "ready";

  const s1: Visual = connected ? "done" : busy ? "pending" : "idle";
  const s2: Visual = steps.agent === "error" ? "error" : agentOk && !rotationDue ? "done" : steps.agent === "pending" ? "pending" : "idle";
  const s3: Visual = !hasBuilder ? "done" : steps.builder === "error" ? "error" : feeOk ? "done" : steps.builder === "pending" ? "pending" : "idle";

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!hlSessionAddress()) await connectWallet();
      await enableTrading({
        renew: walletUi.getState().rotationDue,
        onStep: (id, st, msg) => {
          setSteps((p) => ({ ...p, [id]: st }));
          if (st === "error" && msg) setError(msg);
        },
      });
    } catch (e) {
      setError((prev) => prev ?? humanizeError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const complete = connected && agentOk && feeOk && !rotationDue;
  const cta = !connected ? "Connect wallet" : error ? "Retry" : rotationDue ? "Renew trading key" : "Continue";

  return (
    <Modal open={open} onClose={onClose} title="Set up trading">
      <ol className="space-y-3">
        <StepRow n={1} title="Connect wallet" state={s1}>
          {connected ? `Connected as ${address.slice(0, 6)}…${address.slice(-4)}.` : "Your wallet stays in control of your funds. We never see your private key."}
        </StepRow>
        <StepRow n={2} title="Enable trading" state={s2}>
          One signature creates a limited <em>trading key</em> in this browser so orders do not need a wallet popup each time. It can place and cancel orders but{" "}
          <strong>cannot withdraw funds</strong>. It expires after {ttlDays} days; you renew it with one signature when prompted.
          {rotationDue && <span className="mt-1 block text-warning">Your trading key expires soon. Renew it to keep trading.</span>}
        </StepRow>
        <StepRow n={3} title="Approve fee" state={s3}>
          {hasBuilder ? (
            <>
              One signature approves a maximum fee of <strong>{fee.percent}</strong> per trade side. {fee.sentence} You can revoke it on Hyperliquid at any time.
            </>
          ) : (
            "No platform fee is configured, nothing to approve."
          )}
        </StepRow>
      </ol>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Your wallet may ask you to switch to Arbitrum to sign. This is only used to authenticate the request; no transaction is sent and no gas is spent.
      </p>
      {volatileNotice && (
        <div role="status" className="mt-3 rounded border border-warning/50 bg-warning/10 p-2 text-xs">
          {volatileNotice}
        </div>
      )}
      <div role="alert" aria-live="assertive" className="mt-3 min-h-4 text-xs text-sell">
        {error}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {complete ? "Close" : "Not now"}
        </Button>
        {!complete && (
          <Button size="sm" onClick={() => void run()} disabled={busy} aria-label={cta}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
            {cta}
          </Button>
        )}
      </div>
    </Modal>
  );
}

const hlSessionAddress = (): string | null => useHlSession.getState().address;
