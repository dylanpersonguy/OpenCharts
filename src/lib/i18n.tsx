/* eslint-disable react-refresh/only-export-components */
/**
 * Lightweight i18n system — no external dependencies.
 * Provides React context + hook for multi-language support.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Locale = "en" | "es" | "fr" | "de" | "pt" | "ar" | "zh" | "ja" | "ru" | "ko";

export const SUPPORTED_LOCALES: {
  code: Locale;
  label: string;
  dir: "ltr" | "rtl";
}[] = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "es", label: "Español", dir: "ltr" },
  { code: "fr", label: "Français", dir: "ltr" },
  { code: "de", label: "Deutsch", dir: "ltr" },
  { code: "pt", label: "Português", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "zh", label: "中文", dir: "ltr" },
  { code: "ja", label: "日本語", dir: "ltr" },
  { code: "ru", label: "Русский", dir: "ltr" },
  { code: "ko", label: "한국어", dir: "ltr" },
];

// English is the base language — keys are English strings for DX
type Translations = Record<string, string>;

const translations: Record<Locale, Translations> = {
  en: {},
  es: {
    Dashboard: "Panel",
    Trading: "Comercio",
    History: "Historial",
    Settings: "Configuración",
    Security: "Seguridad",
    Watchlist: "Lista de seguimiento",
    "New Order": "Nueva Orden",
    Positions: "Posiciones",
    Orders: "Órdenes",
    Buy: "Comprar",
    Sell: "Vender",
    Volume: "Volumen",
    Symbol: "Símbolo",
    Side: "Lado",
    Price: "Precio",
    "Take Profit": "Toma de ganancias",
    "Stop Loss": "Parar pérdida",
    Close: "Cerrar",
    Cancel: "Cancelar",
    "Close All": "Cerrar todo",
    "Cancel All": "Cancelar todo",
    Connected: "Conectado",
    Disconnected: "Desconectado",
    Connecting: "Conectando",
    Reconnecting: "Reconectando",
    "Economic Calendar": "Calendario económico",
    "News Feed": "Noticias",
    Statements: "Estados de cuenta",
    "Depth of Market": "Profundidad de mercado",
    Indicators: "Indicadores",
    Draw: "Dibujar",
    "No open positions": "Sin posiciones abiertas",
    "No pending orders": "Sin órdenes pendientes",
    Market: "Mercado",
    Limit: "Límite",
    Stop: "Parada",
    "Trailing Stop": "Stop dinámico",
  },
  fr: {
    Dashboard: "Tableau de bord",
    Trading: "Trading",
    History: "Historique",
    Settings: "Paramètres",
    Security: "Sécurité",
    Watchlist: "Liste de suivi",
    "New Order": "Nouvel ordre",
    Positions: "Positions",
    Orders: "Ordres",
    Buy: "Acheter",
    Sell: "Vendre",
    Volume: "Volume",
    Symbol: "Symbole",
    Side: "Côté",
    Price: "Prix",
    "Take Profit": "Prendre profit",
    "Stop Loss": "Stop Loss",
    Close: "Fermer",
    Cancel: "Annuler",
    "Close All": "Tout fermer",
    "Cancel All": "Tout annuler",
    Connected: "Connecté",
    Disconnected: "Déconnecté",
    "Economic Calendar": "Calendrier économique",
    "News Feed": "Fil d'actualités",
    Statements: "Relevés",
    "Depth of Market": "Profondeur de marché",
    Indicators: "Indicateurs",
    "No open positions": "Aucune position ouverte",
    "No pending orders": "Aucun ordre en attente",
  },
  de: {
    Dashboard: "Übersicht",
    Trading: "Handel",
    History: "Verlauf",
    Settings: "Einstellungen",
    Watchlist: "Beobachtungsliste",
    "New Order": "Neue Order",
    Positions: "Positionen",
    Orders: "Aufträge",
    Buy: "Kaufen",
    Sell: "Verkaufen",
    Close: "Schließen",
    Cancel: "Abbrechen",
    Connected: "Verbunden",
    Indicators: "Indikatoren",
  },
  pt: {
    Dashboard: "Painel",
    Trading: "Negociação",
    Watchlist: "Lista de observação",
    "New Order": "Nova Ordem",
    Positions: "Posições",
    Orders: "Ordens",
    Buy: "Comprar",
    Sell: "Vender",
    Close: "Fechar",
    Cancel: "Cancelar",
    Connected: "Conectado",
  },
  ar: {
    Dashboard: "لوحة التحكم",
    Trading: "التداول",
    Watchlist: "قائمة المراقبة",
    Buy: "شراء",
    Sell: "بيع",
    Close: "إغلاق",
    Cancel: "إلغاء",
    Positions: "المراكز",
    Orders: "الأوامر",
  },
  zh: {
    Dashboard: "仪表板",
    Trading: "交易",
    Watchlist: "自选列表",
    Buy: "买入",
    Sell: "卖出",
    Close: "关闭",
    Cancel: "取消",
    Positions: "持仓",
    Orders: "订单",
    Indicators: "指标",
  },
  ja: {
    Dashboard: "ダッシュボード",
    Trading: "取引",
    Watchlist: "ウォッチリスト",
    Buy: "買い",
    Sell: "売り",
    Close: "閉じる",
    Positions: "ポジション",
    Orders: "注文",
  },
  ru: {
    Dashboard: "Панель",
    Trading: "Торговля",
    Watchlist: "Список наблюдения",
    Buy: "Купить",
    Sell: "Продать",
    Close: "Закрыть",
    Cancel: "Отменить",
    Positions: "Позиции",
    Orders: "Ордера",
    Indicators: "Индикаторы",
  },
  ko: {
    Dashboard: "대시보드",
    Trading: "거래",
    Watchlist: "관심목록",
    Buy: "매수",
    Sell: "매도",
    Close: "닫기",
    Positions: "포지션",
    Orders: "주문",
  },
};

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  dir: "ltr" | "rtl";
}

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
  dir: "ltr",
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem("propsim_locale");
    return (saved as Locale) || "en";
  });

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem("propsim_locale", l);
    setLocaleState(l);
  }, []);

  const t = useCallback(
    (key: string): string => {
      if (locale === "en") return key;
      return translations[locale]?.[key] || key;
    },
    [locale],
  );

  const dir = SUPPORTED_LOCALES.find((l) => l.code === locale)?.dir || "ltr";

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, dir }}>{children}</I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
