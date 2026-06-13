import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore, useTradingStore } from "../services/store.tsx";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePositions,
  useMyFirm,
  useFeatureFlags,
  useAnnouncementsUnreadCount,
} from "../services/queries.ts";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { setFirmSlug } from "../lib/firmResolver";
import { AccountSelector } from "./AccountSelector";
import { ConnectionIndicator, StaleDataBanner } from "./ConnectionIndicator";
import { useToastNotifications, ToastContainer } from "./ToastNotifications";
import { computeLivePnl } from "../lib/livePnl";

import { NotificationsPanel, useNotifications } from "./NotificationsPanel";
import { useSymbolInterest } from "../hooks/useSymbolInterest.ts";
import {
  LayoutDashboard,
  TrendingUp,
  History,
  Target,
  Settings,
  LogOut,
  Sun,
  Moon,
  Shield,
  UserCheck,
  Users,
  Bell,
  ChevronDown,
  ShoppingCart,
  Trophy,
  Award,
  MessageSquare,
  Megaphone,
  Swords,
  BookOpen,
  Eye,
  Bot,
  Radio,
  UserCircle,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { usePageTracking } from "../hooks/usePageTracking";
import { useTraderPreferences } from "../hooks/useTraderPreferences.ts";

type NavLinkItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  flag?: string;
};

type NavGroupItem = {
  label: string;
  icon: LucideIcon;
  children: NavLinkItem[];
  flag?: string;
};

type NavItem = NavLinkItem | NavGroupItem;

type AccountView = {
  id: string;
  label?: string | null;
  status: string;
  phase?: string;
  balance: number;
  startingBalance?: number;
  isHftMode?: boolean;
};

type BrandMap = {
  faviconUrl?: string;
  logoUrl?: string;
  logoUrlDark?: string;
  logoUrlLight?: string;
  logoHeight?: number;
};

type FirmView = {
  name?: string;
  slug?: string;
  branding?: unknown;
};

type UserView = {
  firstName?: string | null;
  email?: string | null;
};

function asBrandMap(value: unknown): BrandMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as BrandMap;
}

const allNavItems: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/trading", label: "Trade", icon: TrendingUp },
  { to: "/history", label: "History", icon: History },
  {
    label: "Challenge",
    icon: Target,
    children: [
      { to: "/store", label: "Store", icon: ShoppingCart },
      { to: "/challenge", label: "My Challenge", icon: Target },
      { to: "/payouts", label: "Payouts", icon: Wallet },
      { to: "/competitions", label: "Competitions", icon: Swords },
      { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
    ],
  },
];

// Flat list for mobile bottom nav
const allMobileNavItems: NavLinkItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/trading", label: "Trade", icon: TrendingUp },
  { to: "/history", label: "History", icon: History },
  { to: "/challenge", label: "Challenge", icon: Target },
];

