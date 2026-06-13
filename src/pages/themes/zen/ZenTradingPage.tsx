import { useState } from "react";
import { MarketClosedBanner } from "../../trading/MarketClosedBanner.tsx";
import {
  ChartArea,
  type TerminalTradingApi,
  TradingDialogsHost,
  useTerminalTrading,
} from "../../trading/useTerminalTrading.tsx";
import { WatchlistPanel } from "../../trading/WatchlistPanel.tsx";
import { ThemeBottomPanel, ThemeChartToolbar, ThemeRightDock } from "../theme-chrome.tsx";
import { fmtSigned, fmtUsd, useCountUp, useDarkThemeScope } from "../theme-kit.tsx";
import "./zen.css";

/* ── Floating HUD (bottom-left) ─────────────────────────────── */

function HudChip({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const toneClass = tone === "pos" ? "zn-pos" : tone === "neg" ? "zn-neg" : "";
  return (
    <div className="zn-glass zn-hud-chip">
      <span className="zn-label">{label}</span>
      <span className={`text-xs font-bold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

function Hud({ t }: { t: TerminalTradingApi }) {
  const equity = useCountUp(t.account?.equity ?? 0);
  return (
    <div className="zn-hud zn-float-in">
      <HudChip label="Equity" value={fmtUsd(equity)} />
      <HudChip
        label="Floating P&L"
        value={fmtSigned(t.positionPnl)}
        tone={t.positionPnl >= 0 ? "pos" : "neg"}
      />
      <HudChip
        label="Feed"
        value={t.isFeedConnected ? "Live" : "Offline"}
        tone={t.isFeedConnected ? "pos" : "neg"}
      />
    </div>
  );
}

/* ── Trade pod (bottom-right, expandable) ───────────────────── */

function TradePod({ t }: { t: TerminalTradingApi }) {
  const [open, setOpen] = useState(false);
  const digits = Math.max(2, t.pipDigits);
  return (
    <div className="zn-pod zn-glass zn-float-in" style={{ width: open ? 320 : "auto" }}>
      <button
        type="button"
        className="flex items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-xs font-bold tracking-wide">
          {open ? "Hide Ticket" : `Trade ${t.selectedSymbol}`}
        </span>
        <span className="flex gap-3 tabular-nums text-[11px] font-semibold">
          <span className="zn-neg">{t.tick ? t.tick.bid.toFixed(digits) : "—"}</span>
          <span className="zn-pos">{t.tick ? t.tick.ask.toFixed(digits) : "—"}</span>
        </span>
      </button>
      {open && (
        <div className="flex max-h-[60vh] min-h-0 flex-col overflow-y-auto border-t border-border">
          <ThemeRightDock t={t} />
        </div>
      )}
    </div>
  );
}

/* ── Edge drawers ───────────────────────────────────────────── */

function WatchDrawer({ t }: { t: TerminalTradingApi }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="zn-edge-tab zn-edge-left zn-glass"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Watchlist
      </button>
      {open && (
        <div className="zn-drawer-left zn-glass">
          <WatchlistPanel
            symbols={t.symbols}
            ticks={t.ticks}
            selectedSymbol={t.selectedSymbol}
            onSelect={(s) => {
              t.setSelectedSymbol(s);
              setOpen(false);
            }}
            oneClick={t.oneClick}
            accountId={t.activeAccountId}
            isFeedConnected={t.isFeedConnected}
          />
        </div>
      )}
    </>
  );
}

function PositionsDrawer({ t }: { t: TerminalTradingApi }) {
  const [open, setOpen] = useState(false);
  const count = t.positions.length;
  return (
    <>
      {!open && (
        <button
          type="button"
          className="zn-bottom-tab zn-glass px-5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-accent"
          onClick={() => setOpen(true)}
        >
          ▲ Positions{count > 0 ? ` (${count})` : ""}
        </button>
      )}
      {open && (
        <div className="zn-drawer-bottom zn-glass">
          <button
            type="button"
            className="w-full py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-accent"
            onClick={() => setOpen(false)}
          >
            ▼ Close
          </button>
          <ThemeBottomPanel t={t} />
        </div>
      )}
    </>
  );
}

/**
 * Zen trading desk — the chart is the page.
 * Frosted toolbar veil · floating HUD · expandable trade pod ·
 * watchlist and positions as edge drawers.
 */
export function ZenTradingPage() {
  useDarkThemeScope("zen");
  const t = useTerminalTrading("znBottomPanelHeight");

  return (
    <div className="zn-page">
      <div className="absolute inset-0">
        <ChartArea t={t} isDark={true} />
      </div>

      <div className="zn-veil zn-glass">
        <ThemeChartToolbar t={t} />
        <MarketClosedBanner symbolInfo={t.symbolInfo} />
      </div>

      <Hud t={t} />
      <TradePod t={t} />
      <WatchDrawer t={t} />
      <PositionsDrawer t={t} />

      <TradingDialogsHost t={t} />
    </div>
  );
}
