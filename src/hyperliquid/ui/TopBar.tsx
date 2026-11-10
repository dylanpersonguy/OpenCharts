import { Landmark } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button.tsx";
import { useFeeConfigStore } from "../feeConfig.ts";
import { useHlSession } from "../session.ts";
import { AccountBadge, ConnectButton, DepositPanel, Modal, SetupDialog } from "../onboarding/index.ts";
import { getHlRegistry } from "./mode.ts";
import { useHlUi } from "./uiStore.ts";

function NetworkPill() {
  const network = useHlSession((s) => s.network);
  if (network === "mainnet") return null;
  return (
    <span className="rounded border border-amber-500/60 px-1.5 text-[10px] font-semibold uppercase leading-4 text-amber-500">
      {network}
    </span>
  );
}

/** Banner for the remote fee config's `message` (e.g. "fees halved this week"). */
export function FeeMessageBanner() {
  const message = useFeeConfigStore((s) => s.message);
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="fee-banner"
      className="border-b border-border bg-secondary/70 px-3 py-1 text-center text-xs text-foreground"
    >
      {message}
    </div>
  );
}

export function TopBar() {
  const address = useHlSession((s) => s.address);
  const openDeposit = useHlUi((s) => s.openDeposit);
  return (
    <header
      className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-1.5"
      data-testid="hl-topbar"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span>OpenCharts</span>
        <NetworkPill />
      </div>
      <div className="flex items-center gap-2">
        {address && <AccountBadge className="text-xs md:hidden" />}
        {address && (
          <Button size="sm" variant="outline" onClick={openDeposit}>
            <Landmark className="mr-1 h-3 w-3" aria-hidden />
            Deposit
          </Button>
        )}
        <ConnectButton />
      </div>
    </header>
  );
}

/**
 * Hosts the dialogs other components request through `useHlUi`: trading setup
 * (from the order ticket, or after a builder-fee rejection) and deposit.
 * Nothing opens uninvited on load.
 */
export function HlDialogHost(): ReactNode {
  const { setupOpen, setupReason, depositOpen, closeSetup, closeDeposit, openSetup } = useHlUi();
  const registry = depositOpen ? getHlRegistry() : null;
  const dexes = new Map<string, { name: string; collateral?: string }>();
  for (const m of registry?.markets() ?? []) {
    if (m.dex && !dexes.has(m.dex)) dexes.set(m.dex, { name: m.dex, collateral: m.collateral });
  }
  const feeChanged = setupOpen && setupReason === "fee-changed";

  return (
    <>
      <Modal open={feeChanged} title="Fee settings changed" onClose={closeSetup}>
        <p className="text-sm">
          The platform fee changed since you last approved it, so Hyperliquid rejected your order. No order was
          placed. Approve the updated fee to keep trading.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={closeSetup}>
            Not now
          </Button>
          <Button size="sm" onClick={() => openSetup("trade")}>
            Review and approve
          </Button>
        </div>
      </Modal>
      <SetupDialog open={setupOpen && !feeChanged} onClose={closeSetup} />
      <Modal open={depositOpen} title="Deposit and withdraw" onClose={closeDeposit}>
        <DepositPanel hip3Dexes={[...dexes.values()]} />
      </Modal>
    </>
  );
}