const allSideNavItems: NavLinkItem[] = [
  { to: "/announcements", label: "Messages", icon: Megaphone },
  { to: "/payouts", label: "Payouts", icon: Wallet },
  { to: "/docs", label: "Documentation", icon: BookOpen },
  { to: "/affiliates", label: "Affiliates", icon: Users, flag: "affiliates" },
  {
    to: "/certificates",
    label: "Certificates",
    icon: Award,
    flag: "certificates",
  },
  { to: "/integrations", label: "Integrations", icon: Radio, flag: "ENABLE_DISCORD_BOT" },
  {
    to: "/public-profile",
    label: "Public Profile",
    icon: UserCircle,
    flag: "ENABLE_PUBLIC_PROFILES",
  },
  // Scaling Plan, Profit Split, Account Merge — hidden pending QA (PS-286, PS-287, PS-288)
  { to: "/support", label: "Support", icon: MessageSquare },
  { to: "/kyc", label: "KYC", icon: UserCheck },
  { to: "/security", label: "Security", icon: Shield },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout() {
  const user = useAuthStore((s) => s.user as UserView | null);
  const logout = useAuthStore((s) => s.logout);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const navigate = useNavigate();
  const location = useLocation();
  const accounts = useTradingStore((s) => s.accounts as AccountView[]);
  const activeAccountId = useTradingStore((s) => s.activeAccountId);
  const loadAccounts = useTradingStore((s) => s.loadAccounts);
  const loadSymbols = useTradingStore((s) => s.loadSymbols);
  const { theme, toggle: toggleTheme } = useTheme();
  usePageTracking();
  // Desktop shows the full watchlist with live quotes, so it needs every
  // symbol — explicit "all" keeps behavior identical when per-symbol WS
  // filtering (p04) is enabled.
  useSymbolInterest("desktop-layout", "all");
  const queryClient = useQueryClient();
  const { toasts, removeToast } = useToastNotifications();
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();
  const { data: announcementsUnread } = useAnnouncementsUnreadCount();
  const announcementsUnreadCount = announcementsUnread?.unreadCount ?? 0;
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [navDropdown, setNavDropdown] = useState<string | null>(null);
  const [_marginLevel, _setMarginLevel] = useState<number | null>(null);
  const { data: firm } = useMyFirm();
  const { data: featureFlags } = useFeatureFlags();
  const isDemo = useAuthStore((s) => s.isDemo);
  useTraderPreferences();
  const firmData = firm as FirmView | undefined;
  const firmBranding = asBrandMap(firmData?.branding);

  // Check if user has at least one active HFT account
  const hasHftAccount = useMemo(
    () => accounts.some((a) => a.isHftMode && a.status === "ACTIVE"),
    [accounts],
  );

  // Filter nav items based on marketplace feature flags; inject HFT Bot tab for HFT users (desktop only)
  const navItems = useMemo(() => {
    const items = allNavItems.filter((item) => !item.flag || featureFlags?.[item.flag]);
    if (hasHftAccount) {
      return [...items, { to: "/bot", label: "HFT Bot", icon: Bot } as NavLinkItem];
    }
    return items;
  }, [featureFlags, hasHftAccount]);
  const mobileNavItems = useMemo(
    () => allMobileNavItems.filter((item) => !item.flag || featureFlags?.[item.flag]),
    [featureFlags],
  );
  const sideNavItems = useMemo(
    () => allSideNavItems.filter((item) => !item.flag || featureFlags?.[item.flag]),
    [featureFlags],
  );

  const closeStuckDialogs = () => {
    document.querySelectorAll("dialog[open]").forEach((el) => {
      try {
        (el as HTMLDialogElement).close();
      } catch {}
    });
  };

  useEffect(() => {
    setNotifOpen(false);
    setMenuOpen(false);
    setStatsOpen(false);
    setNavDropdown(null);
    closeStuckDialogs();
  }, [location.pathname]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNotifOpen(false);
      setMenuOpen(false);
      setStatsOpen(false);
      setNavDropdown(null);
      closeStuckDialogs();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => {
    closeStuckDialogs();
  }, []);

  useEffect(() => {
    restoreSession();
    loadAccounts();
    loadSymbols();
  }, [restoreSession, loadAccounts, loadSymbols]);

  // Recover when user returns to the app after the phone was locked/backgrounded.
  // visibilitychange fires on screen wake; online fires on network reconnect.
  // Both paths: re-validate the token first (may have expired while sleeping),
  // THEN invalidate queries — this prevents API calls going out with an expired
  // token, which can race the refresh and briefly show stale/wrong branding.
  useEffect(() => {
    const recover = async () => {
      if (document.hidden) return;
      await restoreSession();
      queryClient.invalidateQueries();
    };
    document.addEventListener("visibilitychange", recover);
    window.addEventListener("online", recover);
    return () => {
      document.removeEventListener("visibilitychange", recover);
      window.removeEventListener("online", recover);
    };
  }, [restoreSession, queryClient]);

  // Force logout when request.ts signals that a token refresh failed mid-flight.
  useEffect(() => {
    const handleSessionExpired = () => {
      logout();
      navigate("/login", { state: { sessionExpired: true } });
    };
    window.addEventListener("session:expired", handleSessionExpired);
    return () => window.removeEventListener("session:expired", handleSessionExpired);
  }, [logout, navigate]);

  // Sync firm slug in sessionStorage so firmResolver stays consistent with the
  // authenticated user's actual firm (prevents desync after login/register).
  useEffect(() => {
    if (firmData?.slug) {
      setFirmSlug(firmData.slug);
    }
  }, [firmData?.slug]);

  // Set favicon dynamically from firm branding
  useEffect(() => {
    const faviconUrl = firmBranding?.faviconUrl;
    if (!faviconUrl) return;
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }, [firmBranding?.faviconUrl]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  // Active account stats — live-computed from positions (2s polling)
  const { data: livePositions } = usePositions(activeAccountId);
  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId),
    [accounts, activeAccountId],
  );
  const startBal = activeAccount ? activeAccount.startingBalance || activeAccount.balance : 0;

  // Real-time floating PNL — derive on every tick instead of waiting for poll
  const ticks = useTradingStore((s) => s.ticks);
  const floatingPnl = useMemo(
    () => (livePositions ?? []).reduce((sum, p) => sum + computeLivePnl(p, ticks[p.symbolName]), 0),
    [livePositions, ticks],
  );
  const usedMargin = useMemo(
    () => (livePositions ?? []).reduce((sum, p) => sum + (p.margin ?? 0), 0),
    [livePositions],
  );
  // Live equity = balance + floating PNL (updates with position polling)
  const liveEquity = activeAccount ? activeAccount.balance + floatingPnl : 0;
  const liveFreeMargin = activeAccount ? liveEquity - usedMargin : 0;

  const pnl = activeAccount ? liveEquity - startBal : 0;
  const pnlPercent = startBal ? ((pnl / startBal) * 100).toFixed(2) : "0.00";
  const freeMargin = liveFreeMargin;
  const mLevel = usedMargin > 0 ? (liveEquity / usedMargin) * 100 : null;

  return (
    <div className="flex flex-col h-full">
      <StaleDataBanner />
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Demo Mode Banner */}
      {isDemo && (
        <div className="bg-amber-500/90 text-black text-center py-1.5 text-xs font-semibold tracking-wide shrink-0 flex items-center justify-center gap-2">
          <Eye className="h-3.5 w-3.5" />
          READ-ONLY DEMO — Trading and configuration changes are disabled
          <a
            href={import.meta.env.VITE_LANDING_URL ?? "https://propsim.markets/checkout"}
            className="ml-2 underline font-bold hover:text-white transition-colors"
          >
            Get Full Access &rarr;
          </a>
        </div>
      )}

      {/* ─── Top Header Bar ─────────────────────────────── */}
      <header
        className="flex items-center h-11 bg-card border-b border-border/60 shrink-0"
        role="banner"
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 border-r border-border/40 h-full">
          {(() => {
            const b = firmBranding;
            const resolvedLogo =
              theme === "dark" ? b?.logoUrlDark || b?.logoUrl : b?.logoUrlLight || b?.logoUrl;
            if (resolvedLogo) {
              return (
                <img
                  src={resolvedLogo}
                  alt={firmData?.name || "Logo"}
                  style={{ height: Math.min(b?.logoHeight || 26, 35) }}
                  className="max-w-[132px] sm:max-w-[176px] object-contain"
                />
              );
            }
            // No logo uploaded — show firm name without platform branding
            const name = firmData?.name || "Trading Platform";
            return (
              <span className="font-bold text-foreground text-sm tracking-tight truncate max-w-[120px] sm:max-w-[160px]">
                {name}
              </span>
            );
          })()}
        </div>

        {/* Account selector */}
        <AccountSelector />

        {/* Main Nav Tabs */}
        <nav className="hidden md:flex items-center h-full ml-1" aria-label="Main navigation">
          {navItems.map((item) => {
            if ("children" in item) {
              const isChildActive = item.children.some(
                (c: NavLinkItem) =>
                  location.pathname === c.to ||
                  (c.to !== "/dashboard" && location.pathname.startsWith(c.to)),
              );
              return (
                <div key={item.label} className="relative h-full">
                  <button
                    type="button"
                    onClick={() => setNavDropdown(navDropdown === item.label ? null : item.label)}
                    className={cn(
                      "flex items-center gap-1.5 px-4 h-full text-xs font-semibold tracking-wide border-b-2 transition-all duration-200 cursor-pointer",
                      isChildActive
                        ? "text-accent border-accent bg-accent/5"
                        : navDropdown === item.label
                          ? "text-foreground border-transparent bg-secondary/30"
                          : "text-muted-foreground border-transparent hover:text-foreground hover:bg-secondary/30",
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 text-muted-foreground transition-transform",
                        navDropdown === item.label && "rotate-180",
                      )}
                    />
                  </button>
                  {navDropdown === item.label && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setNavDropdown(null)} />
                      <div className="absolute left-0 top-full z-50 w-44 bg-card border border-border/60 rounded-lg shadow-2xl shadow-black/40 py-1 mt-0.5 overflow-hidden">
                        {item.children.map((child: NavLinkItem) => (
                          <NavLink
                            key={child.to}
                            to={child.to}
                            end={child.end}
                            onClick={() => setNavDropdown(null)}
                            className={({ isActive }) =>
                              cn(
                                "flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors",
                                isActive
                                  ? "text-accent bg-accent/5"
                                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                              )
                            }
                          >
                            <child.icon className="h-3.5 w-3.5" />
                            {child.label}
                          </NavLink>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 px-4 h-full text-xs font-semibold tracking-wide border-b-2 transition-all duration-200",
                    isActive
                      ? "text-accent border-accent bg-accent/5"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:bg-secondary/30",
                  )
                }
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Right: Live Stats */}
        <div className="ml-auto flex items-center h-full">
          {/* P&L Dropdown */}
          {activeAccount && (
            <div className="relative hidden sm:flex items-center border-l border-border/40 h-full">
              <button
                type="button"
                onClick={() => setStatsOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-2 px-4 h-full transition-colors cursor-pointer",
                  "hover:bg-secondary/30",
                  statsOpen && "bg-secondary/30",
                )}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  PNL
                </span>
                <span
                  className={cn(
                    "text-sm font-bold font-mono tabular-nums",
                    pnl >= 0 ? "text-buy glow-buy" : "text-sell glow-sell",
                  )}
                >
                  {pnl >= 0 ? "+" : ""}
                  {formatCurrency(pnl)}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-semibold font-mono",
                    pnl >= 0 ? "text-buy/70" : "text-sell/70",
                  )}
                >
                  ({pnl >= 0 ? "+" : ""}
                  {pnlPercent}%)
                </span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 text-muted-foreground transition-transform",
                    statsOpen && "rotate-180",
                  )}
                />
              </button>

              {/* Stats Dropdown */}
              {statsOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStatsOpen(false)} />
                  <div className="absolute right-0 top-full z-50 w-64 bg-card border border-border/60 rounded-lg shadow-2xl shadow-black/40 mt-0.5 overflow-hidden">
                    {/* Dropdown Header — PNL */}
                    <div
                      className={cn(
                        "px-4 py-3 border-b border-border/40",
                        pnl >= 0 ? "bg-buy/5" : "bg-sell/5",
                      )}
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                        Profit & Loss
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "text-lg font-bold font-mono tabular-nums",
                            pnl >= 0 ? "text-buy" : "text-sell",
                          )}
                        >
                          {pnl >= 0 ? "+" : ""}
                          {formatCurrency(pnl)}
                        </span>
                        <span
                          className={cn(
                            "text-xs font-semibold font-mono",
                            pnl >= 0 ? "text-buy/70" : "text-sell/70",
                          )}
                        >
                          {pnl >= 0 ? "+" : ""}
                          {pnlPercent}%
                        </span>
                      </div>
                    </div>

                    {/* Metrics List */}
                    <div className="p-2 space-y-0.5">
                      <div className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-secondary/30">
                        <span className="text-xs text-muted-foreground">Equity</span>
                        <span className="text-xs font-semibold font-mono tabular-nums text-accent">
                          {formatCurrency(liveEquity)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-secondary/30">
                        <span className="text-xs text-muted-foreground">Balance</span>
                        <span className="text-xs font-semibold font-mono tabular-nums">
                          {formatCurrency(activeAccount.balance)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-secondary/30">
                        <span className="text-xs text-muted-foreground">Starting Balance</span>
                        <span className="text-xs font-semibold font-mono tabular-nums text-muted-foreground">
                          {formatCurrency(startBal)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-secondary/30">
                        <span className="text-xs text-muted-foreground">Free Margin</span>
                        <span className="text-xs font-semibold font-mono tabular-nums">
                          {formatCurrency(freeMargin)}
                        </span>
                      </div>
                      {usedMargin > 0 && (
                        <div className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-secondary/30">
                          <span className="text-xs text-muted-foreground">Used Margin</span>
                          <span className="text-xs font-semibold font-mono tabular-nums">
                            {formatCurrency(usedMargin)}
                          </span>
                        </div>
                      )}
                      {mLevel !== null && (
                        <div className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-secondary/30">
                          <span className="text-xs text-muted-foreground">Margin Level</span>
                          <span
                            className={cn(
                              "text-xs font-semibold font-mono tabular-nums",
                              mLevel > 200
                                ? "text-buy"
                                : mLevel > 100
                                  ? "text-warning"
                                  : "text-sell",
                            )}
                          >
                            {mLevel.toFixed(0)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Utility Icons */}
          <div className="flex items-center gap-1 px-3 border-l border-border/40 h-full">
            <ConnectionIndicator />

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="h-7 w-7 p-0"
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 relative"
              onClick={() => setNotifOpen((v) => !v)}
            >
              <Bell className="h-3.5 w-3.5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 text-[9px] font-bold bg-accent text-accent-foreground rounded-full flex items-center justify-center live-pulse">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Button>

            {/* User avatar menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="h-8 w-8 rounded-full bg-accent/20 border-2 border-accent/50 flex items-center justify-center hover:bg-accent/30 hover:border-accent transition-all duration-200 cursor-pointer ring-2 ring-transparent hover:ring-accent/20"
                title="Account menu"
              >
                <span className="text-xs font-bold text-accent leading-none">
                  {(user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase()}
                </span>
              </button>
              {/* Dropdown */}
              {menuOpen && (
                <>
                  {/* Invisible backdrop to close on click-away */}
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="flex flex-col absolute right-0 top-full z-50 w-48 max-h-[70vh] overflow-y-auto bg-card border border-border/60 rounded-lg shadow-2xl shadow-black/40 py-1 mt-1">
                    <div className="px-3 py-2 border-b border-border/40">
                      <p className="text-xs font-medium truncate">{user?.email}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {activeAccount?.phase || "Challenge"}
                      </p>
                    </div>
                    {sideNavItems.map(({ to, label, icon: Icon }) => (
                      <NavLink
                        key={to}
                        to={to}
                        onClick={() => setMenuOpen(false)}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                            isActive
                              ? "text-accent bg-accent/5"
                              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                          )
                        }
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span className="flex-1">{label}</span>
                        {to === "/announcements" && announcementsUnreadCount > 0 && (
                          <span className="min-w-[16px] h-4 px-0.5 text-[9px] font-bold bg-orange-500 text-white rounded-full flex items-center justify-center">
                            {announcementsUnreadCount > 99 ? "99+" : announcementsUnreadCount}
                          </span>
                        )}
                      </NavLink>
                    ))}
                    <div className="border-t border-border/40 mt-1 pt-1">
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          handleLogout();
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive w-full transition-colors"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Logout
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Notifications Panel */}
      <NotificationsPanel
        isOpen={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkRead={markRead}
        onMarkAllRead={markAllRead}
        onClearAll={clearAll}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-auto pb-14 md:pb-0" role="main" aria-label="Page content">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation (#62) */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border/60 flex items-center justify-around h-14 safe-bottom"
        aria-label="Mobile navigation"
      >
        {mobileNavItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-medium transition-colors min-w-0",
                isActive ? "text-accent" : "text-muted-foreground",
              )
            }
          >
            <Icon className="h-5 w-5" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
