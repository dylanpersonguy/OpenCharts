import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Wallet } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { useHlSession } from "../session.ts";
import { connectWallet, disconnectWallet } from "../wallet/connect.ts";
import { humanizeError } from "../wallet/errors.ts";
import { discoverWallets, type Eip6963ProviderDetail } from "../wallet/providers.ts";
import { AccountBadge } from "./AccountBadge.tsx";
import { DepositPanel } from "./DepositPanel.tsx";
import { shortAddress } from "./feeCopy.ts";
import { Modal } from "./Modal.tsx";
import { SetupDialog } from "./SetupDialog.tsx";

/** Compact header control: connect / address + balance / menu (set up, funds, disconnect). */
export function ConnectButton() {
  const status = useHlSession((s) => s.status);
  const address = useHlSession((s) => s.address);
  const [wallets, setWallets] = useState<Eip6963ProviderDetail[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [setup, setSetup] = useState(false);
  const [funds, setFunds] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu && !wallets) return;
    const onDoc = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setMenu(false);
        setWallets(null);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setMenu(false);
        setWallets(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, wallets]);

  const doConnect = async (d?: Eip6963ProviderDetail): Promise<void> => {
    setErr(null);
    setWallets(null);
    try {
      await connectWallet(d);
      if (useHlSession.getState().status === "needs-agent" || useHlSession.getState().status === "needs-builder-approval") setSetup(true);
    } catch (e) {
      setErr(humanizeError(e));
    }
  };

  const onClickConnect = async (): Promise<void> => {
    const found = await discoverWallets();
    if (found.length > 1) setWallets(found);
    else await doConnect(found[0]);
  };

  const connecting = status === "connecting";

  return (
    <div ref={rootRef} className="relative inline-block text-xs">
      {!address ? (
        <Button size="sm" onClick={() => void onClickConnect()} disabled={connecting} aria-haspopup={wallets ? "menu" : undefined}>
          {connecting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : <Wallet className="mr-1 h-3 w-3" aria-hidden />}
          Connect wallet
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label={`Wallet ${address}`}>
          <span className="font-mono">{shortAddress(address)}</span>
          {status === "ready" && <AccountBadge className="ml-2 hidden md:inline" />}
          {status !== "ready" && status !== "connecting" && <span className="ml-2 text-warning">Setup needed</span>}
          <ChevronDown className="ml-1 h-3 w-3" aria-hidden />
        </Button>
      )}

      {wallets && (
        <ul role="menu" aria-label="Choose a wallet" className="absolute right-0 z-40 mt-1 min-w-44 rounded-md border border-border bg-card p-1 shadow-lg">
          {wallets.map((w) => (
            <li key={w.info.uuid} role="none">
              <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => void doConnect(w)}>
                {w.info.icon && <img src={w.info.icon} alt="" className="h-4 w-4" />}
                {w.info.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {menu && address && (
        <ul role="menu" className="absolute right-0 z-40 mt-1 min-w-44 rounded-md border border-border bg-card p-1 shadow-lg">
          {status !== "ready" && (
            <li role="none"><button role="menuitem" type="button" className="w-full rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => { setMenu(false); setSetup(true); }}>Finish setup</button></li>
          )}
          <li role="none"><button role="menuitem" type="button" className="w-full rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => { setMenu(false); setFunds(true); }}>Deposit / Withdraw</button></li>
          <li role="none"><button role="menuitem" type="button" className="w-full rounded px-2 py-1.5 text-left text-sell hover:bg-accent" onClick={() => { setMenu(false); void disconnectWallet(); }}>Disconnect</button></li>
        </ul>
      )}

      <div role="alert" aria-live="assertive" className="sr-only">{err}</div>
      {err && <div className="absolute right-0 mt-1 w-56 rounded border border-sell/50 bg-card p-2 text-sell shadow">{err}</div>}

      <SetupDialog open={setup} onClose={() => setSetup(false)} />
      <Modal open={funds} title="Deposit and withdraw" onClose={() => setFunds(false)}>
        <DepositPanel />
      </Modal>
    </div>
  );
}
