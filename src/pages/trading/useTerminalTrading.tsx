import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsFeedConnected } from "../../components/ConnectionIndicator.tsx";
import {
  OrderConfirmDialog,
  OrderModifyDialog,
  PositionModifyDialog,
} from "../../components/TradingDialogs.tsx";
import { useChartDrawings } from "../../hooks/useChartDrawings.ts";
import {
  getChartPreferencesFromStorage,
  updateChartPreferences,
  useChartPreferences,
} from "../../hooks/useChartPreferences.ts";
import { useTradeSound } from "../../hooks/useTradeSound";
import type { IndicatorType } from "../../lib/indicators.ts";
import type {
  CreateJournalEntryInput,
  UpdateJournalEntryInput,
} from "../../services/api/journal.ts";
import { api } from "../../services/api.ts";
import {
  useAiTraderEnabled,
  useCandles,
  useCreateJournalEntry,
  useDeleteJournalEntry,
  useJournalEntries,
  useOrders,
  usePositions,
  useSymbols,
  useUpdateJournalEntry,
} from "../../services/queries.ts";
import type {
  Order,
  PlaceOrderInput,
  Position,
  Symbol as SymbolInfo,
} from "../../services/schemas.ts";
import { useTradingStore } from "../../services/store.tsx";
import { toast } from "../../services/toast.ts";
import { ChartPanel } from "./ChartPanel.tsx";
import { type DrawingTool, type MagnetMode, TIMEFRAMES, type Timeframe } from "./constants.ts";
import { getPipDigits } from "./utils.ts";

/* ══════════════════════════════════════════════════════════════
   Shared trading-page machinery.
   Every terminal theme composes its own layout/chrome around this
   hook — state, queries and handlers live here exactly once.
   ══════════════════════════════════════════════════════════════ */

export type ConfirmOrderState = {
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  quantity: number;
  price?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  _submit: () => Promise<unknown>;
} | null;

export type RightPanelId = "order" | "dom" | "watchlist" | "news" | "ai-trader" | "tv-analysis";
export type BottomTabId =
  | "positions"
  | "orders"
  | "history"
  | "journal"
  | "calendar"
  | "news"
  | "ai-trader";

export function getErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Request failed";
}

/* Deep-history fetch sizes per timeframe (mirrors classic terminal). */
const DEEP_LIMITS: Record<string, number> = {
  "1m": 3_000,
  "5m": 5_000,
  "15m": 12_000,
  "30m": 8_000,
  "1h": 8_760,
  "4h": 2_500,
  "1d": 1_000,
  "1w": 520,
};

function useTimeframe(selectedSymbol: string) {
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const saved = localStorage.getItem(`tf_${selectedSymbol}`);
    return saved && TIMEFRAMES.includes(saved as Timeframe) ? (saved as Timeframe) : "15m";
  });
  const handleTimeframeChange = useCallback(
    (tf: Timeframe) => {
      setTimeframe(tf);
      localStorage.setItem(`tf_${selectedSymbol}`, tf);
    },
    [selectedSymbol],
  );
  useEffect(() => {
    const saved = localStorage.getItem(`tf_${selectedSymbol}`);
    if (saved && TIMEFRAMES.includes(saved as Timeframe)) setTimeframe(saved as Timeframe);
  }, [selectedSymbol]);
  return { timeframe, handleTimeframeChange };
}

function useProgressiveCandleLimit(selectedSymbol: string, timeframe: Timeframe) {
  const firstPaint = 400;
  const deep = DEEP_LIMITS[timeframe] ?? 5_000;
  const [limit, setLimit] = useState(firstPaint);
  // biome-ignore lint/correctness/useExhaustiveDependencies: symbol/timeframe switches deliberately retrigger the shallow-then-deep reload
  useEffect(() => {
    setLimit(firstPaint);
    const timer = window.setTimeout(() => setLimit(deep), 400);
    return () => window.clearTimeout(timer);
  }, [selectedSymbol, timeframe, deep]);
  return limit;
}

