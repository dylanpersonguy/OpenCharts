import { usePositions } from "@/services/queries";
import { useDashboardV2 } from "../../dashboardv2/useDashboardV2";
import {
  AccountIndex,
  ActivityLedger,
  FiguresGrid,
  HeroEquity,
  OpenPositions,
  phaseLabel,
  RiskEnvelope,
} from "./meridian-dashboard-sections";
import { useMeridianScope } from "./meridian-scope";
import "./meridian.css";

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function Masthead({ name, phase }: { name: string; phase: string }) {
  return (
    <header className="mr-reveal mb-6">
      <div className="flex items-baseline justify-between pb-2">
        <h1 className="mr-display text-lg uppercase tracking-tight">Portfolio Overview</h1>
        <span className="mr-microlabel">{DATE_FMT.format(new Date()).toUpperCase()}</span>
      </div>
      <hr className="mr-rule-strong" />
      <div className="flex items-baseline justify-between pt-1.5">
        <span className="mr-microlabel">{name}</span>
        <span className="mr-microlabel !text-accent">{phase}</span>
      </div>
    </header>
  );
}

/**
 * Meridian dashboard — Swiss Modernism 2.0.
 * 12-column grid, hairline rules, indexed sections, one cobalt accent.
 */
export function MeridianDashboardPage() {
  useMeridianScope();
  const dv2 = useDashboardV2();
  const { data: positions = [] } = usePositions(dv2.activeAccountId);

  return (
    <div className="mr-page">
      <div className="mx-auto max-w-[1280px] px-6 py-8">
        <Masthead name={dv2.user?.email ?? "Trader"} phase={phaseLabel(dv2.account?.phase)} />

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-8">
            <HeroEquity account={dv2.account} history={dv2.equityHistory ?? []} />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <AccountIndex
              accounts={dv2.accounts}
              activeAccountId={dv2.activeAccountId}
              onSelect={dv2.setActiveAccount}
            />
          </div>

          <div className="col-span-12 lg:col-span-8">
            <FiguresGrid
              account={dv2.account}
              stats={dv2.stats}
              openPositionCount={dv2.openPositionCount}
            />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <RiskEnvelope metrics={dv2.metrics ?? undefined} />
          </div>

          <div className="col-span-12 lg:col-span-8">
            <OpenPositions positions={positions} />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <ActivityLedger
              fills={(Array.isArray(dv2.fills) ? dv2.fills : (dv2.fills?.data ?? [])) ?? []}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
