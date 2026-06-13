import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { IChartApi, CandlestickData, Time } from "lightweight-charts";
import { useEconomicCalendar, type EconomicCalendarEvent } from "../../services/queries.ts";
import { type NewsOverlayConfig } from "./constants.ts";
import { extractCurrencies } from "./utils.ts";

// ── Types ────────────────────────────────────────────────────

export interface NewsPopupState {
  event: EconomicCalendarEvent;
  x: number;
  y: number;
}

export interface UseNewsOverlayReturn {
  newsConfig: NewsOverlayConfig;
  setNewsConfig: Dispatch<SetStateAction<NewsOverlayConfig>>;
  showNewsConfigDialog: boolean;
  setShowNewsConfigDialog: Dispatch<SetStateAction<boolean>>;
  newsPopup: NewsPopupState | null;
  setNewsPopup: Dispatch<SetStateAction<NewsPopupState | null>>;
}

// ── Hook ─────────────────────────────────────────────────────

export function useNewsOverlay(
  containerRef: RefObject<HTMLDivElement | null>,
  chartRef: RefObject<IChartApi | null>,
  selectedSymbol: string,
  isDark: boolean,
  chartData: CandlestickData<Time>[],
): UseNewsOverlayReturn {
  const [newsConfig, setNewsConfig] = useState<NewsOverlayConfig>(() => {
    const saved = localStorage.getItem("newsOverlayConfig");
    if (saved)
      try {
        return JSON.parse(saved) as NewsOverlayConfig;
      } catch {
        /* ignore */
      }
    return {
      enabled: true,
      lineColor: "#ef4444",
      showPast: true,
      showFuture: true,
      showHigh: true,
      showMedium: false,
      showLow: false,
    } satisfies NewsOverlayConfig;
  });
  const [showNewsConfigDialog, setShowNewsConfigDialog] = useState(false);
  const [newsPopup, setNewsPopup] = useState<NewsPopupState | null>(null);
  const newsMarkersRef = useRef<HTMLDivElement[]>([]);

  // Persist news config
  useEffect(() => {
    localStorage.setItem("newsOverlayConfig", JSON.stringify(newsConfig));
  }, [newsConfig]);

  // Extract currency pair from symbol
  const symbolCurrencies = useMemo(() => extractCurrencies(selectedSymbol), [selectedSymbol]);
  const { data: rawCalendarData } = useEconomicCalendar(symbolCurrencies);

  // Filter events based on config
  const calendarEvents = useMemo(() => {
    if (!newsConfig.enabled) return [];
    const now = Date.now();
    return (rawCalendarData || []).filter((e: EconomicCalendarEvent) => {
      if (e.impact === "high" && !newsConfig.showHigh) return false;
      if (e.impact === "medium" && !newsConfig.showMedium) return false;
      if (e.impact === "low" && !newsConfig.showLow) return false;
      const eventTime = new Date(e.time).getTime();
      if (eventTime < now && !newsConfig.showPast) return false;
      if (eventTime > now && !newsConfig.showFuture) return false;
      return true;
    });
  }, [rawCalendarData, newsConfig]);

  // Render news markers on chart (vertical lines + flag icons)
  useEffect(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    if (!container || !chart || !newsConfig.enabled || calendarEvents.length === 0) {
      newsMarkersRef.current.forEach((el) => el.remove());
      newsMarkersRef.current = [];
      return;
    }

    newsMarkersRef.current.forEach((el) => el.remove());
    newsMarkersRef.current = [];

    const timeScale = chart.timeScale();
    const lineColor = newsConfig.lineColor || "#ef4444";

    const hexToRgba = (hex: string, alpha: number) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    };

    const impactColor = (impact: string) => {
      if (impact === "high") return lineColor;
      if (impact === "medium") return "#f59e0b";
      return "#6b7280";
    };

    const renderMarkers = () => {
      newsMarkersRef.current.forEach((el) => el.remove());
      newsMarkersRef.current = [];

      const containerRect = container.getBoundingClientRect();

      for (const ev of calendarEvents) {
        const eventTimeSec = Math.floor(new Date(ev.time).getTime() / 1000);
        const x = timeScale.timeToCoordinate(
          eventTimeSec as Parameters<typeof timeScale.timeToCoordinate>[0],
        );
        if (x === null || x < 0 || x > containerRect.width) continue;

        const color = impactColor(ev.impact);

        const line = document.createElement("div");
        line.style.position = "absolute";
        line.style.left = `${x}px`;
        line.style.top = "0";
        line.style.bottom = "28px";
        line.style.width = "1px";
        line.style.backgroundImage = `repeating-linear-gradient(to bottom, ${hexToRgba(color, 0.5)} 0px, ${hexToRgba(color, 0.5)} 4px, transparent 4px, transparent 8px)`;
        line.style.pointerEvents = "none";
        line.style.zIndex = "5";
        container.appendChild(line);
        newsMarkersRef.current.push(line);

        const flag = document.createElement("div");
        flag.style.position = "absolute";
        flag.style.left = `${x - 10}px`;
        flag.style.bottom = "30px";
        flag.style.width = "20px";
        flag.style.height = "20px";
        flag.style.borderRadius = "50%";
        flag.style.display = "flex";
        flag.style.alignItems = "center";
        flag.style.justifyContent = "center";
        flag.style.fontSize = "11px";
        flag.style.fontWeight = "700";
        flag.style.cursor = "pointer";
        flag.style.zIndex = "6";
        flag.style.transition = "transform 0.15s ease, box-shadow 0.15s ease";
        flag.style.border = "2px solid";
        flag.style.backgroundColor = hexToRgba(color, 0.2);
        flag.style.borderColor = hexToRgba(color, 0.7);
        flag.style.color = color;
        flag.textContent = ev.currency.slice(0, 2);
        flag.title = `${ev.event} (${ev.currency})`;

        flag.addEventListener("mouseenter", () => {
          flag.style.transform = "scale(1.2)";
          flag.style.boxShadow = `0 0 8px ${hexToRgba(color, 0.4)}`;
        });
        flag.addEventListener("mouseleave", () => {
          flag.style.transform = "scale(1)";
          flag.style.boxShadow = "none";
        });

        flag.addEventListener("click", (e) => {
          e.stopPropagation();
          const rect = flag.getBoundingClientRect();
          const containerPos = container.getBoundingClientRect();
          setNewsPopup({
            event: ev,
            x: rect.left - containerPos.left + rect.width / 2,
            y: rect.top - containerPos.top - 8,
          });
        });

        container.appendChild(flag);
        newsMarkersRef.current.push(flag);
      }
    };

    renderMarkers();

    const onVisibleRangeChange = () => renderMarkers();
    timeScale.subscribeVisibleLogicalRangeChange(onVisibleRangeChange);

    const resizeObserver = new ResizeObserver(() => renderMarkers());
    resizeObserver.observe(container);

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);
      resizeObserver.disconnect();
      newsMarkersRef.current.forEach((el) => el.remove());
      newsMarkersRef.current = [];
    };
    // chartRef/containerRef are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarEvents, newsConfig, isDark, chartData]);

  // Close news popup when clicking elsewhere
  useEffect(() => {
    if (!newsPopup) return;
    const handleClick = () => setNewsPopup(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [newsPopup]);

  return {
    newsConfig,
    setNewsConfig,
    showNewsConfigDialog,
    setShowNewsConfigDialog,
    newsPopup,
    setNewsPopup,
  };
}