function useBottomResize(storageKey: string) {
  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? parseInt(saved, 10) : 230;
  });
  const startY = useRef(0);
  const startH = useRef(0);

  const onResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      startY.current = "touches" in e ? e.touches[0]!.clientY : e.clientY;
      startH.current = height;
      const onMove = (ev: MouseEvent | TouchEvent) => {
        const y = "touches" in ev ? ev.touches[0]!.clientY : (ev as MouseEvent).clientY;
        setHeight(Math.max(120, Math.min(600, startH.current + (startY.current - y))));
      };
      const onUp = () => {
        setHeight((h) => {
          localStorage.setItem(storageKey, String(h));
          return h;
        });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height, storageKey],
  );
  return { height, onResizeStart };
}

/* ── Journal wiring (kept identical to classic terminal) ── */
function useJournalHandlers(accountId: string | null) {
  const { data, isLoading } = useJournalEntries(accountId);
  const createMut = useCreateJournalEntry();
  const updateMut = useUpdateJournalEntry();
  const deleteMut = useDeleteJournalEntry();

  const create = useCallback(
    (input: CreateJournalEntryInput) =>
      createMut.mutate(input, {
        onSuccess: () => toast.success("Journal", "Entry saved"),
        onError: (err: unknown) => toast.error("Journal", getErrorMessage(err)),
      }),
    [createMut],
  );
  const update = useCallback(
    (id: string, input: UpdateJournalEntryInput) =>
      updateMut.mutate(
        { id, accountId: accountId!, ...input },
        {
          onSuccess: () => toast.success("Journal", "Entry updated"),
          onError: (err: unknown) => toast.error("Journal", getErrorMessage(err)),
        },
      ),
    [updateMut, accountId],
  );
  const remove = useCallback(
    (id: string) =>
      deleteMut.mutate(
        { id, accountId: accountId! },
        {
          onSuccess: () => toast.success("Journal", "Entry deleted"),
          onError: (err: unknown) => toast.error("Journal", getErrorMessage(err)),
        },
      ),
    [deleteMut, accountId],
  );

  return { entries: data?.entries || [], loading: isLoading, create, update, remove };
}

export type TerminalTradingApi = ReturnType<typeof useTerminalTrading>;

/**
 * All state, queries and handlers for a trading page.
 * `bottomHeightKey` keeps each theme's panel-resize preference separate.
 */
