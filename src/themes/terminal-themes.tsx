import { type ComponentType, type LazyExoticComponent, lazy } from "react";

/**
 * Terminal theme catalog.
 *
 * A theme bundles a Dashboard and a Trading page implementation. The firm
 * admin picks one in the backoffice (Storefront → Terminal Themes) and the
 * choice is stored in `firm.branding.terminalTheme`. Traders cannot override
 * the firm's choice.
 *
 * Adding a theme = add lazy page components + one entry here + a matching
 * catalog card in the backoffice picker.
 */

export type TerminalPageKind = "dashboard" | "trading";

export interface TerminalThemeDef {
  id: string;
  name: string;
  tagline: string;
  Dashboard: LazyExoticComponent<ComponentType>;
  Trading: LazyExoticComponent<ComponentType>;
}

const DashboardAurora = lazy(() =>
  import("../pages/dashboardv2/DashboardV2Page.tsx").then((m) => ({
    default: m.DashboardV2Page,
  })),
);
const TradingAurora = lazy(() =>
  import("../pages/TradingPage.tsx").then((m) => ({ default: m.TradingPage })),
);
const TradingNova = lazy(() =>
  import("../pages/trading-v2/TradingV2Page.tsx").then((m) => ({
    default: m.TradingV2Page,
  })),
);
const DashboardMeridian = lazy(() =>
  import("../pages/themes/meridian/MeridianDashboardPage.tsx").then((m) => ({
    default: m.MeridianDashboardPage,
  })),
);
const TradingMeridian = lazy(() =>
  import("../pages/themes/meridian/MeridianTradingPage.tsx").then((m) => ({
    default: m.MeridianTradingPage,
  })),
);
const TradingObsidian = lazy(() =>
  import("../pages/themes/obsidian/ObsidianTradingPage.tsx").then((m) => ({
    default: m.ObsidianTradingPage,
  })),
);
const TradingLumen = lazy(() =>
  import("../pages/themes/lumen/LumenTradingPage.tsx").then((m) => ({
    default: m.LumenTradingPage,
  })),
);
const TradingNebula = lazy(() =>
  import("../pages/themes/nebula/NebulaTradingPage.tsx").then((m) => ({
    default: m.NebulaTradingPage,
  })),
);
const TradingTape = lazy(() =>
  import("../pages/themes/tape/TapeTradingPage.tsx").then((m) => ({
    default: m.TapeTradingPage,
  })),
);
const TradingZen = lazy(() =>
  import("../pages/themes/zen/ZenTradingPage.tsx").then((m) => ({
    default: m.ZenTradingPage,
  })),
);
const TradingHelm = lazy(() =>
  import("../pages/themes/helm/HelmTradingPage.tsx").then((m) => ({
    default: m.HelmTradingPage,
  })),
);
const DashboardVanta = lazy(() =>
  import("../pages/themes/vanta/VantaDashboardPage.tsx").then((m) => ({
    default: m.VantaDashboardPage,
  })),
);
const TradingVanta = lazy(() =>
  import("../pages/themes/vanta/VantaTradingPage.tsx").then((m) => ({
    default: m.VantaTradingPage,
  })),
);

/** Default when a firm has never picked a theme — today's stock experience. */
export const DEFAULT_TERMINAL_THEME_ID = "aurora";

export const TERMINAL_THEMES: Record<string, TerminalThemeDef> = {
  aurora: {
    id: "aurora",
    name: "Aurora",
    tagline: "The PropSim default — dark glass dashboard with the classic trading desk.",
    Dashboard: DashboardAurora,
    Trading: TradingAurora,
  },
  nova: {
    id: "nova",
    name: "Nova",
    tagline: "Full cockpit — dark glass dashboard plus the islands-style trading desk.",
    Dashboard: DashboardAurora,
    Trading: TradingNova,
  },
  meridian: {
    id: "meridian",
    name: "Meridian",
    tagline: "Institutional light — Swiss grid, paper surfaces, a single cobalt accent.",
    Dashboard: DashboardMeridian,
    Trading: TradingMeridian,
  },
  obsidian: {
    id: "obsidian",
    name: "Obsidian",
    tagline: "Graphite pro-exchange — slate surfaces, electric blue, compact data density.",
    Dashboard: DashboardAurora,
    Trading: TradingObsidian,
  },
  lumen: {
    id: "lumen",
    name: "Lumen",
    tagline: "Soft near-black with a mint glow — generous radii, calm premium feel.",
    Dashboard: DashboardAurora,
    Trading: TradingLumen,
  },
  nebula: {
    id: "nebula",
    name: "Nebula",
    tagline: "Neon violet aurora — glass panels, drifting mesh gradient, gold/pink markets.",
    Dashboard: DashboardAurora,
    Trading: TradingNebula,
  },
  tape: {
    id: "tape",
    name: "Tape",
    tagline: "Phosphor terminal mosaic — quote board, titled tiles, F-key blotter.",
    Dashboard: DashboardAurora,
    Trading: TradingTape,
  },
  zen: {
    id: "zen",
    name: "Zen",
    tagline: "The chart is the page — floating HUD, trade pod and edge drawers.",
    Dashboard: DashboardAurora,
    Trading: TradingZen,
  },
  helm: {
    id: "helm",
    name: "Helm",
    tagline: "Carbon cockpit — marquee ticker, positions rail, bottom trade console.",
    Dashboard: DashboardAurora,
    Trading: TradingHelm,
  },
  vanta: {
    id: "vanta",
    name: "Vanta",
    tagline: "Luxury near-black bento dashboard — gold serif numerals, spotlight tiles.",
    Dashboard: DashboardVanta,
    Trading: TradingVanta,
  },
};

const FALLBACK_THEME: TerminalThemeDef = {
  id: "aurora",
  name: "Aurora",
  tagline: "The PropSim default — dark glass dashboard with the classic trading desk.",
  Dashboard: DashboardAurora,
  Trading: TradingAurora,
};

export function resolveTerminalTheme(themeId: unknown): TerminalThemeDef {
  const id = typeof themeId === "string" ? themeId : DEFAULT_TERMINAL_THEME_ID;
  return TERMINAL_THEMES[id] ?? FALLBACK_THEME;
}
