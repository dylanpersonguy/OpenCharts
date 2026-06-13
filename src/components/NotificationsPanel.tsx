/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";
import { wsClient } from "../services/ws";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Bell,
  X,
  CheckCheck,
  Trash2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Award,
  DollarSign,
  Info,
  Volume2,
  VolumeX,
} from "lucide-react";

export type NotificationType =
  | "order"
  | "position"
  | "account"
  | "rule"
  | "system"
  | "payout"
  | "challenge";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  icon?: string;
  severity?: "info" | "success" | "warning" | "error";
}

const ICON_MAP: Record<NotificationType, typeof Bell> = {
  order: TrendingUp,
  position: TrendingDown,
  account: DollarSign,
  rule: AlertTriangle,
  system: Info,
  payout: DollarSign,
  challenge: Award,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "text-blue-400 bg-blue-500/10",
  success: "text-green-400 bg-green-500/10",
  warning: "text-yellow-400 bg-yellow-500/10",
  error: "text-red-400 bg-red-500/10",
};

type WsEvent = {
  eventType?: string;
  side?: string;
  quantity?: number | string;
  symbol?: string;
  reasonMessage?: string;
  reason?: string;
  marginLevel?: number;
  phase?: string;
  ruleCode?: string;
  currentValue?: number;
  threshold?: number;
  previousPhase?: string;
  newPhase?: string;
} & Record<string, unknown>;

type NotificationHistoryEntry = {
  id?: string;
  type?: NotificationType;
  title?: string;
  message?: string;
  body?: string;
  createdAt?: string | number;
  timestamp?: string | number;
  read?: boolean;
  severity?: "info" | "success" | "warning" | "error";
};

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [_loaded, setLoaded] = useState(false);

  // Load notification history from server
  useEffect(() => {
    api
      .getNotificationHistory(50)
      .then((history: NotificationHistoryEntry[]) => {
        const mapped: Notification[] = history.map((n) => ({
          id: n.id || `notif-${Date.now()}-${Math.random()}`,
          type: n.type || "system",
          title: n.title || "Notification",
          message: n.message || n.body || "",
          timestamp: new Date(n.createdAt || n.timestamp || Date.now()).getTime(),
          read: n.read ?? false,
          severity: n.severity || "info",
        }));
        setNotifications(mapped);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const addNotification = useCallback((n: Omit<Notification, "id" | "timestamp" | "read">) => {
    const notif: Notification = {
      ...n,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      read: false,
    };
    setNotifications((prev) => [notif, ...prev].slice(0, 100));
  }, []);

  // Subscribe to WS events for real-time notifications
  useEffect(() => {
    const unsubs = [
      wsClient.subscribe("orders", (event) => {
        const wsEvent = event as WsEvent;
        if (wsEvent.eventType === "OrderFilled") {
          addNotification({
            type: "order",
            title: "Order Filled",
            message: `${wsEvent.side || ""} ${wsEvent.quantity || ""} ${wsEvent.symbol || ""} filled`,
            severity: "success",
          });
        }
        if (wsEvent.eventType === "OrderRejected") {
          addNotification({
            type: "order",
            title: "Order Rejected",
            message: wsEvent.reasonMessage || wsEvent.reason || "Order was rejected",
            severity: "error",
          });
        }
      }),
      wsClient.subscribe("account", (event) => {
        const wsEvent = event as WsEvent;
        if (wsEvent.eventType === "MarginCall") {
          addNotification({
            type: "account",
            title: "Margin Call",
            message: `Margin level at ${wsEvent.marginLevel?.toFixed(1)}%`,
            severity: "warning",
          });
        }
        if (wsEvent.eventType === "AccountPassed") {
          addNotification({
            type: "challenge",
            title: "Challenge Passed!",
            message: `Congratulations! You passed phase ${wsEvent.phase || ""}`,
            severity: "success",
          });
        }
        if (wsEvent.eventType === "AccountFailed") {
          addNotification({
            type: "challenge",
            title: "Challenge Failed",
            message: wsEvent.reason || "Rule breached",
            severity: "error",
          });
        }
      }),
      wsClient.subscribe("rules", (event) => {
        const wsEvent = event as WsEvent;
        if (wsEvent.eventType === "RuleBreached") {
          addNotification({
            type: "rule",
            title: "Rule Breached",
            message: `${wsEvent.ruleCode}: ${wsEvent.currentValue?.toFixed(2)} exceeded ${wsEvent.threshold?.toFixed(2)}`,
            severity: "error",
          });
        }
      }),
      wsClient.subscribe("system", (event) => {
        const wsEvent = event as WsEvent;
        if (wsEvent.eventType === "PhaseTransitioned") {
          addNotification({
            type: "challenge",
            title: "Phase Transition",
            message: `Advanced from ${wsEvent.previousPhase} to ${wsEvent.newPhase}`,
            severity: "success",
          });
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [addNotification]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    api.markNotificationsRead([id]).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (unreadIds.length > 0) api.markNotificationsRead(unreadIds).catch(() => {});
  }, [notifications]);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    clearAll,
    addNotification,
  };
}

// ── Notifications Panel Component ──────────────────────────

interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
}

export function NotificationsPanel({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: NotificationsPanelProps) {
  const [filter, setFilter] = useState<NotificationType | "all">("all");
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem("notif_sound") !== "false",
  );

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem("notif_sound", String(next));
  };

  const filtered =
    filter === "all" ? notifications : notifications.filter((n) => n.type === filter);

  if (!isOpen) return null;

  const categories: { label: string; value: NotificationType | "all" }[] = [
    { label: "All", value: "all" },
    { label: "Orders", value: "order" },
    { label: "Positions", value: "position" },
    { label: "Account", value: "account" },
    { label: "Rules", value: "rule" },
    { label: "Challenge", value: "challenge" },
    { label: "System", value: "system" },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-11 bottom-0 z-50 w-[380px] bg-card border-l border-border shadow-2xl shadow-black/40 flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={toggleSound}
              title={soundEnabled ? "Mute" : "Unmute"}
            >
              {soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onMarkAllRead}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" /> Read all
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border/40 overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setFilter(cat.value)}
              className={cn(
                "text-[10px] font-medium px-2 py-1 rounded-full whitespace-nowrap transition-colors",
                filter === cat.value
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Notification List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs">No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {filtered.map((notif) => {
                const Icon = ICON_MAP[notif.type] || Bell;
                const severity = notif.severity || "info";
                return (
                  <div
                    key={notif.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer hover:bg-secondary/30",
                      !notif.read && "bg-accent/[0.03]",
                    )}
                    onClick={() => onMarkRead(notif.id)}
                  >
                    <div
                      className={cn("p-1.5 rounded-lg mt-0.5 shrink-0", SEVERITY_COLORS[severity])}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn("text-xs font-semibold", !notif.read && "text-foreground")}
                        >
                          {notif.title}
                        </span>
                        {!notif.read && (
                          <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {notif.message}
                      </p>
                      <span className="text-[10px] text-muted-foreground/60 mt-1 block">
                        {formatRelativeTime(notif.timestamp)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="px-4 py-2 border-t border-border/40 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {notifications.length} notifications
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={onClearAll}
            >
              <Trash2 className="h-3 w-3 mr-1" /> Clear all
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
