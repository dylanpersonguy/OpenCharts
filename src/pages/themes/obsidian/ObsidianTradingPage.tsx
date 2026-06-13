import {
  type RightPanelId,
  type TerminalTradingApi,
  TradingDialogsHost,
  useTerminalTrading,
} from "../../trading/useTerminalTrading.tsx";
import { WatchlistPanel } from "../../trading/WatchlistPanel.tsx";
import { ThemeChartColumn, ThemeRightDock } from "../theme-chrome.tsx";
import { fmtSigned, useCountUp, useDarkThemeScope } from "../theme-kit.tsx";
import "./obsidian.css";

/* ── Command strip across the top ───────────────────────────── */

function PriceBlock({ t }: { t: TerminalTradingApi }) {
  const digits = Math.max(2, t.pipDigits);
  const mid = t.tick ? (t.tick.bid + t.tick.ask) / 2 : 0;
  const price = useCountUp(mid, 350);
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-lg font-bold tracking-tight">{t.selectedSymbol}</span>
      <span className="text-2xl font-bold tabular-nums text-accent">
        {t.tick ? price.toFixed(digits) : "—"}
      </span>
      <span className="ob-chip">
        <span className="ob-label">Bid</span>
        <span className="ob-neg text-xs font-semibold">
          {t.tick ? t.tick.bid.toFixed(digits) : "—"}
        </span>
      </span>
      <span className="ob-chip">
        <span className="ob-label">Ask</span>
        <span className="ob-pos text-xs font-semibold">
          {t.tick ? t.tick.ask.toFixed(digits) : "—"}
        </span>
      </span>
      <span className="ob-chip hidden lg:inline-flex">
        <span className="ob-label">Spread</span>
        <span className="text-xs font-semibold">
          {t.tick ? (t.tick.ask - t.tick.bid).toFixed(digits) : "—"}
        </span>
      </span>
    </div>
  );
}

function AccountBlock({ t }: { t: TerminalTradingApi }) {
  return (
    <div className="flex items-center gap-3">
      <span className="ob-chip">
        <span className="ob-label">Equity</span>
        <span className="text-xs font-semibold">
          {(t.account?.equity ?? 0).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          })}
        </span>
      </span>
      <span className="ob-chip">
        <span className="ob-label">P&L</span>
        <span className={`text-xs font-semibold ${t.positionPnl >= 0 ? "ob-pos" : "ob-neg"}`}>
          {fmtSigned(t.positionPnl)}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold">
        <span
          className={`ob-live-dot h-1.5 w-1.5 rounded-full ${
            t.isFeedConnected ? "bg-[hsl(var(--buy))]" : "bg-[hsl(var(--sell))]"
          }`}
        />
        {t.isFeedConnected ? "LIVE" : "OFFLINE"}
      </span>
    </div>
  );
}

/* ── Right dock with pill tabs ──────────────────────────────── */

const DOCK_TABS: { id: RightPanelId; label: string }[] = [
  { id: "order", label: "Trade" },
  { id: "dom", label: "Depth" },
  { id: "news", label: "News" },
];

function ObsidianDock({ t }: { t: TerminalTradingApi }) {
  return (
    <aside className="ob-panel flex w-[300px] shrink-0 flex-col overflow-hidden xl:w-[336px]">
      <div className="flex items-center gap-1 border-b border-border p-2">
        {DOCK_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="ob-tab"
            data-active={t.rightPanel === tab.id}
            onClick={() => t.setRightPanel(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <ThemeRightDock t={t} />
    </aside>
  );
}

/**
 * Obsidian trading desk — graphite pro-exchange.
 * Command strip · watchlist rail · chart · pill-tab trade dock.
 */
export function ObsidianTradingPage() {
  useDarkThemeScope("obsidian");
  const t = useTerminalTrading("obBottomPanelHeight");

  return (
    <div className="ob-page">
      <header className="ob-strip ob-reveal flex items-center justify-between gap-4 px-4 py-2.5">
        <PriceBlock t={t} />
        <AccountBlock t={t} />
      </header>

      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <aside className="ob-panel flex w-[240px] shrink-0 flex-col overflow-hidden">
          <div className="border-b border-border px-3 py-2">
            <span className="ob-label">Watchlist</span>
          </div>
          <WatchlistPanel
            symbols={t.symbols}
            ticks={t.ticks}
            selectedSymbol={t.selectedSymbol}
            onSelect={t.setSelectedSymbol}
            oneClick={t.oneClick}
            accountId={t.activeAccountId}
            isFeedConnected={t.isFeedConnected}
          />
        </aside>

        <ThemeChartColumn
          t={t}
          frameClass="ob-panel"
          bottomClass="ob-panel"
          handleClass="h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-accent/60"
        />

        {t.showRightPanel && <ObsidianDock t={t} />}
      </div>

      <TradingDialogsHost t={t} />
    </div>
  );
}
