import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ReplaySessionsPage } from "./pages/replay/ReplaySessionsPage.tsx";
import { ReplayStatsPage } from "./pages/replay/ReplayStatsPage.tsx";
import { ReplayTerminalPage } from "./pages/replay/ReplayTerminalPage.tsx";
import { TradingPage } from "./pages/TradingPage.tsx";
import { useAuthStore, useTradingStore } from "./services/store.tsx";

/**
 * OpenCharts entry point.
 *
 * No auth: the app boots straight into the trading terminal backed by the
 * in-browser demo session (real bundled OHLC + paper-trading engine). A demo
 * "login" seeds the local user/account and starts the market-data feed.
 * `/replay` hosts the bar-replay backtester (sessions, terminal, stats).
 */
export function App() {
  const [ready, setReady] = useState(false);
  const demoLogin = useAuthStore((s) => s.demoLogin);
  const loadSymbols = useTradingStore((s) => s.loadSymbols);
  const loadAccounts = useTradingStore((s) => s.loadAccounts);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      await demoLogin();
      // OpenCharts paper trades genuinely execute against the in-browser engine,
      // so this is a real (non-demo) session — clears the "trading disabled" gate.
      localStorage.setItem("is_demo", "false");
      useAuthStore.setState({ isDemo: false });
      await Promise.all([loadSymbols(), loadAccounts()]);
      if (!cancelled) setReady(true);
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [demoLogin, loadSymbols, loadAccounts]);

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-neutral-400">
        Loading OpenCharts…
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<TradingPage />} />
      <Route path="/replay" element={<ReplaySessionsPage />} />
      <Route path="/replay/:sessionId" element={<ReplayTerminalPage />} />
      <Route path="/replay/:sessionId/stats" element={<ReplayStatsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
