import {
  type TerminalTradingApi,
  TradingDialogsHost,
  useTerminalTrading,
} from "../../trading/useTerminalTrading.tsx";
import { getPipDigits } from "../../trading/utils.ts";
import { ThemeChartColumn, ThemeRightDock } from "../theme-chrome.tsx";
import { fmtSigned, fmtUsd, useCountUp, useDarkThemeScope } from "../theme-kit.tsx";
import "./lumen.css";

/* ── KPI header row ─────────────────────────────────────────── */

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const toneClass = tone === "pos" ? "lm-pos" : tone === "neg" ? "lm-neg" : "";
  return (
    <div className="lm-kpi">
      <span className="lm-label">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

function KpiHeader({ t }: { t: TerminalTradingApi }) {
  const equity = useCountUp(t.account?.equity ?? 0);
  return (
    <header className="lm-reveal flex items-center justify-between gap-4 px-4 pt-3">
      <div>
        <h1 className="text-base font-bold tracking-tight">Trading Desk</h1>
        <p className="lm-label">{t.selectedSymbol} · live session</p>
      </div>
      <div className="flex items-center gap-2.5">
        <Kpi label="Equity" value={fmtUsd(equity)} />
        <Kpi
          label="Floating P&L"
          value={fmtSigned(t.positionPnl)}
          tone={t.positionPnl >= 0 ? "pos" : "neg"}
        />
        <Kpi label="Open Positions" value={String(t.positions.length)} />
        <div className={`lm-kpi ${t.isFeedConnected ? "lm-breathe" : ""}`}>
          <span className="lm-label">Feed</span>
          <span className={`text-sm font-bold ${t.isFeedConnected ? "lm-pos" : "lm-neg"}`}>
            {t.isFeedConnected ? "Live" : "Offline"}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ── Symbol chip strip ──────────────────────────────────────── */

function SymbolStrip({ t }: { t: TerminalTradingApi }) {
  return (
    <div className="lm-reveal-2 px-4 pt-3">
      <div className="lm-chipstrip">
        {t.symbols.map((s) => {
          const tick = t.ticks[s.name];
          return (
            <button
              key={s.name}
              type="button"
              className="lm-symchip"
              data-active={s.name === t.selectedSymbol}
              onClick={() => t.setSelectedSymbol(s.name)}
            >
              {s.name}
              <span className="tabular-nums font-medium">
                {tick ? tick.bid.toFixed(getPipDigits(s, s.name)) : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Lumen trading desk — soft near-black with a mint glow.
 * KPI header · symbol chips · glowing chart card · ticket card.
 */
export function LumenTradingPage() {
  useDarkThemeScope("lumen");
  const t = useTerminalTrading("lmBottomPanelHeight");

  return (
    <div className="lm-page">
      <KpiHeader t={t} />
      <SymbolStrip t={t} />

      <div className="flex min-h-0 flex-1 gap-3 p-4">
        <ThemeChartColumn
          t={t}
          frameClass="lm-card"
          bottomClass="lm-card"
          handleClass="h-1 w-12 rounded-full bg-border transition-colors group-hover:bg-accent/50"
        />

        {t.showRightPanel && (
          <aside className="lm-card lm-reveal-2 flex w-[300px] shrink-0 flex-col overflow-hidden xl:w-[336px]">
            <div className="border-b border-border px-4 py-3">
              <span className="lm-label">Order Ticket</span>
            </div>
            <ThemeRightDock t={t} />
          </aside>
        )}
      </div>

      <TradingDialogsHost t={t} />
    </div>
  );
}
