import { usePositions } from "@/services/queries";
import { useDashboardV2 } from "../../dashboardv2/useDashboardV2";
import { useDarkThemeScope } from "../theme-kit";
import {
  AccountsTile,
  ActivityTile,
  EquityHeroTile,
  KpiRow,
  PositionsTile,
  RiskTile,
} from "./vanta-sections";
import "./vanta.css";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Vanta dashboard — luxury near-black bento grid.
 * Spotlight tiles, serif gold numerals, draw-in equity chart,
 * radial drawdown gauges and a profit-target meter.
 */
export function VantaDashboardPage() {
  useDarkThemeScope("vanta");
  const dv2 = useDashboardV2();
  const { data: positions = [] } = usePositions(dv2.activeAccountId);
  const name = dv2.user?.email?.split("@")[0] ?? "Trader";

  return (
    <div className="vt-page">
      <div className="mx-auto max-w-[1320px] px-5 py-7">
        <header className="vt-reveal mb-5 flex items-baseline justify-between">
          <div>
            <h1 className="vt-serif text-2xl font-semibold">
              {greeting()}, <span className="vt-gold">{name}</span>
            </h1>
            <p className="vt-label mt-1">{DATE_FMT.format(new Date())}</p>
          </div>
          <span className="vt-chip">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                dv2.openPositionCount > 0
                  ? "bg-[hsl(var(--buy))]"
                  : "bg-[hsl(var(--muted-foreground))]"
              }`}
            />
            {dv2.openPositionCount > 0
              ? `${dv2.openPositionCount} position${dv2.openPositionCount === 1 ? "" : "s"} working`
              : "Flat"}
          </span>
        </header>

        <div className="grid grid-cols-12 gap-4 auto-rows-auto">
          <EquityHeroTile account={dv2.account} history={dv2.equityHistory ?? []} />
          <AccountsTile
            accounts={dv2.accounts}
            activeAccountId={dv2.activeAccountId}
            onSelect={dv2.setActiveAccount}
          />

          <KpiRow
            account={dv2.account}
            stats={dv2.stats}
            openPositionCount={dv2.openPositionCount}
          />

          <PositionsTile positions={positions} />
          <RiskTile metrics={dv2.metrics ?? undefined} account={dv2.account} />

          <ActivityTile
            fills={(Array.isArray(dv2.fills) ? dv2.fills : (dv2.fills?.data ?? [])) ?? []}
          />
        </div>
      </div>
    </div>
  );
}
