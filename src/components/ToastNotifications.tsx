/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, useCallback } from "react";
import { wsClient } from "../services/ws.ts";
import { toast as toastBus } from "../services/toast.ts";

// #46: Toast notification system for WS events
// #40: Breach notification modal/toast

export interface Toast {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: number;
}

type WsEvent = {
  eventType?: string;
  side?: string;
  quantity?: number | string;
  symbol?: string;
  price?: number;
  triggerPrice?: number;
  reasonMessage?: string;
  reason?: string;
  realizedPnl?: number;
  commission?: number;
  marginLevel?: number;
  phase?: string;
  ruleCode?: string;
  currentValue?: number;
  threshold?: number;
  action?: string;
  type?: string;
  amount?: number;
  balance?: number;
  previousPhase?: string;
  newPhase?: string;
  equity?: number;
  dailyPnl?: number;
} & Record<string, unknown>;

let toastId = 0;

export function useToastNotifications(options?: {
  maxToasts?: number;
  autoRemoveMs?: number;
  suppressEventTypes?: string[];
}) {
  const { maxToasts = 10, autoRemoveMs = 6000, suppressEventTypes } = options ?? {};
  const suppressSet = suppressEventTypes ? new Set(suppressEventTypes) : null;

  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (type: Toast["type"], title: string, message: string) => {
      const toast: Toast = {
        id: `toast-${++toastId}`,
        type,
        title,
        message,
        timestamp: Date.now(),
      };
      setToasts((prev) => [...prev.slice(-(maxToasts - 1)), toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, autoRemoveMs);
    },
    [maxToasts, autoRemoveMs],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Subscribe to global toast bus (for imperative toasts from mutations, etc.)
  useEffect(() => {
    return toastBus.subscribe((t) => addToast(t.type, t.title, t.message));
  }, [addToast]);

  // Subscribe to WS events for toast notifications
  // Channel names must match EVENT_CHANNELS: market-data, orders, positions, account, ledger, rules, audit, system
  useEffect(() => {
    const skip = (eventType: string) => suppressSet?.has(eventType) ?? false;
    const unsubs = [
      // ── Order events (channel: 'orders') ──
      wsClient.subscribe("orders", (event) => {
        const wsEvent = event as WsEvent;
        switch (wsEvent.eventType) {
          case "OrderFilled":
            if (!skip("OrderFilled"))
              addToast(
                "success",
                "Order Filled",
                `${wsEvent.side || ""} ${wsEvent.quantity || ""} ${wsEvent.symbol || ""} @ ${typeof wsEvent.price === "number" ? wsEvent.price.toFixed(5) : "market"}`.trim(),
              );
            break;
          case "OrderRejected":
            if (!skip("OrderRejected"))
              addToast(
                "error",
                "Order Rejected",
                wsEvent.reasonMessage || wsEvent.reason || "Order was rejected by the system",
              );
            break;
          case "OrderCanceled":
            if (!skip("OrderCanceled"))
              addToast(
                "info",
                "Order Canceled",
                `Order canceled${wsEvent.reason ? `: ${wsEvent.reason}` : ""}`,
              );
            break;
          case "OrderAccepted":
            if (!skip("OrderAccepted"))
              addToast(
                "info",
                "Order Accepted",
                wsEvent.symbol
                  ? `${wsEvent.side} ${wsEvent.quantity} ${wsEvent.symbol} accepted`
                  : "Your order has been accepted",
              );
            break;
          case "OrderTriggered":
            if (!skip("OrderTriggered"))
              addToast(
                "info",
                "Order Triggered",
                `Pending order triggered${typeof wsEvent.triggerPrice === "number" ? ` @ ${wsEvent.triggerPrice.toFixed(5)}` : ""}`,
              );
            break;
        }
      }),

      // ── Position events (channel: 'positions') ──
      wsClient.subscribe("positions", (event) => {
        const wsEvent = event as WsEvent;
        switch (wsEvent.eventType) {
          case "PositionOpened":
            if (!skip("PositionOpened"))
              addToast(
                "info",
                "Position Opened",
                `${wsEvent.side || ""} ${wsEvent.quantity || ""} ${wsEvent.symbol || ""}${typeof wsEvent.price === "number" ? ` @ ${wsEvent.price.toFixed(5)}` : ""}`.trim(),
              );
            break;
          case "PositionClosed": {
            if (!skip("PositionClosed")) {
              const pnl = wsEvent.realizedPnl || 0;
              addToast(
                pnl >= 0 ? "success" : "warning",
                "Position Closed",
                `P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (commission: ${(wsEvent.commission || 0).toFixed(2)})`,
              );
            }
            break;
          }
        }
      }),

      // ── Account state events (channel: 'account') ──
      wsClient.subscribe("account", (event) => {
        const wsEvent = event as WsEvent;
        switch (wsEvent.eventType) {
          case "MarginCall":
            if (!skip("MarginCall"))
              addToast(
                "warning",
                "⚠ Margin Call",
                `Margin level at ${wsEvent.marginLevel?.toFixed(1)}% — reduce exposure or add funds`,
              );
            break;
          case "Liquidation":
            if (!skip("Liquidation"))
              addToast(
                "error",
                "Liquidation (Stop-Out)",
                wsEvent.reason || "Positions forcibly closed due to insufficient margin",
              );
            break;
          case "AccountFailed":
            if (!skip("AccountFailed"))
              addToast(
                "error",
                "Challenge Failed",
                `Account failed: ${wsEvent.reason || wsEvent.ruleCode || "rule breached"}`,
              );
            break;
          case "AccountPassed":
            if (!skip("AccountPassed"))
              addToast(
                "success",
                "🎉 Challenge Passed!",
                `Congratulations! You passed phase ${wsEvent.phase || ""}`,
              );
            break;
          case "AccountFrozen":
            if (!skip("AccountFrozen"))
              addToast(
                "warning",
                "Account Frozen",
                `Account frozen: ${wsEvent.reason || wsEvent.ruleCode || "admin action"}`,
              );
            break;
        }
      }),

      // ── Rule events (channel: 'rules') ──
      wsClient.subscribe("rules", (event) => {
        const wsEvent = event as WsEvent;
        switch (wsEvent.eventType) {
          case "RuleBreached":
            if (!skip("RuleBreached"))
              addToast(
                "error",
                "Rule Breached",
                `${wsEvent.ruleCode}: value ${wsEvent.currentValue?.toFixed(2)} exceeded threshold ${wsEvent.threshold?.toFixed(2)}`,
              );
            break;
          case "RuleActionExecuted":
            if (!skip("RuleActionExecuted"))
              addToast("warning", "Rule Action", `${wsEvent.ruleCode} → ${wsEvent.action}`);
            break;
        }
      }),

      // ── Ledger events (channel: 'ledger') ──
      wsClient.subscribe("ledger", (event) => {
        const wsEvent = event as WsEvent;
        if (wsEvent.eventType === "LedgerEntryCreated" && !skip("LedgerEntryCreated")) {
          const amt = wsEvent.amount || 0;
          addToast(
            amt >= 0 ? "info" : "warning",
            "Ledger Entry",
            `${wsEvent.type}: ${amt >= 0 ? "+" : ""}${amt.toFixed(2)} (balance: ${(wsEvent.balance || 0).toFixed(2)})`,
          );
        }
      }),

      // ── System events (channel: 'system') ──
      wsClient.subscribe("system", (event) => {
        const wsEvent = event as WsEvent;
        if (wsEvent.eventType === "PhaseTransitioned" && !skip("PhaseTransitioned")) {
          addToast(
            "success",
            "Phase Transition",
            `Advanced from ${wsEvent.previousPhase} → ${wsEvent.newPhase}`,
          );
        }
        if (wsEvent.eventType === "DailyReconcileCompleted" && !skip("DailyReconcileCompleted")) {
          addToast(
            "info",
            "Daily Reconciliation",
            `Reconciliation completed — equity: ${wsEvent.equity?.toFixed(2)}, daily P&L: ${wsEvent.dailyPnl?.toFixed(2)}`,
          );
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [addToast, suppressSet]);

  return { toasts, addToast, removeToast };
}

// Toast container component
export function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 380,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: toastBg(toast.type),
            color: "#fff",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            animation: "slideInRight 0.3s ease-out",
            borderLeft: `4px solid ${toastAccent(toast.type)}`,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{toast.title}</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{toast.message}</div>
          </div>
          <button
            onClick={() => onRemove(toast.id)}
            style={{
              background: "none",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              fontSize: 16,
              padding: "0 0 0 8px",
              opacity: 0.7,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function toastBg(type: Toast["type"]): string {
  switch (type) {
    case "success":
      return "#1a3a2a";
    case "error":
      return "#3a1a1a";
    case "warning":
      return "#3a2a1a";
    case "info":
      return "#1a2a3a";
  }
}

function toastAccent(type: Toast["type"]): string {
  switch (type) {
    case "success":
      return "#3fb950";
    case "error":
      return "#f85149";
    case "warning":
      return "#d29922";
    case "info":
      return "#58a6ff";
  }
}