export function useTerminalTrading(bottomHeightKey: string) {
  const { selectedSymbol, setSelectedSymbol, ticks, updateTick, activeAccountId } =
    useTradingStore();
  const { timeframe, handleTimeframeChange } = useTimeframe(selectedSymbol);

  const [activeIndicators, setActiveIndicators] = useState<IndicatorType[]>([]);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("none");
  const drawingsApi = useChartDrawings(selectedSymbol, timeframe);
  const [activePlugins, setActivePlugins] = useState<string[]>(
    () => getChartPreferencesFromStorage().activePlugins,
  );
  const handleTogglePlugin = useCallback((id: string) => {
    setActivePlugins((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      updateChartPreferences({ activePlugins: next });
      return next;
    });
  }, []);
  // Template load — replace the whole plugin list at once.
  const handleSetPlugins = useCallback((ids: string[]) => {
    setActivePlugins(ids);
    updateChartPreferences({ activePlugins: ids });
  }, []);

  const [bottomTab, setBottomTab] = useState<BottomTabId>("positions");
  const [rightPanel, setRightPanel] = useState<RightPanelId>("order");
  const [showRightPanel, setShowRightPanel] = useState(true);
  const { height: bottomPanelHeight, onResizeStart } = useBottomResize(bottomHeightKey);

  const [oneClick, setOneClick] = useState(
    () => localStorage.getItem("oneClickTrading") === "true",
  );
  const toggleOneClick = useCallback(() => {
    setOneClick((prev) => {
      localStorage.setItem("oneClickTrading", String(!prev));
      return !prev;
    });
  }, []);
  const { muted: soundMuted, toggleMute: toggleSoundMute, playTradeSound } = useTradeSound();

  const [modifyingPosition, setModifyingPosition] = useState<Position | null>(null);
  const [modifyingOrder, setModifyingOrder] = useState<Order | null>(null);
  const [confirmOrder, setConfirmOrder] = useState<ConfirmOrderState>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const queryClient = useQueryClient();
  const { data: symbols = [] } = useSymbols();
  const { data: aiTraderEnabled } = useAiTraderEnabled();
  const isFeedConnected = useIsFeedConnected();

  // Prime bid/ask with a snapshot on symbol switch (WS stream stays authoritative).
  useEffect(() => {
    let cancelled = false;
    void api
      .getTick(selectedSymbol)
      .then((tick) => {
        if (cancelled || !tick) return;
        updateTick(
          selectedSymbol,
          Number(tick.bid),
          Number(tick.ask),
          typeof tick.timestamp === "number" ? tick.timestamp : Date.now(),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, updateTick]);

  const handleChartModifyPosition = useCallback(
    async (positionId: string, mods: { takeProfit?: number | null; stopLoss?: number | null }) => {
      if (!isFeedConnected) {
        toast.warning("No Data Feed", "Cannot modify positions while disconnected");
        return;
      }
      try {
        await api.modifyPosition(positionId, mods);
        const field = mods.takeProfit !== undefined ? "TP" : "SL";
        toast.success(`${field} Updated`, `${field} saved`);
      } catch (err: unknown) {
        toast.error("Modify Failed", getErrorMessage(err));
      } finally {
        if (activeAccountId) {
          queryClient.invalidateQueries({ queryKey: ["positions", activeAccountId] });
        }
      }
    },
    [activeAccountId, queryClient, isFeedConnected],
  );

  // Chart context-menu quick orders — always routed through the confirm dialog.
  const handleQuickOrder = useCallback(
    (side: "BUY" | "SELL", type: "LIMIT" | "STOP", price: number) => {
      if (!activeAccountId) {
        toast.warning("No Account", "Select an account before placing orders");
        return;
      }
      const input: PlaceOrderInput = {
        accountId: activeAccountId,
        symbol: selectedSymbol,
        side,
        type,
        quantity: 1,
        ...(type === "LIMIT" ? { price } : { stopPrice: price }),
      };
      setConfirmOrder({
        symbol: selectedSymbol,
        side,
        type,
        quantity: 1,
        price: type === "LIMIT" ? price : undefined,
        stopPrice: type === "STOP" ? price : undefined,
        _submit: () => api.placeOrder(input),
      });
    },
    [activeAccountId, selectedSymbol],
  );

  const handleClearIndicators = useCallback(() => {
    setActiveIndicators([]);
  }, []);

  const candleLimit = useProgressiveCandleLimit(selectedSymbol, timeframe);
  const { data: candles = [] } = useCandles(selectedSymbol, timeframe, candleLimit, 0);
  const chartPrefs = useChartPreferences();
  const cycleMagnetMode = useCallback(() => {
    const order: MagnetMode[] = ["none", "weak", "strong"];
    const next = order[(order.indexOf(chartPrefs.magnetMode) + 1) % order.length] ?? "none";
    updateChartPreferences({ magnetMode: next });
  }, [chartPrefs.magnetMode]);

  const { data: positions = [] } = usePositions(activeAccountId);
  const { data: orders = [] } = useOrders(activeAccountId);
  const chartPositions = chartPrefs.overlayPositionsOnChart ? positions : [];
  const chartOrders = chartPrefs.overlayPositionsOnChart ? orders : [];
  const positionPnl = useMemo(
    () => positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0),
    [positions],
  );

  const journal = useJournalHandlers(activeAccountId);
  const account = useTradingStore((s) => s.accounts.find((a) => a.id === activeAccountId));
  const tick = ticks[selectedSymbol];
  const symbolInfo = symbols.find((s) => s.name === selectedSymbol) as SymbolInfo | undefined;
  const liveCandleUpdates = useTradingStore((s) => s.liveCandleUpdates);
  const liveCandle = liveCandleUpdates[`${selectedSymbol}:${timeframe}`];
  const pipDigits = useMemo(
    () => getPipDigits(symbolInfo, selectedSymbol),
    [symbolInfo, selectedSymbol],
  );

  return {
    selectedSymbol,
    setSelectedSymbol,
    ticks,
    activeAccountId,
    timeframe,
    handleTimeframeChange,
    activeIndicators,
    setActiveIndicators,
    showIndicatorMenu,
    setShowIndicatorMenu,
    drawingTool,
    setDrawingTool,
    drawingsApi,
    activePlugins,
    handleTogglePlugin,
    handleSetPlugins,
    bottomTab,
    setBottomTab,
    rightPanel,
    setRightPanel,
    showRightPanel,
    setShowRightPanel,
    bottomPanelHeight,
    onResizeStart,
    oneClick,
    toggleOneClick,
    soundMuted,
    toggleSoundMute,
    playTradeSound,
    modifyingPosition,
    setModifyingPosition,
    modifyingOrder,
    setModifyingOrder,
    confirmOrder,
    setConfirmOrder,
    confirmLoading,
    setConfirmLoading,
    symbols,
    aiTraderEnabled,
    isFeedConnected,
    handleChartModifyPosition,
    handleQuickOrder,
    handleClearIndicators,
    candles,
    chartPrefs,
    cycleMagnetMode,
    positions,
    orders,
    chartPositions,
    chartOrders,
    positionPnl,
    journal,
    account,
    tick,
    symbolInfo,
    liveCandle,
    pipDigits,
  };
}

/* ── Shared chart composition ───────────────────────────────── */

export function ChartArea({ t, isDark }: { t: TerminalTradingApi; isDark: boolean }) {
  const { drawingsApi, chartPrefs } = t;
  return (
    <ChartPanel
      candles={t.candles as never[]}
      selectedSymbol={t.selectedSymbol}
      timeframe={t.timeframe}
      isDark={isDark}
      activeIndicators={t.activeIndicators}
      drawingTool={t.drawingTool}
      drawings={drawingsApi.drawings}
      onAddDrawing={drawingsApi.addDrawing}
      onUpdateDrawing={drawingsApi.updateDrawing}
      onRemoveDrawing={drawingsApi.removeDrawing}
      onDrawingComplete={() => t.setDrawingTool("none")}
      onDrawingToolSelect={t.setDrawingTool}
      onUndoDrawing={drawingsApi.undo}
      onRedoDrawing={drawingsApi.redo}
      magnetMode={chartPrefs.magnetMode}
      stayInDrawingMode={chartPrefs.stayInDrawingMode}
      positions={t.chartPositions}
      orders={t.chartOrders}
      tick={t.tick}
      liveCandle={t.liveCandle as never}
      pipDigits={t.pipDigits}
      symbolInfo={t.symbolInfo}
      onModifyPosition={t.handleChartModifyPosition}
      replayTradeEvents={undefined}
      activePlugins={t.activePlugins}
      onTogglePlugin={t.handleTogglePlugin}
      accountEquity={t.account?.equity ?? t.account?.balance ?? 0}
      accountId={t.activeAccountId}
      onQuickOrder={t.handleQuickOrder}
      onClearDrawings={drawingsApi.clearDrawings}
      onClearIndicators={t.handleClearIndicators}
    />
  );
}

/* ── Shared modal dialogs ───────────────────────────────────── */

export function TradingDialogsHost({ t }: { t: TerminalTradingApi }) {
  return (
    <>
      <PositionModifyDialog
        position={t.modifyingPosition}
        onClose={() => t.setModifyingPosition(null)}
        onSaved={() => t.setModifyingPosition(null)}
        tick={t.tick}
        isFeedConnected={t.isFeedConnected}
      />
      <OrderModifyDialog
        order={t.modifyingOrder}
        onClose={() => t.setModifyingOrder(null)}
        onSaved={() => t.setModifyingOrder(null)}
        tick={t.tick}
      />
      <OrderConfirmDialog
        isOpen={!!t.confirmOrder}
        order={t.confirmOrder}
        onConfirm={() => {
          if (!t.confirmOrder?._submit) return;
          t.setConfirmLoading(true);
          t.confirmOrder
            ._submit()
            .then(() => t.playTradeSound())
            .finally(() => {
              t.setConfirmLoading(false);
              t.setConfirmOrder(null);
            });
        }}
        onCancel={() => t.setConfirmOrder(null)}
        tick={t.tick}
        symbolInfo={t.symbolInfo}
        loading={t.confirmLoading}
      />
    </>
  );
}
