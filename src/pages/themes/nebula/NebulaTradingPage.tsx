import {
  type TerminalTradingApi,
  TradingDialogsHost,
  useTerminalTrading,
} from "../../trading/useTerminalTrading.tsx";
import { getPipDigits } from "../../trading/utils.ts";
import { ThemeChartColumn, ThemeRightDock } from "../theme-chrome.tsx";
import { fmtSigned, useCountUp, useDarkThemeScope } from "../theme-kit.tsx";
import "./nebula.css";

/* ── Hero masthead: giant glowing price ─────────────────────── */

function HeroMasthead({ t }: { t: TerminalTradingApi }) {
  const digits = Math.max(2, t.pipDigits);
  const mid = t.tick ? (t.tick.bid + t.tick.ask) / 2 : 0;
  const price = useCountUp(mid, 350);
  return (
    <header className="nb-reveal relative z-10 flex items-end justify-between gap-6 px-5 pt-4">
      <div>
        <div className="nb-label">{t.selectedSymbol}</div>
        <div className="nb-glowpulse text-4xl font-extrabold tracking-tight tabular-nums">
          {t.tick ? price.toFixed(digits) : "—"}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <span className="nb-pricechip">
          <span className="nb-label">Bid</span>
          <span className="nb-neg">{t.tick ? t.tick.bid.toFixed(digits) : "—"}</span>
        </span>
        <span className="nb-pricechip">
          <span className="nb-label">Ask</span>
          <span className="nb-pos">{t.tick ? t.tick.ask.toFixed(digits) : "—"}</span>
        </span>
        <span className="nb-pricechip">
          <span className="nb-label">P&L</span>
          <span className={t.positionPnl >= 0 ? "nb-pos" : "nb-neg"}>
            {fmtSigned(t.positionPnl)}
          </span>
        </span>
        <span className="nb-pricechip">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              t.isFeedConnected ? "bg-[hsl(var(--buy))]" : "bg-[hsl(var(--sell))]"
            }`}
          />
          {t.isFeedConnected ? "Live" : "Offline"}
        </span>
      </div>
    </header>
  );
}

/* ── Orbit ticker strip ─────────────────────────────────────── */

function TickerStrip({ t }: { t: TerminalTradingApi }) {
  return (
    <div className="nb-reveal-2 relative z-10 px-5 pt-3">
      <div className="nb-ticker">
        {t.symbols.map((s) => {
          const tick = t.ticks[s.name];
          return (
            <button
              key={s.name}
              type="button"
              className="nb-tickercard"
              data-active={s.name === t.selectedSymbol}
              onClick={() => t.setSelectedSymbol(s.name)}
            >
              <div className="nb-label">{s.name}</div>
              <div className="text-sm font-bold tabular-nums">
                {tick ? tick.bid.toFixed(getPipDigits(s, s.name)) : "—"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Nebula trading desk — neon violet aurora.
 * Glowing hero price · orbit ticker · glass chart · glass ticket.
 */
export function NebulaTradingPage() {
  useDarkThemeScope("nebula");
  const t = useTerminalTrading("nbBottomPanelHeight");

  return (
    <div className="nb-page">
      <HeroMasthead t={t} />
      <TickerStrip t={t} />

      <div className="relative z-10 flex min-h-0 flex-1 gap-3 p-4">
        <ThemeChartColumn
          t={t}
          frameClass="nb-panel"
          bottomClass="nb-panel"
          handleClass="h-1 w-12 rounded-full bg-border transition-colors group-hover:bg-accent/60"
        />

        {t.showRightPanel && (
          <aside className="nb-panel nb-reveal-2 flex w-[300px] shrink-0 flex-col overflow-hidden xl:w-[336px]">
            <div className="border-b border-border px-4 py-3">
              <span className="nb-label">Place Order</span>
            </div>
            <ThemeRightDock t={t} />
          </aside>
        )}
      </div>

      <TradingDialogsHost t={t} />
    </div>
  );
}
