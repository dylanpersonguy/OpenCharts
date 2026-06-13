import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn, formatCurrency } from "@/lib/utils";
import { useTradingStore } from "../services/store.tsx";

type AccountView = {
  id: string;
  label?: string | null;
  status?: string;
  balance: number;
};

function statusIcon(status?: string) {
  const s = (status ?? "").toUpperCase();
  if (s === "ACTIVE" || s === "FUNDED") return <CheckCircle2 className="h-3 w-3 text-buy" />;
  if (s === "PENDING") return <Clock className="h-3 w-3 text-muted-foreground" />;
  if (s === "BREACHED" || s === "FAILED") return <AlertTriangle className="h-3 w-3 text-sell" />;
  return null;
}

function statusColor(status?: string) {
  const s = (status ?? "").toUpperCase();
  if (s === "ACTIVE" || s === "FUNDED") return "text-buy";
  if (s === "BREACHED" || s === "FAILED") return "text-sell";
  return "text-muted-foreground";
}

function badgeLabel(status?: string) {
  return status === "ACTIVE" ? "LIVE" : status || "DEMO";
}

function AccountOption({
  acc,
  isActive,
  onPick,
}: {
  acc: AccountView;
  isActive: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={isActive}
        onClick={onPick}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
          isActive ? "bg-accent/10" : "hover:bg-secondary/40",
        )}
      >
        <div className="flex-shrink-0 w-4 flex justify-center">{statusIcon(acc.status)}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{acc.label || acc.id.slice(0, 12)}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn("text-[10px] uppercase tracking-wider", statusColor(acc.status))}>
              {acc.status ?? "Unknown"}
            </span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {formatCurrency(acc.balance)}
            </span>
          </div>
        </div>
        {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-accent flex-shrink-0" />}
      </button>
    </li>
  );
}

// Desktop account switcher — mirrors the mobile header's custom popover (instead
// of the native <select>) so the dropdown matches the app's styling.
export function AccountSelector() {
  const accounts = useTradingStore((s) => s.accounts as AccountView[]);
  const activeAccountId = useTradingStore((s) => s.activeAccountId);
  const setActiveAccount = useTradingStore((s) => s.setActiveAccount);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId),
    [accounts, activeAccountId],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const triggerLabel = activeAccount?.label || activeAccountId?.slice(0, 8) || "—";

  return (
    <div
      ref={ref}
      className="relative flex items-center h-full px-1.5 sm:px-3 border-r border-border/40"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors",
          open ? "bg-secondary/60" : "hover:bg-secondary/40",
        )}
      >
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/20 text-accent tracking-wide">
          {badgeLabel(activeAccount?.status)}
        </span>
        <span className="text-xs text-foreground font-mono truncate max-w-[180px] sm:max-w-[300px]">
          {triggerLabel}
        </span>
        {open ? (
          <ChevronUp className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {open && accounts.length > 0 && (
        <div
          role="listbox"
          className="absolute left-1.5 sm:left-3 top-full mt-1.5 w-80 bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden z-50 animate-in fade-in slide-in-from-top-1"
        >
          <div className="px-3 py-2 border-b border-border/60">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Accounts
            </span>
          </div>
          <ul className="py-1 max-h-80 overflow-y-auto">
            {accounts.map((acc) => (
              <AccountOption
                key={acc.id}
                acc={acc}
                isActive={acc.id === activeAccountId}
                onPick={() => {
                  setActiveAccount(acc.id);
                  setOpen(false);
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
